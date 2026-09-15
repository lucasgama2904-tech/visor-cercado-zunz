// Visor de tramos — Cercado perimetral ZUNZ
// INGEPRO S.A.
//
// Un solo modelo, tres vistas (taller / in situ / todo) y un filtro por
// tramo. Se puede entrar directo a un tramo con ?t=5 en la URL.

import * as THREE from "three";
import CameraControls from "camera-controls";
import * as FRAGS from "@thatopen/fragments";

// --- Identidad visual -------------------------------------------------------
const VERDE = 0x4db69c; // se fabrica en taller
const AZUL = 0x0d3b65; // se ejecuta in situ / resaltado secundario
const GRIS = 0x4a4a4a; // contexto
const OPACIDAD_CONTEXTO = 0.22;

const MODEL_ID = "cercado";
const FRAG_URL = "./modelo.frag";
const TRAMOS_URL = "./tramos.json";
const WORKER_URL = "./fragments-worker.mjs";

// --- Estado -----------------------------------------------------------------
let model = null;
let fragments = null;
let camera, controls, scene, renderer;
let datos = null;
let todosLosIds = [];
let idPorGuid = new Map();
let terrenoIds = [];
let terrenoVisible = false;

let vista = "taller"; // taller | obra | todo
let tramoActivo = null; // número de tramo seleccionado
let familiasActivas = new Set(); // claves "zapata:FE", "tubo:Tubo 2\"" ...
let aislado = false;

const overlays = new Map(); // id de tramo -> { panel, rotulo }
let grupoOverlays = null;

const $ = (sel) => document.querySelector(sel);
const els = {
  canvas: $("#viewer"),
  loading: $("#loading"),
  aviso: $("#aviso"),
  menuToggle: $("#menu-toggle"),
  menuClose: $("#menu-close"),
  menuBackdrop: $("#menu-backdrop"),
  menuPanel: $("#menu-panel"),
  menuList: $("#menu-list"),
  resumen: $("#resumen"),
  chipsZapatas: $("#chips-zapatas"),
  chipsTubos: $("#chips-tubos"),
  limpiar: $("#limpiar"),
  vistas: document.querySelectorAll(".vista"),
  btnPlanta: $("#btn-planta"),
  btnTerreno: $("#btn-terreno"),
  ficha: $("#ficha"),
  fichaToggle: $("#ficha-toggle"),
  fTitulo: $("#f-titulo"),
  fFila: $("#f-fila"),
  fLargo: $("#f-largo"),
  fVanos: $("#f-vanos"),
  fPostes: $("#f-postes"),
  fZapatas: $("#f-zapatas"),
  fBarras: $("#f-barras"),
  fNota: $("#f-nota"),
  isoBtn: $("#iso-toggle"),
};

// --- Escena -----------------------------------------------------------------
function initScene() {
  scene = new THREE.Scene();
  scene.background = null;

  // El cercado mide ~70 m de perímetro y 2,2 m de alto: el rango near/far va
  // ajustado a esa escala real para no degradar la precisión del z-buffer.
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 2000);
  camera.position.set(20, 20, 20);

  renderer = new THREE.WebGLRenderer({ canvas: els.canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.7));
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(1, 2, 1);
  scene.add(dir);
  const dir2 = new THREE.DirectionalLight(0xffffff, 0.5);
  dir2.position.set(-1, -0.5, -1);
  scene.add(dir2);

  grupoOverlays = new THREE.Group();
  scene.add(grupoOverlays);

  CameraControls.install({ THREE });
  controls = new CameraControls(camera, renderer.domElement);
  controls.touches.one = CameraControls.ACTION.TOUCH_ROTATE;
  controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY_TRUCK;
  controls.dollyToCursor = false;
  controls.minDistance = 0.3;
  controls.maxDistance = 600;

  window.addEventListener("resize", onResize);

  let lastTime = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;
    controls.update(delta);
    renderer.render(scene, camera);
  });
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Fragments --------------------------------------------------------------
async function initFragments() {
  fragments = new FRAGS.FragmentsModels(WORKER_URL);
  controls.addEventListener("update", () => fragments.update());

  fragments.models.materials.list.onItemSet.add(({ value: material }) => {
    if (!("isLodMaterial" in material && material.isLodMaterial)) {
      material.polygonOffset = true;
      material.polygonOffsetUnits = 1;
      material.polygonOffsetFactor = Math.random();
    }
  });

  const res = await fetch(FRAG_URL);
  const buffer = await res.arrayBuffer();
  model = await fragments.load(buffer, { modelId: MODEL_ID });
  model.useCamera(camera);
  scene.add(model.object);

  // El modelo es chico: geometría completa siempre, para que el color y la
  // opacidad del resaltado no se pierdan al alejar la cámara.
  await model.setLodMode(FRAGS.LodMode.ALL_GEOMETRY);
  await fragments.update(true);

  todosLosIds = await model.getLocalIds();
}

