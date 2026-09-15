// Convierte el IFC del modelo a formato Fragments (.frag).
// Uso: node tools/convert-ifc.mjs
//
// El IFC crudo (~9 MB) tarda demasiado en parsear en un celular. Convertido a
// Fragments baja a un par de MB y carga casi instantáneo. Este script se
// corre UNA VEZ en la PC; el visor web nunca necesita parsear IFC.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { IfcImporter } from "@thatopen/fragments";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const IFC_PATH = path.resolve(root, "..", "Cercado-ZUNZ.ifc");
const OUT_PATH = path.join(root, "web", "modelo.frag");

async function convert() {
  if (!fs.existsSync(IFC_PATH)) {
    console.error(`No se encontró el IFC en: ${IFC_PATH}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

  const serializer = new IfcImporter();
  // Ruta a los .wasm de web-ifc instalados en node_modules
  serializer.wasm.path = path.join(root, "node_modules", "web-ifc") + path.sep;
  serializer.wasm.absolute = true;

  console.log(`Leyendo IFC: ${IFC_PATH}`);
  const stat = fs.statSync(IFC_PATH);
  console.log(`Tamaño: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);

  let fileFinishedReading = false;
  let previousOffset = -1;
  const input = fs.openSync(IFC_PATH, "r");

  const readCallback = (offset, size) => {
    if (!fileFinishedReading) {
      if (offset < previousOffset) {
        fileFinishedReading = true;
        console.log("Lectura del IFC terminada. Iniciando conversión a Fragments...");
      }
      previousOffset = offset;
    }
    const data = new Uint8Array(size);
    const bytesRead = fs.readSync(input, data, 0, size, offset);
    if (bytesRead <= 0) return new Uint8Array(0);
    return data;
  };

  const t0 = Date.now();
  const exported = await serializer.process({
    readFromCallback: true,
    readCallback,
    raw: false,
  });
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);

  fs.writeFileSync(OUT_PATH, exported);
  fs.closeSync(input);

  const outSize = fs.statSync(OUT_PATH).size;
  console.log(`Conversión completa en ${seconds}s`);
  console.log(`Fragments generado: ${OUT_PATH}`);
  console.log(`Tamaño: ${(outSize / 1024 / 1024).toFixed(2)} MB`);
}

convert().catch((err) => {
  console.error("Error convirtiendo IFC a Fragments:", err);
  process.exit(1);
});
