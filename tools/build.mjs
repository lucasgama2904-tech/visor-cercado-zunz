// Empaqueta el visor: src/app.js -> web/app.bundle.js
// y copia a web/ el worker de fragments y el mapeo de tramos.
//
// Uso: node tools/build.mjs

import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

await esbuild.build({
  entryPoints: [path.join(root, "src", "app.js")],
  outfile: path.join(root, "web", "app.bundle.js"),
  bundle: true,
  format: "esm",
  target: "es2020",
  minify: true,
  sourcemap: false,
  logLevel: "info",
  // El visor nunca parsea IFC (eso ya se hizo en convert-ifc.mjs), pero
  // @thatopen/fragments importa "web-ifc" a nivel de módulo para su
  // IfcImporter. Sin este alias, ese import mete >3 MB sin usar en el bundle.
  alias: {
    "web-ifc": path.join(root, "tools", "stubs", "web-ifc-empty.mjs"),
  },
});

const copiar = (origen, destino) => {
  fs.copyFileSync(origen, destino);
  console.log(`Copiado: ${path.relative(root, destino)}`);
};

copiar(
  path.join(root, "node_modules", "@thatopen", "fragments", "dist", "Worker", "worker.min.mjs"),
  path.join(root, "web", "fragments-worker.mjs"),
);
copiar(path.join(root, "tramos.json"), path.join(root, "web", "tramos.json"));