// Resuelve TODOS los GUID del proyecto en una sola llamada al worker. Pedirle
// varias resoluciones en paralelo le hace perder respuestas en silencio (se
// confirmó en el visor de soporte de barras), así que se hace una sola vez.
async function resolverGuids() {
  const guids = new Set();
  for (const t of datos.tramos) {
    t.postes.forEach((g) => guids.add(g));
    t.barras.forEach((g) => guids.add(g));
    t.zapatas.forEach((g) => guids.add(g));
  }
  datos.insitu.postes.forEach((g) => guids.add(g));
  datos.insitu.barras.forEach((g) => guids.add(g));
  datos.barrasContinuas.forEach((b) => guids.add(b.guid));
  (datos.terreno ?? []).forEach((g) => guids.add(g));
  for (const grupo of Object.values(datos.catalogo)) {
    for (const lista of Object.values(grupo)) lista.forEach((g) => guids.add(g));
  }

  const lista = [...guids];
  const resueltos = await model.getLocalIdsByGuids(lista);
  lista.forEach((g, i) => {
    if (resueltos[i] !== null && resueltos[i] !== undefined) idPorGuid.set(g, resueltos[i]);
  });

  const faltan = lista.length - idPorGuid.size;
  if (faltan > 0) console.warn(`[visor-cercado] ${faltan} GUID sin resolver contra modelo.frag`);

  terrenoIds = ids(datos.terreno ?? []);
}

const ids = (guids) => guids.map((g) => idPorGuid.get(g)).filter((v) => v !== undefined);

