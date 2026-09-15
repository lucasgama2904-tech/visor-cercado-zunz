// Stub vacío para "web-ifc" en el bundle del navegador.
//
// @thatopen/fragments importa web-ifc a nivel de módulo (para IfcImporter),
// pero el visor nunca convierte IFC en el navegador — eso ya se hizo una vez
// en tools/convert-ifc.mjs, en Node. web-ifc real pesa >3 MB; este stub evita
// que ese peso viaje al celular sin usarse.
export default {};
