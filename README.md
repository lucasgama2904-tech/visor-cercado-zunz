# Visor de tramos — Cercado perimetral ZUNZ

Visor 3D del cercado perimetral de la obra ZUNZ (INGEPRO S.A.). Muestra, sobre
el modelo de Revit, cuáles son los 10 tramos que se prefabrican en taller y
cuáles son los vanos que se arman in situ, y permite filtrar por tramo, por
tipo de fundación (FA / FE / FC / FD) y por tipo de tubo (2" / 3" / 1" 1/4).

Sitio en vivo: https://lucasgama2904-tech.github.io/visor-cercado-zunz/

## Cubo de vistas

El control de arriba a la derecha funciona como el ViewCube de Revit: N, S, E
y O dan las cuatro elevaciones, Planta la vista cenital, y el botón 3D del
centro vuelve a la isométrica. Si hay un tramo abierto la vista se encuadra
sobre ese tramo y no sobre el cercado entero.

El norte verdadero es +Y en el IFC (`TrueNorth = (0,1)`), pero Fragments puede
remapear los ejes al convertir, así que el visor no lo supone: `tramos.json`
trae en `referencias` tres pares de piezas de orientación conocida y el visor
deduce el este, el norte y el vertical restando sus posiciones reales.

## Cómo está armado

El IFC exportado de Revit (`../Cercado-ZUNZ.ifc`, 150 KB) se convierte una vez
en la PC a formato Fragments (`web/modelo.frag`, 30 KB) para que el celular no
tenga que parsear IFC. La pertenencia de cada pieza a cada tramo se resuelve
por geometría y queda escrita en `tramos.json`.

- `tools/ifc-lite.mjs` — lector mínimo de IFC (solo lo que usa este modelo).
- `tools/gen-tramos.mjs` — genera `tramos.json` a partir del IFC.
- `tools/convert-ifc.mjs` — genera `web/modelo.frag`.
- `tools/build.mjs` — empaqueta `src/app.js` en `web/app.bundle.js`.

## Comandos

```
npm install
npm run tramos     # regenera tramos.json desde el IFC
npm run convert    # regenera web/modelo.frag desde el IFC
npm run build      # empaqueta el visor
npm run serve      # prueba local en http://localhost:8081/index.html
```

## Publicar

El sitio lo sirve GitHub Pages desde la rama `gh-pages`, que tiene el
**interior de `web/` en su raíz**. Pushear a `main` no actualiza el sitio:

```
npm run build
git add -A && git commit -m "..."
git push origin main
git subtree push --prefix web origin gh-pages
```

Al reemplazar `modelo.frag` o `tramos.json` en producción, subir la versión del
cache en `web/sw.js` (`const CACHE = "visor-cercado-vN"`) para forzar la
actualización en los celulares que ya lo tengan cacheado.

## Los 10 tramos

Numerados según el croquis de obra. Fila norte es la del portón.

| Tramo | Ubicación | Largo | Vanos (mm) |
|---|---|---|---|
| 1 | Fila sur | 2,90 m | 2900 |
| 2 | Fila sur | 2,90 m | 2900 |
| 3 | Fila sur | 2,90 m | 2900 |
| 4 | Fila sur | 4,45 m | 1450 + 3000 |
| 5 | Fila sur | 2,95 m | 2950 |
| 6 | Fila sur | 3,00 m | 3000 |
| 7 | Fila sur | 2,95 m | 2950 |
| 8 | Lateral este | 9,10 m | 3050 + 3000 + 3050 |
| 9 | Fila norte | 9,10 m | 3000 + 3000 + 3100 |
| 10 | Fila norte | 8,36 m | 3300 + 3000 + 2060 |

Total de taller: 48,61 m de los 69,75 m de perímetro. El resto (21,14 m,
incluido el portón) se arma in situ.

En la fila norte y en los tramos 4, 5, 6 y 7 las barras horizontales están
modeladas como una corrida continua: el taller las corta a la medida de cada
tramo, descontando la separación.