// --- Overlays: panel verde y rótulo por tramo -------------------------------
//
// El resaltado por elemento no alcanza: en la fila norte y en los tramos 5-7
// las barras están modeladas como una corrida continua, así que pintarlas no
// distingue un tramo del otro. El panel dibuja el tramo completo igual en
// todos los casos, y el número lo deja identificado a simple vista.
async function construirOverlays() {
  for (const t of datos.tramos) {
    const localIds = ids(t.postes);
    if (!localIds.length) continue;
    const box = await model.getMergedBox(localIds);

    const size = new THREE.Vector3();
    const centro = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(centro);

    // El eje más largo es el desarrollo del tramo, el más chico el espesor
    // (diámetro del poste) y el del medio la altura: sirve para cualquier
    // fila sin depender de cómo quedó orientado el modelo.
    const ejes = [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a));
    const ejeEspesor = ejes[2];
    const ejeAlto = ejes[1];

    const dims = size.clone();
    dims.setComponent(ejeEspesor, 0.22);
    dims.setComponent(ejeAlto, size.getComponent(ejeAlto) * 1.04);

    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(dims.x, dims.y, dims.z),
      new THREE.MeshBasicMaterial({
        color: VERDE,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    panel.position.copy(centro);
    panel.visible = false;
    grupoOverlays.add(panel);

    const rotulo = crearRotulo(String(t.id));
    const posRotulo = centro.clone();
    posRotulo.setComponent(ejeAlto, box.max.getComponent(ejeAlto) + 0.75);
    rotulo.position.copy(posRotulo);
    rotulo.visible = false;
    grupoOverlays.add(rotulo);

    overlays.set(t.id, { panel, rotulo });
  }
}

function crearRotulo(texto) {
  const S = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d");

  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = "#4db69c";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#0d3b65";
  ctx.stroke();

  ctx.fillStyle = "#1b1b1b";
  ctx.font = "bold 68px Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(texto, S / 2, S / 2 + 4);

  const textura = new THREE.CanvasTexture(canvas);
  textura.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: textura, transparent: true, depthTest: false, sizeAttenuation: false }),
  );
  // sizeAttenuation en false: la escala pasa a ser fracción de pantalla, así
  // el número se lee igual en la vista general y con el tramo en primer plano.
  sprite.scale.set(0.055, 0.055, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function mostrarOverlays(idsTramo) {
  const set = new Set(idsTramo);
  for (const [id, o] of overlays) {
    const on = set.has(id);
    o.panel.visible = on;
    o.rotulo.visible = on;
  }
}

// --- Pintado ----------------------------------------------------------------
async function limpiarPintado() {
  await model.setVisible(todosLosIds, true);
  await model.resetColor(undefined);
  await model.resetOpacity(undefined);
  if (!terrenoVisible && terrenoIds.length) await model.setVisible(terrenoIds, false);
  aislado = false;
  els.isoBtn.textContent = "Aislar";
}

async function pintar(resaltados, opciones = {}) {
  const { secundarios = [], color = VERDE, colorSec = AZUL } = opciones;
  const destacados = new Set([...resaltados, ...secundarios]);
  const resto = todosLosIds.filter((id) => !destacados.has(id));

  await model.setColor(resto, new THREE.Color(GRIS));
  await model.setOpacity(resto, OPACIDAD_CONTEXTO);
  if (secundarios.length) {
    await model.setColor(secundarios, new THREE.Color(colorSec));
    await model.setOpacity(secundarios, 1);
  }
  if (resaltados.length) {
    await model.setColor(resaltados, new THREE.Color(color));
    await model.setOpacity(resaltados, 1);
  }
  await fragments.update(true);
}

// Ejes del modelo completo: el de menor desarrollo es el vertical, el mayor
// es el eje largo del cercado. Se calcula una sola vez al arrancar y sirve
// para orientar la cámara sin depender de cómo quedó rotado el IFC.
let ejesModelo = null;

async function calcularEjes() {
  const box = await model.getMergedBox(todosLosIds);
  const s = new THREE.Vector3();
  box.getSize(s);
  const orden = [0, 1, 2].sort((a, b) => s.getComponent(b) - s.getComponent(a));
  ejesModelo = { largo: orden[0], medio: orden[1], alto: orden[2] };
}

// Vista de tres cuartos desde arriba, orientada como el croquis de obra: la
// fila norte (la del portón) arriba y los tramos numerados de izquierda a
// derecha.
function direccionTresCuartos() {
  const d = new THREE.Vector3();
  d.setComponent(ejesModelo.largo, -0.45);
  d.setComponent(ejesModelo.medio, 0.85);
  d.setComponent(ejesModelo.alto, 1.15);
  return d.normalize();
}

async function encuadrar(localIds, padding = 0.5, reorientar = true) {
  const box = await model.getMergedBox(localIds?.length ? localIds : todosLosIds);
  if (reorientar && ejesModelo) {
    const centro = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(centro);
    box.getSize(size);
    const dist = Math.max(size.x, size.y, size.z) * 1.6 + 3;
    const ojo = centro.clone().add(direccionTresCuartos().multiplyScalar(dist));
    await controls.setLookAt(ojo.x, ojo.y, ojo.z, centro.x, centro.y, centro.z, true);
  }
  await controls.fitToBox(box, true, {
    paddingTop: padding,
    paddingBottom: padding,
    paddingLeft: padding,
    paddingRight: padding,
  });
}

// --- Vistas -----------------------------------------------------------------
function idsDeTaller() {
  const out = [];
  for (const t of datos.tramos) out.push(...ids(t.postes), ...ids(t.barras));
  return [...new Set(out)];
}

function idsDeObra() {
  return [...new Set([...ids(datos.insitu.postes), ...ids(datos.insitu.barras)])];
}

function idsDeZapatas() {
  return [...new Set(Object.values(datos.catalogo.zapatas).flat().map((g) => idPorGuid.get(g)).filter((v) => v !== undefined))];
}

async function aplicarVista(nueva) {
  vista = nueva;
  tramoActivo = null;
  familiasActivas.clear();
  actualizarChips();
  marcarItemActivo();
  els.vistas.forEach((b) => b.classList.toggle("activo", b.dataset.vista === vista));
  await limpiarPintado();
  els.isoBtn.hidden = true;

  if (vista === "todo") {
    mostrarOverlays([]);
    ocultarFicha();
    await fragments.update(true);
    await encuadrar(null, 0.3);
  } else if (vista === "taller") {
    mostrarOverlays(datos.tramos.map((t) => t.id));
    await pintar(idsDeTaller(), { secundarios: idsDeZapatas(), color: VERDE });
    mostrarFichaResumen("taller");
    await encuadrar(null, 0.3);
  } else {
    mostrarOverlays([]);
    await pintar([...idsDeObra(), ...idsDeZapatas()], { color: AZUL });
    mostrarFichaResumen("obra");
    await encuadrar(null, 0.3);
  }
  actualizarURL();
}

// --- Selección de tramo -----------------------------------------------------
async function seleccionarTramo(id) {
  const t = datos.tramos.find((x) => x.id === id);
  if (!t) return;

  tramoActivo = id;
  familiasActivas.clear();
  actualizarChips();
  marcarItemActivo();
  await limpiarPintado();

  const piezas = [...ids(t.postes), ...ids(t.barras)];
  const zaps = ids(t.zapatas);
  mostrarOverlays([id]);
  await pintar(piezas, { secundarios: zaps, color: VERDE, colorSec: AZUL });
  mostrarFichaTramo(t);
  els.isoBtn.hidden = false;
  await encuadrar([...piezas, ...zaps], 0.8);
  actualizarURL();
}

async function toggleAislado() {
  if (!tramoActivo) return;
  const t = datos.tramos.find((x) => x.id === tramoActivo);
  const piezas = [...ids(t.postes), ...ids(t.barras), ...ids(t.zapatas)];
  const set = new Set(piezas);
  const resto = todosLosIds.filter((id) => !set.has(id));

  aislado = !aislado;
  await model.setVisible(resto, !aislado);
  if (!aislado && !terrenoVisible && terrenoIds.length) await model.setVisible(terrenoIds, false);
  els.isoBtn.textContent = aislado ? "Ver todo" : "Aislar";
  await fragments.update(true);
  await encuadrar(piezas, aislado ? 0.9 : 0.8, false);
}

// --- Filtro por familia -----------------------------------------------------
async function toggleFamilia(clave) {
  if (familiasActivas.has(clave)) familiasActivas.delete(clave);
  else familiasActivas.add(clave);

  tramoActivo = null;
  marcarItemActivo();
  actualizarChips();
  await limpiarPintado();
  els.isoBtn.hidden = true;

  if (familiasActivas.size === 0) {
    await aplicarVista(vista);
    return;
  }

  mostrarOverlays([]);
  const guids = [];
  for (const clave of familiasActivas) {
    const [grupo, nombre] = clave.split("::");
    guids.push(...(datos.catalogo[grupo]?.[nombre] ?? []));
  }
  const localIds = ids(guids);
  await pintar(localIds, { color: AZUL });
  mostrarFichaFamilias(localIds.length);
  await encuadrar(localIds, 0.6);
  actualizarURL();
}

// --- UI ---------------------------------------------------------------------
const mm = (v) => `${(v / 1000).toFixed(2).replace(".", ",")} m`;
const listaTipos = (obj) =>
  Object.entries(obj)
    .map(([k, v]) => `${v} × ${k.replace("Tubo ", "")}`)
    .join(" · ") || "—";

function construirPanel() {
  const r = datos.resumen;
  els.resumen.innerHTML =
    `<b>${r.totalTramos} tramos</b> de taller — ${mm(r.metrosTaller)} de los ${mm(r.perimetro)} del perímetro.<br>` +
    `Fundaciones: ${Object.entries(r.zapatas).map(([k, v]) => `${v} ${k}`).join(", ")}.<br>` +
    `Postes: ${Object.entries(r.postes).map(([k, v]) => `${v} de ${k.replace("Tubo ", "")}`).join(", ")}.`;

  els.menuList.innerHTML = "";
  for (const t of datos.tramos) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "menu-item";
    item.dataset.tramo = String(t.id);
    item.innerHTML =
      `<span class="menu-num">${t.id}</span>` +
      `<span class="menu-datos">` +
      `<span class="menu-largo">${mm(t.largo)}</span>` +
      `<span class="menu-sub">${t.filaDesc} · ${t.postes.length} postes · vanos ${t.vanos.join("+")}</span>` +
      `</span>`;
    item.addEventListener("click", () => {
      cerrarMenu();
      seleccionarTramo(t.id);
    });
    els.menuList.appendChild(item);
  }

  construirChips(els.chipsZapatas, "zapatas");
  construirChips(els.chipsTubos, "tubos");
  els.limpiar.addEventListener("click", async () => {
    familiasActivas.clear();
    await aplicarVista(vista);
  });
}

