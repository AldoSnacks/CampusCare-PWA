/* =========================================================
   Vistas generadas del lado del servidor (SSR)
   El servidor consulta SQLite, arma el HTML completo y lo
   envía listo para mostrarse. Funcionan aunque el navegador
   tenga JavaScript desactivado y se pueden compartir por URL.
     /estado            Estado público del campus + mapa de calor
     /reporte/:folio    Seguimiento público de un reporte
   ========================================================= */
'use strict';
const { conexion, aMs } = require('./db');

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FLUJO = ['Abierto', 'Asignado', 'En Proceso', 'Resuelto', 'Cerrado'];
const PERIODOS = { '7': 7, '30': 30, 'todo': null };

/* ---------- Datos agregados (también se exponen como JSON) ---------- */
function mapaCalor(periodo = 'todo') {
  const db = conexion();
  const dias = PERIODOS[periodo] ?? null;
  const filtro = dias ? `AND t.creado_en >= datetime('now', 'localtime', '-${dias} days')` : '';
  const edificios = db.prepare('SELECT id, nombre FROM edificios ORDER BY id').all();
  const categorias = db.prepare('SELECT nombre FROM categorias ORDER BY id').all().map(c => c.nombre);
  const niveles = db.prepare('SELECT edificio_id, clave, nombre FROM niveles ORDER BY edificio_id, id').all();

  const porCategoria = db.prepare(`
    SELECT n.edificio_id AS edificio, c.nombre AS categoria, COUNT(*) AS total
    FROM tickets t
    JOIN espacios e ON e.id = t.espacio_id
    JOIN niveles n ON n.id = e.nivel_id
    JOIN categorias c ON c.id = t.categoria_id
    WHERE t.estado <> 'Rechazado' ${filtro}
    GROUP BY n.edificio_id, c.nombre`).all();
  const porNivel = db.prepare(`
    SELECT n.edificio_id AS edificio, n.clave AS nivel, COUNT(*) AS total
    FROM tickets t
    JOIN espacios e ON e.id = t.espacio_id
    JOIN niveles n ON n.id = e.nivel_id
    WHERE t.estado <> 'Rechazado' ${filtro}
    GROUP BY n.edificio_id, n.clave`).all();

  const clavesNivel = [...new Set(niveles.map(n => n.clave))];
  const nombreNivel = Object.fromEntries(niveles.map(n => [n.clave, n.nombre]));
  const matrizCat = edificios.map(ed => categorias.map(cat => porCategoria.find(x => x.edificio === ed.id && x.categoria === cat)?.total || 0));
  const matrizNiv = edificios.map(ed => clavesNivel.map(cl => {
    if (!niveles.some(n => n.edificio_id === ed.id && n.clave === cl)) return null; // el nivel no existe en ese edificio
    return porNivel.find(x => x.edificio === ed.id && x.nivel === cl)?.total || 0;
  }));
  return {
    periodo, generado: Date.now(),
    edificios: edificios.map(e => ({ id: e.id, nombre: e.nombre })),
    categoria: { columnas: categorias, matriz: matrizCat },
    nivel: { columnas: clavesNivel.map(c => nombreNivel[c] || c), matriz: matrizNiv },
    total: matrizCat.flat().reduce((a, b) => a + b, 0)
  };
}

function resumenPublico() {
  const db = conexion();
  const r = db.prepare(`
    SELECT COUNT(*) AS atendidos,
           SUM(CASE WHEN (julianday(r.resuelto_en) - julianday(t.creado_en)) * 24 <= s.sla_horas THEN 1 ELSE 0 END) AS a_tiempo,
           AVG((julianday(r.resuelto_en) - julianday(t.creado_en)) * 24) AS mttr
    FROM resoluciones r JOIN tickets t ON t.id = r.ticket_id JOIN severidades s ON s.nombre = t.severidad`).get();
  const estados = db.prepare('SELECT estado, COUNT(*) AS n FROM tickets GROUP BY estado').all();
  return {
    atendidos: r.atendidos,
    sla: r.atendidos ? Math.round((r.a_tiempo || 0) / r.atendidos * 100) : 0,
    mttr: r.mttr ? Math.round(r.mttr * 10) / 10 : 0,
    estados: Object.fromEntries(estados.map(e => [e.estado, e.n])),
    edificios: db.prepare('SELECT COUNT(*) AS n FROM edificios').get().n
  };
}

