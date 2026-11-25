/* =========================================================
   Auditoría de red Wi-Fi · Semáforo de aptitud académica
   Aportación de Carlos Manuel Ojeda Hernández
   ---------------------------------------------------------
   El navegador mide latencia, jitter, pérdida y velocidad.
   El servidor vuelve a calcular el semáforo con los mismos
   umbrales (no confía en lo que diga el cliente) y, si la red
   está degradada, puede escalar la medición a un ticket de
   la categoría Red/TI que también aparece en el mapa de calor.
   ========================================================= */
'use strict';
const { conexion, transaccion, fecha, aMs } = require('./db');
const { ErrorHttp } = require('./auth');
const { guardarFoto, borrarFotos } = require('./fotos');

/* Umbrales tomados del motor original (network-audit.js) */
function evaluar({ latencia_ms: lat, jitter_ms: jit, perdida_pct: per, velocidad_mbps: vel, sin_conexion }) {
  if (sin_conexion) {
    const sinRed = { nivel: 'critico', etiqueta: 'Sin red' };
    return { videollamadas: sinRed, git: sinRed, descargas: sinRed, degradada: true };
  }
  let videollamadas = { nivel: 'optimo', etiqueta: 'Apto' };
  if (per > 0 || lat > 250 || jit > 60 || vel < 1.5) videollamadas = { nivel: 'critico', etiqueta: 'No viable' };
  else if (lat > 120 || jit > 30 || vel < 4) videollamadas = { nivel: 'inestable', etiqueta: 'Inestable' };

  let git = { nivel: 'optimo', etiqueta: 'Fluido' };
  if (per > 0 || lat > 300 || vel < 0.8) git = { nivel: 'critico', etiqueta: 'Crítico' };
  else if (lat > 150 || jit > 40) git = { nivel: 'inestable', etiqueta: 'Lento' };

  let descargas = { nivel: 'optimo', etiqueta: 'Óptimo' };
  if (vel < 2) descargas = { nivel: 'critico', etiqueta: 'Muy lento' };
  else if (vel < 10) descargas = { nivel: 'inestable', etiqueta: 'Limitado' };

  return { videollamadas, git, descargas, degradada: lat > 200 || vel < 2 || per > 0 };
}

const NIVEL = { 'Apto': 'optimo', 'Fluido': 'optimo', 'Óptimo': 'optimo', 'Inestable': 'inestable', 'Lento': 'inestable', 'Limitado': 'inestable' };
const nivelDe = etiqueta => NIVEL[etiqueta] || 'critico';

const num = (v, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, min), max);
};

/* Lee y valida la medición que manda el navegador */
function leerMedicion(d) {
  const sin_conexion = d.sin_conexion || d.offline ? 1 : 0;
  const m = {
    sin_conexion,
    latencia_ms: sin_conexion ? null : Math.round(num(d.latencia_ms, 0, 60000) ?? 0),
    jitter_ms: sin_conexion ? null : Math.round(num(d.jitter_ms, 0, 60000) ?? 0),
    perdida_pct: sin_conexion ? 100 : Math.round(num(d.perdida_pct, 0, 100) ?? 0),
    velocidad_mbps: sin_conexion ? 0 : Math.round((num(d.velocidad_mbps, 0, 10000) ?? 0) * 100) / 100,
    tipo_conexion: String(d.tipo_conexion || (sin_conexion ? 'sin conexión' : 'wifi')).slice(0, 20)
  };
  const medido = d.medido_en ? new Date(d.medido_en).getTime() : Date.now();
  m.medido_en = fecha(Number.isFinite(medido) && medido <= Date.now() + 60000 ? medido : Date.now());
  return m;
}

/* Busca el espacio del catálogo (Edificio > Nivel > Espacio) */
function buscarEspacio(db, d) {
  if (!d.edificio || !d.nivel || !d.espacio) return null;
  return db.prepare(`
    SELECT e.id, e.nombre, n.clave, n.edificio_id FROM espacios e JOIN niveles n ON n.id = e.nivel_id
    WHERE n.edificio_id = ? AND n.clave = ? AND e.nombre = ?`).get(d.edificio, d.nivel, d.espacio) || null;
}

