/* =========================================================
   Código QR en SVG (sin dependencias externas)
   Usa la implementación de Kazuhiko Arase (licencia MIT)
   copiada en src/vendor/QRCode.
   ========================================================= */
'use strict';
const QRCode = require('./vendor/QRCode');
const NIVEL = require('./vendor/QRCode/QRErrorCorrectLevel');

function svg(texto, { margen = 4, color = '#0b3d2c', fondo = '#ffffff' } = {}) {
  const qr = new QRCode(-1, NIVEL.M);
  qr.addData(String(texto));
  qr.make();
  const n = qr.getModuleCount();
  const lado = n + margen * 2;
  let ruta = '';
  for (let f = 0; f < n; f++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(f, c)) ruta += `M${c + margen} ${f + margen}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges" role="img" aria-label="Código QR">` +
    `<rect width="${lado}" height="${lado}" fill="${fondo}"/><path d="${ruta}" fill="${color}"/></svg>`;
}

module.exports = { svg };