/* ---------- Plantilla común ---------- */
function pagina(titulo, cuerpo) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#065f46">
  <title>${esc(titulo)} · CampusCare</title>
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" href="/icons/icon-192.png">
  <link rel="stylesheet" href="/ssr.css">
</head>
<body>
  <header class="ssr-top">
    <a class="ssr-brand" href="/"><img src="/icons/icon-192.png" alt=""><span><strong>CampusCare</strong><small>Mantenimiento universitario</small></span></a>
    <a class="ssr-btn" href="/">Abrir la aplicación</a>
  </header>
  <main class="ssr-main">${cuerpo}</main>
  <footer class="ssr-foot">Página generada en el servidor (Node.js + Express + SQLite) el ${new Date().toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' })}</footer>
  <script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');</script>
</body>
</html>`;
}

function tablaCalor(titulo, columnas, filas, edificios) {
  const max = Math.max(1, ...filas.flat().filter(v => v != null));
  const celda = v => {
    if (v == null) return '<td class="hm-na" title="No existe">—</td>';
    const a = 0.07 + 0.88 * v / max;
    return `<td style="background:rgba(5,150,105,${a.toFixed(2)});color:${a > 0.55 ? '#fff' : '#064e3b'}">${v}</td>`;
  };
  return `<div class="ssr-card"><h3>${esc(titulo)}</h3><div class="ssr-scroll"><table class="hm">
    <thead><tr><th>Edificio</th>${columnas.map(c => `<th>${esc(c)}</th>`).join('')}<th>Total</th></tr></thead>
    <tbody>${edificios.map((ed, i) => `<tr><th>${esc(ed.nombre)}</th>${filas[i].map(celda).join('')}<td class="hm-tot">${filas[i].reduce((a, b) => a + (b || 0), 0)}</td></tr>`).join('')}</tbody>
  </table></div><p class="ssr-legend"><span>Menos</span><i style="opacity:.15"></i><i style="opacity:.45"></i><i style="opacity:.75"></i><i></i><span>Más</span></p></div>`;
}

/* ---------- /estado ---------- */
function paginaEstado(periodo = 'todo') {
  if (!(periodo in PERIODOS)) periodo = 'todo';
  const m = mapaCalor(periodo);
  const r = resumenPublico();
  const activos = ['Abierto', 'Asignado', 'En Proceso'].reduce((a, e) => a + (r.estados[e] || 0), 0);
  const filtros = [['7', '7 días'], ['30', '30 días'], ['todo', 'Histórico']]
    .map(([k, l]) => `<a class="ssr-chip ${k === periodo ? 'on' : ''}" href="/estado?periodo=${k}">${l}</a>`).join('');
  return pagina('Estado del campus', `
    <section class="ssr-hero">
      <span class="ssr-pill">Vista generada por el servidor</span>
      <h1>Estado del campus</h1>
      <p>Resumen público de las incidencias de infraestructura y mapa de calor de incidencias recurrentes por edificio.</p>
    </section>
    <section class="ssr-kpis">
      <div><strong>${activos}</strong><span>Reportes activos</span></div>
      <div><strong>${r.atendidos}</strong><span>Reportes atendidos</span></div>
      <div><strong>${r.sla}%</strong><span>Dentro de SLA</span></div>
      <div><strong>${r.mttr} h</strong><span>Tiempo medio de resolución</span></div>
    </section>
    <nav class="ssr-filtros">${filtros}</nav>
    ${tablaCalor('Mapa de calor · Edificio × Categoría', m.categoria.columnas, m.categoria.matriz, m.edificios)}
    ${tablaCalor('Mapa de calor · Edificio × Nivel', m.nivel.columnas, m.nivel.matriz, m.edificios)}
    <div class="ssr-card"><h3>Reportes por estado</h3><ul class="ssr-estados">
      ${['Abierto', 'Asignado', 'En Proceso', 'Resuelto', 'Cerrado', 'Rechazado'].map(e => `<li><span>${e}</span><b>${r.estados[e] || 0}</b></li>`).join('')}
    </ul></div>
    <form class="ssr-card ssr-buscar" action="/reporte" method="get">
      <h3>Seguimiento de un reporte</h3>
      <label>Folio <input name="folio" placeholder="CC-1001" required pattern="[Cc][Cc]-\\d+"></label>
      <button class="ssr-btn">Consultar</button>
    </form>`);
}

/* ---------- /reporte/:folio ---------- */
function paginaReporte(folio) {
  const db = conexion();
  folio = String(folio || '').toUpperCase();
  const t = db.prepare(`
    SELECT t.id, t.folio, t.estado, t.severidad, t.activo, t.creado_en, t.actualizado_en, t.latitud, t.longitud,
           e.nombre AS espacio, n.nombre AS nivel, ed.nombre AS edificio, c.nombre AS categoria, s.sla_horas
    FROM tickets t
    JOIN espacios e ON e.id = t.espacio_id JOIN niveles n ON n.id = e.nivel_id
    JOIN edificios ed ON ed.id = n.edificio_id JOIN categorias c ON c.id = t.categoria_id
    JOIN severidades s ON s.nombre = t.severidad
    WHERE t.folio = ?`).get(folio);
  if (!t) return { status: 404, html: pagina('Reporte no encontrado', `<section class="ssr-hero"><h1>Reporte no encontrado</h1><p>No existe un reporte con el folio <b>${esc(folio)}</b>.</p><p><a class="ssr-btn" href="/estado">Volver al estado del campus</a></p></section>`) };
  // Solo cambios de estado y fechas: sin nombres ni notas personales
  const historial = db.prepare('SELECT estado_nuevo, fecha FROM historial_estados WHERE ticket_id = ? ORDER BY fecha, id').all(t.id);
  const paso = t.estado === 'Rechazado' ? -1 : FLUJO.indexOf(t.estado);
  const fmt = f => new Date(aMs(f)).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  return { status: 200, html: pagina(`Reporte ${t.folio}`, `
    <section class="ssr-hero">
      <span class="ssr-pill">Seguimiento público · vista del servidor</span>
      <h1>Reporte ${esc(t.folio)}</h1>
      <p>${esc(t.categoria)} · ${esc(t.activo)} — ${esc(t.edificio)}, ${esc(t.nivel)}, ${esc(t.espacio)}</p>
    </section>
    <div class="ssr-card">
      <div class="ssr-estado ${t.estado === 'Rechazado' ? 'rech' : ''}">Estado actual: <b>${esc(t.estado)}</b></div>
      <ol class="ssr-pasos">${FLUJO.map((e, i) => `<li class="${i <= paso ? 'ok' : ''}">${e}</li>`).join('')}</ol>
      <dl class="ssr-datos">
        <div><dt>Severidad</dt><dd>${esc(t.severidad)} (atención en ${t.sla_horas} h)</dd></div>
        <div><dt>Registrado</dt><dd>${fmt(t.creado_en)}</dd></div>
        <div><dt>Última actualización</dt><dd>${fmt(t.actualizado_en)}</dd></div>
        ${t.latitud != null ? `<div><dt>Ubicación GPS</dt><dd><a href="https://www.openstreetmap.org/?mlat=${t.latitud}&mlon=${t.longitud}#map=19/${t.latitud}/${t.longitud}" target="_blank" rel="noopener">${t.latitud}, ${t.longitud}</a></dd></div>` : ''}
      </dl>
    </div>
    <div class="ssr-card"><h3>Historial</h3><ul class="ssr-hist">
      ${historial.map(h => `<li><b>${esc(h.estado_nuevo)}</b><span>${fmt(h.fecha)}</span></li>`).join('')}
    </ul></div>
    <p><a class="ssr-btn ghost" href="/estado">Ver el estado del campus</a></p>`) };
}

module.exports = { mapaCalor, resumenPublico, paginaEstado, paginaReporte };