function construirChips(contenedor, grupo) {
  contenedor.innerHTML = "";
  for (const [nombre, lista] of Object.entries(datos.catalogo[grupo] ?? {})) {
    const clave = `${grupo}::${nombre}`;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.clave = clave;
    chip.innerHTML = `${nombre.replace("Tubo ", "")}<span class="chip-n">${lista.length}</span>`;
    chip.addEventListener("click", () => toggleFamilia(clave));
    contenedor.appendChild(chip);
  }
}

function actualizarChips() {
  document.querySelectorAll(".chip").forEach((c) => {
    c.classList.toggle("activo", familiasActivas.has(c.dataset.clave));
  });
  els.limpiar.hidden = familiasActivas.size === 0;
}

function marcarItemActivo() {
  els.menuList.querySelectorAll(".menu-item").forEach((i) => {
    i.classList.toggle("activo", Number(i.dataset.tramo) === tramoActivo);
  });
}

function mostrarFichaTramo(t) {
  els.fTitulo.textContent = `Tramo ${t.id}`;
  els.fFila.textContent = t.filaDesc;
  els.fLargo.textContent = mm(t.largo);
  els.fVanos.textContent = t.vanos.map((v) => `${v}`).join(" + ") + " mm";
  els.fPostes.textContent = listaTipos(t.tubosPorTipo);
  els.fZapatas.textContent = listaTipos(t.zapatasPorTipo);

  const continuas = datos.barrasContinuas.filter((b) => b.tramos.includes(t.id));
  if (t.barras.length) {
    els.fBarras.textContent = `${t.barras.length} barras · ${mm(t.metrosBarra)}`;
    els.fNota.hidden = true;
  } else if (continuas.length) {
    els.fBarras.textContent = `A cortar de corrida continua`;
    els.fNota.textContent =
      `En el modelo las barras horizontales de este tramo son parte de una corrida continua de ` +
      `${mm(continuas[0].largo)} compartida con los tramos ${continuas[0].tramos.join(", ")}. ` +
      `En taller hay que cortarlas a la medida del tramo, descontando la separación.`;
    els.fNota.hidden = false;
  } else {
    els.fBarras.textContent = "—";
    els.fNota.hidden = true;
  }

  els.ficha.hidden = false;
  els.ficha.classList.remove("colapsada");
}

