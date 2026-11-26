/* =========================================================
   Monitoreo físico con Arduino
   ---------------------------------------------------------
   El navegador conectado al Arduino (Web Serial) manda aquí
   las lecturas ya convertidas a porcentaje:
     luz   0 a 100  (sensor de luz del aula)
     fuego true/false y flama 0 a 100 (equipo de cómputo)
     agua  0 a 100  (potenciómetro = nivel de la cisterna)
   El servidor calcula el estado de cada sensor, lo confirma
   cuando dura al menos 1 segundo (para no tomar un parpadeo
   como alarma), guarda solo los CAMBIOS de estado y, si hace
   falta, crea un reporte con alerta para la administración.
   Las lecturas se difunden en vivo a todos los navegadores.
   ========================================================= */
'use strict';
const { conexion, transaccion, fecha, aMs } = require('./db');
const { ErrorHttp } = require('./auth');

const CONFIRMAR_MS = 1000;      // un estado debe durar esto para contar
const SIN_DATOS_MS = 15000;     // sin lecturas en este tiempo, el Arduino se da por desconectado

/* Dónde está cada escena en el catálogo del campus (así entra al mapa de calor) */
const ESCENAS = {
  luz:   { nombre: 'Fallas de luz',      edificio: 'B', nivel: 'PB', espacio: 'Aula B-101',        activo: 'Luminarias',        categoria: 'Eléctrica', foto: 'img/cat-electrica.jpg' },
  flama: { nombre: 'Equipo de cómputo',  edificio: 'D', nivel: 'N1', espacio: 'Lab. de Cómputo 1', activo: 'Equipo de cómputo', categoria: 'Eléctrica', foto: 'img/cat-red.jpg' },
  agua:  { nombre: 'Cisterna',           edificio: 'D', nivel: 'PB', espacio: 'Almacén',           activo: 'Cisterna',          categoria: 'Plomería',  foto: 'img/cat-plomeria.jpg' }
};

/* Mensaje de cada estado y, si aplica, el reporte que genera */
const ESTADOS = {
  luz: {
    encendida: { mensaje: 'Luz restablecida en el aula' },
    falla:     { mensaje: 'Falla de luz: parpadeo o luz baja' },
    apagada:   { mensaje: 'Corte de luz en el aula', severidad: 'Media' }
  },
  flama: {
    normal: { mensaje: 'Equipo de cómputo sin flama' },
    fuego:  { mensaje: 'Fuego detectado en el equipo de cómputo', severidad: 'Crítica' }
  },
  agua: {
    normal:         { mensaje: 'Nivel de la cisterna normal' },
    bajo:           { mensaje: 'Nivel de la cisterna bajo', severidad: 'Media' },
    desbordamiento: { mensaje: 'La cisterna se está desbordando', severidad: 'Crítica' }
  }
};

function calcularEstados({ luz, fuego, agua }) {
  return {
    luz: luz < 15 ? 'apagada' : luz < 45 ? 'falla' : 'encendida',
    flama: fuego ? 'fuego' : 'normal',
    agua: agua < 20 ? 'bajo' : agua > 90 ? 'desbordamiento' : 'normal'
  };
}

/* Estado en memoria (se reinicia con el servidor) */
const memoria = {
  ultimo: null,
  confirmado: { luz: null, flama: null, agua: null },
  pendiente: { luz: null, flama: null, agua: null }   // { estado, desde }
};

const pct = v => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ErrorHttp(400, 'Las lecturas de los sensores deben ser números de 0 a 100.');
  return Math.round(Math.min(Math.max(n, 0), 100));
};

/* Crea el reporte de un evento, o lo liga al que ya está abierto para ese equipo */
function reporteDeEvento(db, usuario, sensor, estado, valor, fuente, notificar) {
  const def = ESTADOS[sensor][estado];
  if (!def.severidad) return null;
  const e = ESCENAS[sensor];
  const espacio = db.prepare(`SELECT es.id FROM espacios es JOIN niveles n ON n.id = es.nivel_id
    WHERE n.edificio_id = ? AND n.clave = ? AND es.nombre = ?`).get(e.edificio, e.nivel, e.espacio);
  const categoria = db.prepare('SELECT id FROM categorias WHERE nombre = ?').get(e.categoria);
  if (!espacio || !categoria) return null;
  const abierto = db.prepare(`SELECT id, folio FROM tickets WHERE origen = 'sensor' AND espacio_id = ? AND activo = ?
    AND estado IN ('Abierto', 'Asignado', 'En Proceso') ORDER BY id DESC LIMIT 1`).get(espacio.id, e.activo);
  if (abierto) return abierto;

  const ahora = fecha();
  const descripcion = `[Sensor] ${def.mensaje} (${e.nombre}, lectura ${valor}%). Detectado por el Arduino${fuente === 'demo' ? ' en modo demostración' : ''}.`;
  const id = Number(db.prepare(`INSERT INTO tickets
    (solicitante_id, espacio_id, activo, categoria_id, severidad, descripcion, foto, estado, origen, creado_en, actualizado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Abierto', 'sensor', ?, ?)`)
    .run(usuario.id, espacio.id, e.activo, categoria.id, def.severidad, descripcion, e.foto, ahora, ahora).lastInsertRowid);
  const folio = db.prepare('SELECT folio FROM tickets WHERE id = ?').get(id).folio;
  db.prepare('INSERT INTO historial_estados (ticket_id, estado_anterior, estado_nuevo, usuario_id, usuario_nombre, nota, fecha) VALUES (?, NULL, ?, ?, ?, ?, ?)')
    .run(id, 'Abierto', usuario.id, usuario.nombre, 'Reporte generado automáticamente por el monitoreo físico (Arduino)', ahora);
  const titulo = def.severidad === 'Crítica' ? `Alerta crítica ${folio}` : `Sensor: ${def.mensaje} ${folio}`;
  // Avisa a toda la administración (también a quien tiene conectado el Arduino) y al personal de mantenimiento
  const destinatarios = db.prepare("SELECT id FROM usuarios WHERE rol IN ('admin', 'mantenimiento') AND activo = 1").all();
  for (const d of destinatarios) notificar(db, d.id, id, titulo, `${def.mensaje} — Edif. ${e.edificio} · ${e.espacio}`);
  return { id, folio };
}

