// Lector mínimo de IFC2x3 para este modelo puntual (cercado ZUNZ).
//
// No pretende ser un parser completo: el cercado es todo IfcExtrudedAreaSolid
// sobre perfiles rectangulares (zapatas) y circulares/huecos (tubos), así que
// alcanza con resolver la cadena de IfcLocalPlacement y devolver, por cada
// elemento, su punto de arranque, su dirección de extrusión y su largo.
//
// Se usa solo en la PC, para generar tramos.json. El visor nunca parsea IFC.

import * as fs from "node:fs";

export function leerIFC(rutaIFC) {
  const raw = fs.readFileSync(rutaIFC, "latin1");

  const ent = {};
  const lineRe = /^#(\d+)= *([A-Z0-9_]+)\((.*)\);\s*$/;
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(lineRe);
    if (m) ent[+m[1]] = { type: m[2], raw: m[3] };
  }

  const argCache = {};
  const A = (id) => (argCache[id] ??= splitArgs(ent[id].raw));
  const ref = (t) => (t && t[0] === "#" ? +t.slice(1) : null);
  const listRefs = (t) => (String(t).match(/#\d+/g) || []).map((x) => +x.slice(1));
  const cartesian = (id) => ent[id].raw.replace(/[()]/g, "").split(",").map(Number);

  function axis3d(id) {
    const a = A(id);
    const loc = cartesian(ref(a[0]));
    let z = a[1] !== "$" ? cartesian(ref(a[1])) : [0, 0, 1];
    let x = a[2] !== "$" ? cartesian(ref(a[2])) : null;
    z = norm(z);
    if (!x) {
      // Sin refDirection, IFC toma el eje X global salvo que sea paralelo a Z.
      const tmp = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      x = ortogonal(tmp, z);
    } else {
      x = ortogonal(x, z);
    }
    const y = cross(z, x);
    return [
      x[0], y[0], z[0], loc[0],
      x[1], y[1], z[1], loc[1],
      x[2], y[2], z[2], loc[2],
      0, 0, 0, 1,
    ];
  }

  function axis2d(id) {
    const a = A(id);
    const loc = cartesian(ref(a[0]));
    const x = norm(a[1] !== "$" ? cartesian(ref(a[1])) : [1, 0]);
    return [
      x[0], -x[1], 0, loc[0],
      x[1], x[0], 0, loc[1],
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
  }

  function placement(id) {
    const a = A(id);
    const padre = ref(a[0]);
    const rel = axis3d(ref(a[1]));
    return padre ? mul(placement(padre), rel) : rel;
  }

  function perfil(id) {
    const e = ent[id], a = A(id);
    const nombre = a[1] === "$" ? "" : decode(a[1]);
    const pos = ref(a[2]);
    if (e.type === "IFCRECTANGLEPROFILEDEF")
      return { tipo: "rect", nombre, pos, xdim: +a[3], ydim: +a[4] };
    if (e.type === "IFCCIRCLEPROFILEDEF")
      return { tipo: "circulo", nombre, pos, r: +a[3] };
    if (e.type === "IFCCIRCLEHOLLOWPROFILEDEF")
      return { tipo: "tubo", nombre, pos, r: +a[3], espesor: +a[4] };
    return { tipo: e.type, nombre, pos };
  }

  function solidos(repId, mat) {
    const out = [];
    const rep = ent[repId];
    if (!rep) return out;

    if (rep.type === "IFCSHAPEREPRESENTATION") {
      const a = A(repId);
      const idf = decode(a[1]);
      if (idf === "Box" || idf === "Axis" || idf === "FootPrint") return out;
      for (const it of listRefs(a[3])) out.push(...solidos(it, mat));
      return out;
    }

    if (rep.type === "IFCMAPPEDITEM") {
      const a = A(repId);
      const mapa = A(ref(a[0]));
      const op = A(ref(a[1]));
      let opMat = IDENT.slice();
      if (op[2] && op[2] !== "$") {
        const o = cartesian(ref(op[2]));
        opMat = [1, 0, 0, o[0], 0, 1, 0, o[1], 0, 0, 1, o[2], 0, 0, 0, 1];
      }
      const esc = op[3] && op[3] !== "$" ? +op[3] : 1;
      if (esc !== 1) opMat = mul(opMat, [esc, 0, 0, 0, 0, esc, 0, 0, 0, 0, esc, 0, 0, 0, 0, 1]);
      const m = mul(mul(mat, opMat), axis3d(ref(mapa[0])));
      out.push(...solidos(ref(mapa[1]), m));
      return out;
    }

    if (rep.type === "IFCEXTRUDEDAREASOLID") {
      const a = A(repId);
      const p = perfil(ref(a[0]));
      let m = mul(mat, a[1] !== "$" ? axis3d(ref(a[1])) : IDENT);
      if (p.pos) m = mul(m, axis2d(p.pos));
      out.push({ perfil: p, mat: m, dir: cartesian(ref(a[2])), largo: +a[3] });
      return out;
    }

    return out;
  }

  const TIPOS = ["IFCCOLUMN", "IFCBEAM", "IFCSLAB", "IFCFOOTING", "IFCMEMBER", "IFCPLATE", "IFCBUILDINGELEMENTPROXY"];
  const elementos = [];
  for (const idS of Object.keys(ent)) {
    const e = ent[idS];
    if (!TIPOS.includes(e.type)) continue;
    const a = A(+idS);
    const mat = ref(a[5]) ? placement(ref(a[5])) : IDENT;
    const shape = ref(a[6]);
    const geo = [];
    if (shape) for (const r of listRefs(A(shape)[2])) geo.push(...solidos(r, mat));
    if (!geo.length) continue;

    const s = geo[0];
    const a0 = punto(s.mat, [0, 0, 0]);
    const a1 = punto(s.mat, [s.dir[0] * s.largo, s.dir[1] * s.largo, s.dir[2] * s.largo]);
    elementos.push({
      ifc: e.type,
      guid: decode(a[0]),
      nombre: decode(a[2]),
      tag: decode(a[7] ?? "''"),
      perfil: s.perfil.nombre,
      radio: s.perfil.r ?? null,
      lados: s.perfil.xdim ? [s.perfil.xdim, s.perfil.ydim] : null,
      a: a0.map(r3),
      b: a1.map(r3),
      largo: r3(s.largo),
    });
  }
  return elementos;
}

// --- utilidades ---------------------------------------------------------
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const r3 = (n) => Math.round(n * 1000) / 1000;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
const ortogonal = (v, z) => { const d = v[0] * z[0] + v[1] * z[1] + (v[2] ?? 0) * z[2]; return norm([v[0] - d * z[0], v[1] - d * z[1], (v[2] ?? 0) - d * z[2]]); };

function mul(a, b) {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j];
    r[i * 4 + j] = s;
  }
  return r;
}
function punto(m, p) {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}
function splitArgs(s) {
  const out = [];
  let depth = 0, cur = "", instr = false;
  for (const c of s) {
    if (instr) { cur += c; if (c === "'") instr = false; continue; }
    if (c === "'") { instr = true; cur += c; continue; }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}
function decode(s) {
  return String(s)
    .replace(/^'|'$/g, "")
    .replace(/\\X\\([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/g, (_, h) =>
      h.match(/.{4}/g).map((x) => String.fromCharCode(parseInt(x, 16))).join(""));
}