function mostrarFichaResumen(tipo) {
  const r = datos.resumen;
  if (tipo === "taller") {
    els.fTitulo.textContent = "Fabricación en taller";
    els.fFila.textContent = "10 tramos";
    els.fLargo.textContent = mm(r.metrosTaller);
    els.fVanos.textContent = "—";
    els.fPostes.textContent = `${datos.tramos.reduce((s, t) => s + t.postes.length, 0)} postes (con compartidos)`;
    els.fZapatas.textContent = listaTipos(r.zapatas);
    els.fBarras.textContent = `${mm(datos.tramos.reduce((s, t) => s + t.metrosBarra, 0))} ya segmentada`;
    els.fNota.textContent = "En verde, todo lo que sale del taller. Tocá un número o abrí el menú para ver un tramo.";
    els.fNota.hidden = false;
  } else {
    els.fTitulo.textContent = "Montaje in situ";
    els.fFila.textContent = "Vanos sin prefabricar";
    els.fLargo.textContent = mm(r.perimetro - r.metrosTaller);
    els.fVanos.textContent = "—";
    els.fPostes.textContent = `${datos.insitu.postes.length} postes`;
    els.fZapatas.textContent = listaTipos(r.zapatas);
    els.fBarras.textContent = `${datos.insitu.barras.length} barras`;
    els.fNota.textContent = "En azul, lo que se arma en obra: los vanos de cierre y el portón. Las 26 zapatas son todas de obra.";
    els.fNota.hidden = false;
  }
  els.ficha.classList.add('colapsada');
  els.ficha.hidden = false;
}