/* Guarda la medición y, si se pide, la escala a un ticket de Red/TI */
function registrar(usuario, d, notificar) {
  const db = conexion();
  const clienteId = d.clienteId ? String(d.clienteId).slice(0, 64) : null;
  if (clienteId) {
    const previa = db.prepare('SELECT a.id, t.folio FROM auditorias_red a LEFT JOIN tickets t ON t.id = a.ticket_id WHERE a.cliente_id = ? AND a.usuario_id = ?').get(clienteId, usuario.id);
    if (previa) return { id: previa.id, folio: previa.folio || null, repetida: true };
  }
  const m = leerMedicion(d);
  const apt = evaluar(m);
  const espacio = buscarEspacio(db, d);
  const ubicacion = espacio
    ? `Edif. ${espacio.edificio_id} · ${espacio.clave} · ${espacio.nombre}`
    : String(d.ubicacion || 'Zona Wi-Fi sin especificar').trim().slice(0, 120);
  const escalar = !!d.escalar;
  if (escalar && !apt.degradada) throw new ErrorHttp(400, 'La red está en buen estado; solo se escalan mediciones degradadas o zonas sin conexión.');
  if (escalar && !espacio) throw new ErrorHttp(400, 'Selecciona el edificio, nivel y espacio para generar el ticket de Red/TI.');

  // Imagen del ticket: la tarjeta de métricas que genera el navegador o la foto de la categoría
  const foto = escalar && d.foto ? guardarFoto(d.foto, 'red') : null;
  try {
    return transaccion(() => registrarEnBase(db, usuario, d, m, apt, espacio, ubicacion, escalar, foto || 'img/cat-red.jpg', clienteId, notificar));
  } catch (e) {
    borrarFotos(foto);
    throw e;
  }
}

