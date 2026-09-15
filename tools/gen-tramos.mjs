// Genera tramos.json: qué elemento del IFC pertenece a cada tramo del cercado.
//
// Uso: node tools/gen-tramos.mjs
//
// Los 10 tramos son los que se fabrican en taller, numerados según el croquis
// de obra. Se definen por el eje de sus postes extremos (en metros, en las
// coordenadas compartidas del modelo) y de ahí se resuelve por geometría qué
// postes, barras y zapatas les corresponden. El visor solo lee el JSON.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { leerIFC } from "./ifc-lite.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const IFC = path.resolve(root, "..", "Cercado-ZUNZ.ifc");
const SALIDA = path.join(root, "tramos.json");

// Las tres corridas del cercado. "eje" es la coordenada constante.
const FILAS = {
  A: { desc: "Fila norte", coordFija: "y", eje: 3.03, avance: "x" },
  B: { desc: "Fila sur", coordFija: "y", eje: -6.07, avance: "x" },
  L: { desc: "Lateral este", coordFija: "x", eje: 18.104, avance: "y" },
};

// desde/hasta = eje de los postes extremos del tramo.
const TRAMOS = [
  { id: 1, fila: "B", desde: -9.286, hasta: -6.386 },
  { id: 2, fila: "B", desde: -6.286, hasta: -3.386 },
  { id: 3, fila: "B", desde: -3.286, hasta: -0.386 },
  { id: 4, fila: "B", desde: -0.286, hasta: 4.164 },
  { id: 5, fila: "B", desde: 6.274, hasta: 9.224 },
  { id: 6, fila: "B", desde: 9.224, hasta: 12.224 },
  { id: 7, fila: "B", desde: 12.224, hasta: 15.174 },
  { id: 8, fila: "L", desde: -6.07, hasta: 3.03 },
  { id: 9, fila: "A", desde: 7.804, hasta: 16.904 },
  { id: 10, fila: "A", desde: -3.576, hasta: 4.784 },
];

const TOL_POSTE = 0.02; // los ejes salen exactos del modelo
const TOL_BARRA = 0.08; // la barra arranca unos mm adentro del eje del poste
const TOL_ZAPATA = 0.35; // la zapata compartida de una separación queda 50 mm corrida

const elementos = leerIFC(IFC);

const clasificar = (e) => {
  if (e.ifc === "IFCSLAB") return "zapata";
  if (e.ifc === "IFCCOLUMN") return "poste";
  if (e.ifc === "IFCBEAM") return "barra";
  return "otro";
};

// Coordenada de avance (la que corre a lo largo de la fila) y coordenada fija.
const avanceDe = (fila, p) => (FILAS[fila].avance === "x" ? p[0] : p[1]);
const fijaDe = (fila, p) => (FILAS[fila].coordFija === "x" ? p[0] : p[1]);

function enFila(e, fila) {
  const f = FILAS[fila];
  const cerca = (p) => Math.abs(fijaDe(fila, p) - f.eje) < 0.2;
  return cerca(e.a) && cerca(e.b);
}

const postes = elementos.filter((e) => clasificar(e) === "poste");
const barras = elementos.filter((e) => clasificar(e) === "barra");
const zapatas = elementos.filter((e) => clasificar(e) === "zapata");

const asignado = new Set();
const salida = { tramos: [], insitu: {}, catalogo: {}, resumen: {} };