function mostrarFichaFamilias(cantidad) {
  els.fTitulo.textContent = "Filtro por familia";
  els.fFila.textContent = [...familiasActivas].map((c) => c.split("::")[1]).join(", ");
  els.fLargo.textContent = "—";
  els.fVanos.textContent = "—";
  els.fPostes.textContent = `${cantidad} elementos resaltados`;
  els.fZapatas.textContent = "—";
  els.fBarras.textContent = "—";
  els.fNota.hidden = true;
  els.ficha.hidden = false;
}

function ocultarFicha() {
  els.ficha.hidden = true;
}

function mostrarAviso(texto) {
  els.aviso.textContent = texto;
  els.aviso.hidden = false;
  setTimeout(() => (els.aviso.hidden = true), 5000);
}

function actualizarURL() {
  const url = new URL(window.location.href);
  if (tramoActivo) url.searchParams.set("t", String(tramoActivo));
  else url.searchParams.delete("t");
  if (vista !== "taller") url.searchParams.set("v", vista);
  else url.searchParams.delete("v");
  window.history.replaceState(null, "", url);
}

function abrirMenu() {
  els.menuBackdrop.hidden = false;
  els.menuPanel.classList.add("open");
}

function cerrarMenu() {
  els.menuBackdrop.hidden = true;
  els.menuPanel.classList.remove("open");
}

async function vistaPlanta() {
  const box = await model.getMergedBox(todosLosIds);
  const c = new THREE.Vector3();
  const s = new THREE.Vector3();
  box.getCenter(c);
  box.getSize(s);
  const alto = Math.max(s.x, s.y, s.z) * 1.1;
  const arriba = ejesModelo.alto;
  const destino = c.clone();
  destino.setComponent(arriba, c.getComponent(arriba) + alto);
  await controls.setLookAt(destino.x, destino.y, destino.z, c.x, c.y, c.z, true);
}

async function toggleTerreno() {
  terrenoVisible = !terrenoVisible;
  els.btnTerreno.classList.toggle("activo", terrenoVisible);
  if (terrenoIds.length) {
    await model.setVisible(terrenoIds, terrenoVisible);
    await fragments.update(true);
  } else {
    mostrarAviso("El modelo no trae sólido topográfico");
  }
}

function initUI() {
  els.menuToggle.addEventListener("click", () => {
    if (els.menuPanel.classList.contains("open")) cerrarMenu();
    else abrirMenu();
  });
  els.menuClose.addEventListener("click", cerrarMenu);
  els.menuBackdrop.addEventListener("click", cerrarMenu);
  els.fichaToggle.addEventListener("click", () => els.ficha.classList.toggle("colapsada"));
  els.isoBtn.addEventListener("click", toggleAislado);
  els.btnPlanta.addEventListener("click", vistaPlanta);
  els.btnTerreno.addEventListener("click", toggleTerreno);
  els.vistas.forEach((b) => b.addEventListener("click", () => aplicarVista(b.dataset.vista)));
}

// --- Arranque ---------------------------------------------------------------
async function main() {
  initScene();
  initUI();
  await initFragments();

  await calcularEjes();
  datos = await (await fetch(TRAMOS_URL)).json();
  await resolverGuids();
  construirPanel();
  await construirOverlays();

  const params = new URLSearchParams(window.location.search);
  const vistaURL = params.get("v");
  const tramoURL = Number(params.get("t"));

  if (["taller", "obra", "todo"].includes(vistaURL)) vista = vistaURL;
  await aplicarVista(vista);

  if (tramoURL && datos.tramos.some((t) => t.id === tramoURL)) {
    await seleccionarTramo(tramoURL);
  }

  els.loading.hidden = true;
}

main().catch((err) => {
  console.error(err);
  els.loading.textContent = "Error cargando el modelo. Reintentá con conexión.";
});

// Service worker (cache offline). Igual que en el visor de soporte de barras:
// si ya había una versión cacheada controlando la página, al entrar una nueva
// se recarga una sola vez para no quedar mostrando la anterior.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const habiaControlador = Boolean(navigator.serviceWorker.controller);
    let recargando = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!habiaControlador || recargando) return;
      recargando = true;
      window.location.reload();
    });
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