function registrarEnBase(db, usuario, d, m, apt, espacio, ubicacion, escalar, foto, clienteId, notificar) {
  {
    let ticketId = null, folio = null;
    if (escalar) {
      const cat = db.prepare("SELECT id FROM categorias WHERE nombre = 'Red/TI'").get()
        || db.prepare("SELECT id FROM categorias WHERE nombre LIKE '%Red%' ORDER BY id LIMIT 1").get();
      if (!cat) throw new ErrorHttp(400, 'No existe la categoría Red/TI en el catálogo.');
      const severidad = m.sin_conexion || apt.videollamadas.etiqueta === 'No viable' ? 'Crítica' : 'Media';
      const descripcion = m.sin_conexion
        ? `[Zona muerta] Sin conexión a la red institucional en ${ubicacion}. Medido el ${m.medido_en}.`
        : `[Auditoría Wi-Fi] Latencia ${m.latencia_ms} ms · jitter ${m.jitter_ms} ms · pérdida ${m.perdida_pct}% · ${m.velocidad_mbps} Mbps (${m.tipo_conexion}). Videollamadas: ${apt.videollamadas.etiqueta}; Git/Cloud: ${apt.git.etiqueta}; descargas: ${apt.descargas.etiqueta}.`;
      const ahora = fecha();
      ticketId = Number(db.prepare(`INSERT INTO tickets
        (solicitante_id, espacio_id, activo, categoria_id, severidad, descripcion, foto, estado, origen, cliente_id, creado_en, actualizado_en)
        VALUES (?, ?, 'Access point Wi-Fi', ?, ?, ?, ?, 'Abierto', 'auditoria_red', ?, ?, ?)`)
        .run(usuario.id, espacio.id, cat.id, severidad, descripcion.slice(0, 500), foto, clienteId ? `red-${clienteId}` : null, ahora, ahora).lastInsertRowid);
      folio = db.prepare('SELECT folio FROM tickets WHERE id = ?').get(ticketId).folio;
      db.prepare('INSERT INTO historial_estados (ticket_id, estado_anterior, estado_nuevo, usuario_id, usuario_nombre, nota, fecha) VALUES (?, NULL, ?, ?, ?, ?, ?)')
        .run(ticketId, 'Abierto', usuario.id, usuario.nombre, 'Ticket generado desde la auditoría de red Wi-Fi', ahora);
      const admins = db.prepare("SELECT id FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id <> ?").all(usuario.id);
      const titulo = severidad === 'Crítica' ? `Alerta crítica de red ${folio}` : `Red degradada ${folio}`;
      for (const a of admins) notificar(db, a.id, ticketId, titulo, `${m.sin_conexion ? 'Zona muerta' : 'Wi-Fi degradado'} — ${ubicacion}`);
    }
    const id = Number(db.prepare(`INSERT INTO auditorias_red
      (usuario_id, espacio_id, ubicacion, latencia_ms, jitter_ms, perdida_pct, velocidad_mbps, tipo_conexion, sin_conexion,
       apt_videollamadas, apt_git, apt_descargas, degradada, ticket_id, cliente_id, medido_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(usuario.id, espacio?.id ?? null, ubicacion, m.latencia_ms, m.jitter_ms, m.perdida_pct, m.velocidad_mbps, m.tipo_conexion,
        m.sin_conexion, apt.videollamadas.etiqueta, apt.git.etiqueta, apt.descargas.etiqueta, apt.degradada ? 1 : 0, ticketId, clienteId, m.medido_en).lastInsertRowid);
    return { id, folio, aptitud: apt };
  }
}

/* Historial de mediciones: el admin ve todas; los demás, las suyas */
function listar(usuario, limite = 100) {
  const db = conexion();
  const filtro = usuario.rol === 'admin' ? '' : 'WHERE a.usuario_id = ?';
  const filas = db.prepare(`
    SELECT a.*, u.nombre AS usuario_nombre, t.folio, t.estado AS ticket_estado
    FROM auditorias_red a LEFT JOIN usuarios u ON u.id = a.usuario_id LEFT JOIN tickets t ON t.id = a.ticket_id
    ${filtro} ORDER BY a.medido_en DESC, a.id DESC LIMIT ?`).all(...(filtro ? [usuario.id] : []), limite);
  return filas.map(a => ({
    id: a.id,
    ubicacion: a.ubicacion,
    latencia: a.latencia_ms, jitter: a.jitter_ms, perdida: a.perdida_pct, velocidad: a.velocidad_mbps,
    tipo: a.tipo_conexion, sinConexion: !!a.sin_conexion, degradada: !!a.degradada,
    aptitud: {
      videollamadas: { etiqueta: a.apt_videollamadas, nivel: nivelDe(a.apt_videollamadas) },
      git: { etiqueta: a.apt_git, nivel: nivelDe(a.apt_git) },
      descargas: { etiqueta: a.apt_descargas, nivel: nivelDe(a.apt_descargas) }
    },
    folio: a.folio || null, ticketEstado: a.ticket_estado || null,
    usuario: a.usuario_nombre || 'Usuario eliminado',
    at: aMs(a.medido_en)
  }));
}

/* Resumen por edificio para el tablero (promedios y zonas muertas) */
function resumen() {
  const db = conexion();
  return db.prepare(`
    SELECT COALESCE(n.edificio_id, '—') AS edificio, COUNT(*) AS mediciones,
           ROUND(AVG(CASE WHEN a.sin_conexion = 0 THEN a.latencia_ms END)) AS latencia,
           ROUND(AVG(CASE WHEN a.sin_conexion = 0 THEN a.velocidad_mbps END), 1) AS velocidad,
           SUM(a.degradada) AS degradadas, SUM(a.sin_conexion) AS zonas_muertas
    FROM auditorias_red a LEFT JOIN espacios e ON e.id = a.espacio_id LEFT JOIN niveles n ON n.id = e.nivel_id
    GROUP BY 1 ORDER BY 1`).all();
}

module.exports = { evaluar, registrar, listar, resumen, nivelDe };