/* Recibe una lectura; devuelve el estado y los eventos que se generaron */
function registrarLectura(usuario, d, notificar) {
  const lectura = {
    luz: pct(d.luz),
    flama: pct(d.flama ?? 0),
    fuego: !!d.fuego,
    agua: pct(d.agua),
    fuente: d.fuente === 'demo' ? 'demo' : 'arduino'
  };
  const estados = calcularEstados(lectura);
  const ahora = Date.now();
  const cambios = [];
  for (const sensor of Object.keys(estados)) {
    const estado = estados[sensor];
    if (memoria.confirmado[sensor] === null && memoria.pendiente[sensor] === null) {
      // Primera lectura: un estado normal se toma tal cual; uno anormal pasa por la confirmación
      const normal = ['encendida', 'normal'].includes(estado);
      if (normal) { memoria.confirmado[sensor] = estado; continue; }
    }
    if (estado === memoria.confirmado[sensor]) { memoria.pendiente[sensor] = null; continue; }
    const p = memoria.pendiente[sensor];
    if (!p || p.estado !== estado) { memoria.pendiente[sensor] = { estado, desde: ahora }; continue; }
    if (ahora - p.desde >= CONFIRMAR_MS) {
      cambios.push({ sensor, estado, anterior: memoria.confirmado[sensor] });
      memoria.confirmado[sensor] = estado;
      memoria.pendiente[sensor] = null;
    }
  }

  const eventos = [];
  if (cambios.length) {
    const db = conexion();
    transaccion(() => {
      for (const c of cambios) {
        const valor = c.sensor === 'flama' ? lectura.flama : lectura[c.sensor];
        const ticket = reporteDeEvento(db, usuario, c.sensor, c.estado, valor, lectura.fuente, notificar);
        const mensaje = ESTADOS[c.sensor][c.estado].mensaje;
        const id = Number(db.prepare(`INSERT INTO sensores_eventos (sensor, estado, anterior, valor, mensaje, fuente, ticket_id, usuario_id, creado_en)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(c.sensor, c.estado, c.anterior, valor, mensaje, lectura.fuente, ticket?.id ?? null, usuario.id, fecha()).lastInsertRowid);
        eventos.push({ id, ...c, valor, mensaje, folio: ticket?.folio || null, severidad: ESTADOS[c.sensor][c.estado].severidad || null, at: ahora, fuente: lectura.fuente });
      }
    });
  }

  memoria.ultimo = { ...lectura, estados: { ...memoria.confirmado }, at: ahora, usuario: usuario.nombre };
  return { ultimo: memoria.ultimo, eventos };
}

function listarEventos(limite = 40) {
  return conexion().prepare(`SELECT e.*, t.folio, u.nombre AS usuario_nombre FROM sensores_eventos e
    LEFT JOIN tickets t ON t.id = e.ticket_id LEFT JOIN usuarios u ON u.id = e.usuario_id
    ORDER BY e.creado_en DESC, e.id DESC LIMIT ?`).all(limite).map(e => ({
    id: e.id, sensor: e.sensor, estado: e.estado, anterior: e.anterior, valor: e.valor, mensaje: e.mensaje,
    fuente: e.fuente, folio: e.folio || null, usuario: e.usuario_nombre || 'Sistema', at: aMs(e.creado_en)
  }));
}

function estadoActual() {
  const u = memoria.ultimo;
  return { ultimo: u, enLinea: !!u && Date.now() - u.at < SIN_DATOS_MS, escenas: ESCENAS };
}

/* Para las pruebas: vuelve al estado inicial */
function reiniciar() {
  memoria.ultimo = null;
  memoria.confirmado = { luz: null, flama: null, agua: null };
  memoria.pendiente = { luz: null, flama: null, agua: null };
}

module.exports = { registrarLectura, listarEventos, estadoActual, calcularEstados, reiniciar, ESCENAS, CONFIRMAR_MS };