for (const t of TRAMOS) {
  const ini = Math.min(t.desde, t.hasta);
  const fin = Math.max(t.desde, t.hasta);
  const dentro = (v, tol) => v >= ini - tol && v <= fin + tol;

  const tPostes = postes
    .filter((e) => enFila(e, t.fila) && dentro(avanceDe(t.fila, e.a), TOL_POSTE))
    .sort((p, q) => avanceDe(t.fila, p.a) - avanceDe(t.fila, q.a));

  // Una barra entra al tramo solo si está contenida entera. Las corridas
  // continuas (la de 24,92 m de la fila norte) no pertenecen a ningún tramo:
  // en obra se cortan, y el visor las marca aparte.
  const tBarras = barras.filter(
    (e) => enFila(e, t.fila) &&
      dentro(avanceDe(t.fila, e.a), TOL_BARRA) &&
      dentro(avanceDe(t.fila, e.b), TOL_BARRA),
  );

  const tZapatas = zapatas
    .filter((e) => Math.abs(fijaDe(t.fila, e.a) - FILAS[t.fila].eje) < 0.4 && dentro(avanceDe(t.fila, e.a), TOL_ZAPATA))
    .sort((p, q) => avanceDe(t.fila, p.a) - avanceDe(t.fila, q.a));

  tPostes.forEach((e) => asignado.add(e.guid));
  tBarras.forEach((e) => asignado.add(e.guid));

  const ejes = tPostes.map((e) => Math.round(avanceDe(t.fila, e.a) * 1000));
  const vanos = ejes.slice(1).map((v, i) => v - ejes[i]);
  const cuenta = (arr, key) => arr.reduce((acc, e) => ((acc[e[key]] = (acc[e[key]] ?? 0) + 1), acc), {});

  salida.tramos.push({
    id: t.id,
    fila: t.fila,
    filaDesc: FILAS[t.fila].desc,
    largo: Math.round((fin - ini) * 1000),
    vanos,
    postes: tPostes.map((e) => e.guid),
    barras: tBarras.map((e) => e.guid),
    zapatas: tZapatas.map((e) => e.guid),
    tubosPorTipo: cuenta(tPostes, "perfil"),
    zapatasPorTipo: cuenta(tZapatas, "perfil"),
    metrosBarra: Math.round(tBarras.reduce((s, e) => s + e.largo, 0) * 1000),
    // Caja envolvente del tramo, para el resaltado y el rótulo 3D.
    caja: {
      eje: FILAS[t.fila].eje,
      dir: FILAS[t.fila].avance,
      ini: Math.min(t.desde, t.hasta),
      fin: Math.max(t.desde, t.hasta),
    },
  });
}

// Barras que no quedaron contenidas en un tramo pero lo cruzan: son las
// corridas continuas del modelo (la de 24,92 m de la fila norte y la de
// 8,90 m de la sur). No son "in situ": el taller las corta a la medida de
// cada tramo. Se listan aparte para poder avisarlo en el visor.
const continuas = [];
const barrasSueltas = [];
for (const e of barras.filter((b) => !asignado.has(b.guid))) {
  const cruza = salida.tramos.filter((t) => {
    if (!enFila(e, t.fila)) return false;
    const va = avanceDe(t.fila, e.a), vb = avanceDe(t.fila, e.b);
    return Math.max(va, vb) > t.caja.ini + TOL_BARRA && Math.min(va, vb) < t.caja.fin - TOL_BARRA;
  });
  if (cruza.length) continuas.push({ guid: e.guid, largo: mmDe(e.largo), tramos: cruza.map((t) => t.id) });
  else barrasSueltas.push(e.guid);
}

// Todo lo que no cayó en un tramo ni es corrida continua se arma en obra.
salida.insitu = {
  postes: postes.filter((e) => !asignado.has(e.guid)).map((e) => e.guid),
  barras: barrasSueltas,
};
salida.barrasContinuas = continuas;

// Catálogo para los filtros por nombre de familia (zapatas y tubos).
const agrupar = (arr) => arr.reduce((acc, e) => ((acc[e.perfil] ??= []).push(e.guid), acc), {});
salida.catalogo = {
  zapatas: agrupar(zapatas),
  tubos: agrupar(postes),
  barras: agrupar(barras),
};

// El sólido topográfico del Revit es un bloque de 33,6 x 11,9 x 1,2 m que
// entierra las zapatas. El visor lo arranca oculto, con un botón para verlo.
salida.terreno = elementos
  .filter((e) => e.ifc === "IFCBUILDINGELEMENTPROXY")
  .map((e) => e.guid);

const mm = (m) => Math.round(m * 1000);
function mmDe(m) { return Math.round(m * 1000); }
salida.resumen = {
  totalTramos: salida.tramos.length,
  metrosTaller: salida.tramos.reduce((s, t) => s + t.largo, 0),
  perimetro:
    mm(29.94) + mm(30.71) + mm(9.1),
  zapatas: Object.fromEntries(Object.entries(agrupar(zapatas)).map(([k, v]) => [k, v.length])),
  postes: Object.fromEntries(Object.entries(agrupar(postes)).map(([k, v]) => [k, v.length])),
};

fs.writeFileSync(SALIDA, JSON.stringify(salida, null, 1));

console.log(`Elementos leídos: ${elementos.length}`);
console.log(`Escrito: ${SALIDA}`);
for (const t of salida.tramos) {
  console.log(
    `  Tramo ${String(t.id).padStart(2)} | ${t.filaDesc.padEnd(12)} | ${String(t.largo).padStart(5)} mm | ` +
    `${t.postes.length} postes | ${t.barras.length} barras | ${t.zapatas.length} zapatas | vanos ${t.vanos.join("+") || "-"}`,
  );
}
console.log(`In situ: ${salida.insitu.postes.length} postes, ${salida.insitu.barras.length} barras`);
console.log("Resumen:", salida.resumen);
