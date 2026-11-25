/* =========================================================
   Lógica de negocio de los tickets
   RF-02 alta · RF-03 máquina de estados · RF-04 evidencia
   ========================================================= */
'use strict';
const { conexion, transaccion, fecha, aMs } = require('./db');
const { ErrorHttp } = require('./auth');
const { guardarFoto, borrarFotos } = require('./fotos');
const { mensajeEstado } = require('./seed');
const push = require('./push');

/* Transiciones permitidas y rol que puede ejecutarlas */
const TRANSICIONES = {
  'Abierto':    ['Asignado', 'Rechazado'],
  'Asignado':   ['En Proceso', 'Rechazado'],
  'En Proceso': ['Resuelto'],
  'Resuelto':   ['Cerrado'],
  'Cerrado':    [],
  'Rechazado':  []
};
const PERMISOS = {
  'Asignado':   ['admin'],
  'Rechazado':  ['admin'],
  'En Proceso': ['mantenimiento'],
  'Resuelto':   ['mantenimiento'],
  'Cerrado':    ['admin', 'solicitante']
};

const SQL_BASE = `
  SELECT t.*, s.correo AS sol_correo, s.nombre AS sol_nombre,
         tec.correo AS tec_correo, tec.nombre AS tec_nombre,
         e.nombre AS espacio_nombre, n.clave AS nivel_clave, n.edificio_id AS edificio,
         c.nombre AS categoria
  FROM tickets t
  LEFT JOIN usuarios s    ON s.id = t.solicitante_id
  LEFT JOIN usuarios tec  ON tec.id = t.tecnico_id
  LEFT JOIN espacios e    ON e.id = t.espacio_id
  LEFT JOIN niveles n     ON n.id = e.nivel_id
  LEFT JOIN categorias c  ON c.id = t.categoria_id`;

/* Convierte las filas de la base al formato que usa el frontend */
function mapear(filas) {
  if (!filas.length) return [];
  const db = conexion();
  const ids = filas.map(f => f.id);
  const marcas = ids.map(() => '?').join(',');
  const historial = db.prepare(`
    SELECT h.*, u.correo AS usuario_correo FROM historial_estados h
    LEFT JOIN usuarios u ON u.id = h.usuario_id
    WHERE h.ticket_id IN (${marcas}) ORDER BY h.fecha, h.id`).all(...ids);
  const resoluciones = db.prepare(`SELECT * FROM resoluciones WHERE ticket_id IN (${marcas})`).all(...ids);

  return filas.map(t => {
    const r = resoluciones.find(x => x.ticket_id === t.id);
    return {
      id: t.folio,
      dbId: t.id,
      createdAt: aMs(t.creado_en),
      updatedAt: aMs(t.actualizado_en),
      solicitante: { email: t.sol_correo, name: t.sol_nombre || 'Usuario eliminado' },
      ubicacion: { edificio: t.edificio, nivel: t.nivel_clave, espacio: t.espacio_nombre, activo: t.activo },
      categoria: t.categoria,
      severidad: t.severidad,
      descripcion: t.descripcion,
      foto: t.foto,
      estado: t.estado,
      origen: t.origen || 'formulario',
      tecnico: t.tec_correo || null,
      tecnicoNombre: t.tec_nombre || null,
      rechazo: t.motivo_rechazo,
      gps: t.latitud != null && t.longitud != null ? { lat: t.latitud, lng: t.longitud, precision: t.precision_m } : null,
      resolucion: r ? { foto: r.foto, notas: r.notas, materiales: r.materiales, at: aMs(r.resuelto_en) } : null,
      historial: historial.filter(h => h.ticket_id === t.id).map(h => ({
        de: h.estado_anterior, a: h.estado_nuevo, por: h.usuario_correo,
        porNombre: h.usuario_nombre, at: aMs(h.fecha), nota: h.nota
      }))
    };
  });
}

/* Cada rol ve solo lo que le corresponde */
function listar(usuario) {
  const db = conexion();
  let filas;
  if (usuario.rol === 'admin') filas = db.prepare(`${SQL_BASE} ORDER BY t.creado_en DESC`).all();
  else if (usuario.rol === 'mantenimiento') filas = db.prepare(`${SQL_BASE} WHERE t.tecnico_id = ? ORDER BY t.creado_en DESC`).all(usuario.id);
  else filas = db.prepare(`${SQL_BASE} WHERE t.solicitante_id = ? ORDER BY t.creado_en DESC`).all(usuario.id);
  return mapear(filas);
}

function obtener(folio) {
  const fila = conexion().prepare(`${SQL_BASE} WHERE t.folio = ?`).get(folio);
  if (!fila) throw new ErrorHttp(404, 'El ticket no existe.');
  return fila;
}

function notificar(db, usuarioId, ticketId, titulo, mensaje) {
  const id = Number(db.prepare('INSERT INTO notificaciones (usuario_id, ticket_id, titulo, mensaje, creada_en) VALUES (?, ?, ?, ?, ?)')
    .run(usuarioId, ticketId, titulo, mensaje, fecha()).lastInsertRowid);
  push.programar(id); // notificación push al terminar la transacción
}

/* Valida las coordenadas que manda el GPS del dispositivo (opcional) */
function leerGps(g) {
  if (!g || g.lat == null || g.lng == null) return null;
  const lat = Number(g.lat), lng = Number(g.lng), precision = g.precision == null ? null : Number(g.precision);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new ErrorHttp(400, 'Las coordenadas GPS no son válidas.');
  }
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, precision: Number.isFinite(precision) ? Math.round(precision) : null };
}

const NOTA_ORIGEN = {
  formulario: 'Incidencia registrada por el solicitante',
  reporte_visual: 'Reporte visual con anotaciones sobre la fotografía',
  sin_conexion: 'Reporte capturado sin conexión y sincronizado al volver la red'
};

/* ---------------- RF-02: alta de incidencia ---------------- */
function crear(usuario, d) {
  const db = conexion();
  // Idempotencia: si el reporte ya llegó (por ejemplo, reenviado desde la cola offline), se devuelve el mismo folio
  const clienteId = d.clienteId ? String(d.clienteId).slice(0, 64) : null;
  if (clienteId) {
    const previo = db.prepare('SELECT folio FROM tickets WHERE cliente_id = ? AND solicitante_id = ?').get(clienteId, usuario.id);
    if (previo) return previo.folio;
  }
  const gps = leerGps(d.gps);
  const requeridos = [['edificio', 'el edificio'], ['nivel', 'el nivel'], ['espacio', 'el espacio o aula'], ['activo', 'el activo afectado'], ['categoria', 'la categoría del problema'], ['severidad', 'la severidad']];
  for (const [k, l] of requeridos) if (!d[k]) throw new ErrorHttp(400, `Selecciona ${l}.`);
  if (!d.foto) throw new ErrorHttp(400, 'Captura una fotografía como evidencia de la incidencia.');
  const descripcion = String(d.descripcion || '').trim();
  if (descripcion.length < 10) throw new ErrorHttp(400, 'Describe el problema con al menos 10 caracteres.');
  if (descripcion.length > 500) throw new ErrorHttp(400, 'La descripción no puede superar 500 caracteres.');

  const espacio = db.prepare(`
    SELECT e.id FROM espacios e JOIN niveles n ON n.id = e.nivel_id
    WHERE n.edificio_id = ? AND n.clave = ? AND e.nombre = ?`).get(d.edificio, d.nivel, d.espacio);
  if (!espacio) throw new ErrorHttp(400, 'La ubicación seleccionada ya no existe en el catálogo.');
  const categoria = db.prepare('SELECT id FROM categorias WHERE nombre = ?').get(d.categoria);
  if (!categoria) throw new ErrorHttp(400, 'La categoría seleccionada no existe.');
  const severidad = db.prepare('SELECT nombre FROM severidades WHERE nombre = ?').get(d.severidad);
  if (!severidad) throw new ErrorHttp(400, 'La severidad seleccionada no existe.');

  const ORIGENES = ['formulario', 'reporte_visual', 'sin_conexion'];
  const origenReporte = ORIGENES.includes(d.origen) ? d.origen : 'formulario';

  const foto = guardarFoto(d.foto, origenReporte === 'reporte_visual' ? 'visual' : 'reporte');
  try {
    return transaccion(() => {
      const ahora = fecha();
      const id = Number(db.prepare(`INSERT INTO tickets
        (solicitante_id, espacio_id, activo, categoria_id, severidad, descripcion, foto, estado, latitud, longitud, precision_m, cliente_id, origen, creado_en, actualizado_en)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Abierto', ?, ?, ?, ?, ?, ?, ?)`)
        .run(usuario.id, espacio.id, String(d.activo).slice(0, 80), categoria.id, severidad.nombre, descripcion, foto,
          gps?.lat ?? null, gps?.lng ?? null, gps?.precision ?? null, clienteId, origenReporte, ahora, ahora).lastInsertRowid);
      const { folio } = db.prepare('SELECT folio FROM tickets WHERE id = ?').get(id);
      db.prepare('INSERT INTO historial_estados (ticket_id, estado_anterior, estado_nuevo, usuario_id, usuario_nombre, nota, fecha) VALUES (?, NULL, ?, ?, ?, ?, ?)')
        .run(id, 'Abierto', usuario.id, usuario.nombre, NOTA_ORIGEN[origenReporte], ahora);
      const admins = db.prepare("SELECT id FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id <> ?").all(usuario.id);
      // Los reportes de severidad Crítica se envían como alerta (en la web y como push en el teléfono)
      const titulo = severidad.nombre === 'Crítica' ? `Alerta crítica ${folio}` : `Nuevo reporte ${folio}`;
      for (const a of admins) notificar(db, a.id, id, titulo, `${d.categoria} · ${d.severidad} — Edif. ${d.edificio} · ${d.espacio}`);
      return folio;
    });
  } catch (e) {
    borrarFotos(foto);
    throw e;
  }
}

/* ---------------- RF-03 / RF-04: cambio de estado ---------------- */
function transicion(usuario, folio, d) {
  const db = conexion();
  const t = obtener(folio);
  const destino = d.estado;
  const origen = t.estado;

  if (!TRANSICIONES[origen]?.includes(destino)) throw new ErrorHttp(409, `Transición no permitida: ${origen} → ${destino}.`);
  if (!PERMISOS[destino].includes(usuario.rol)) throw new ErrorHttp(403, 'Tu rol no puede realizar este cambio de estado.');

  let tecnicoId = t.tecnico_id;
  let tecnicoNombre = t.tec_nombre;
  let motivo = null;
  let fotoEvidencia = null;

  if (destino === 'Asignado') {
    const tec = db.prepare("SELECT id, nombre FROM usuarios WHERE correo = ? AND rol = 'mantenimiento' AND activo = 1").get(d.tecnico);
    if (!tec) throw new ErrorHttp(400, 'Selecciona a un técnico activo.');
    tecnicoId = tec.id;
    tecnicoNombre = tec.nombre;
  }
  if (['En Proceso', 'Resuelto'].includes(destino) && t.tecnico_id !== usuario.id) {
    throw new ErrorHttp(403, 'Solo el técnico asignado puede trabajar este ticket.');
  }
  if (destino === 'Resuelto') {
    if (!d.foto) throw new ErrorHttp(400, 'Adjunta al menos una fotografía del trabajo concluido.');
    if (!String(d.notas || '').trim()) throw new ErrorHttp(400, 'Escribe las notas técnicas de la solución.');
    if (!String(d.materiales || '').trim()) throw new ErrorHttp(400, 'Indica los materiales o refacciones utilizados (o escribe "Ninguno").');
  }
  if (destino === 'Rechazado') {
    motivo = String(d.motivo || '').trim();
    if (!motivo) throw new ErrorHttp(400, 'Indica el motivo del rechazo.');
  }
  if (destino === 'Cerrado' && usuario.rol === 'solicitante' && t.solicitante_id !== usuario.id) {
    throw new ErrorHttp(403, 'Solo puedes cerrar tus propios reportes.');
  }

  if (destino === 'Resuelto') fotoEvidencia = guardarFoto(d.foto, 'evidencia');

  const notaPorDefecto = {
    'Asignado': `Asignado a ${tecnicoNombre}`, 'En Proceso': 'Inicio de labores en sitio',
    'Resuelto': 'Trabajo concluido con evidencia', 'Rechazado': motivo, 'Cerrado': 'Ticket cerrado'
  };

  try {
    transaccion(() => {
      const ahora = fecha();
      db.prepare('UPDATE tickets SET estado = ?, tecnico_id = ?, motivo_rechazo = COALESCE(?, motivo_rechazo), actualizado_en = ? WHERE id = ?')
        .run(destino, tecnicoId, motivo, ahora, t.id);
      if (destino === 'Resuelto') {
        db.prepare('INSERT INTO resoluciones (ticket_id, tecnico_id, foto, notas, materiales, resuelto_en) VALUES (?, ?, ?, ?, ?, ?)')
          .run(t.id, usuario.id, fotoEvidencia, String(d.notas).trim(), String(d.materiales).trim(), ahora);
      }
      db.prepare('INSERT INTO historial_estados (ticket_id, estado_anterior, estado_nuevo, usuario_id, usuario_nombre, nota, fecha) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(t.id, origen, destino, usuario.id, usuario.nombre, String(d.nota || '').trim() || notaPorDefecto[destino], ahora);

      // RF-05: avisos a los involucrados
      if (t.solicitante_id !== usuario.id) notificar(db, t.solicitante_id, t.id, `${folio} · ${destino}`, mensajeEstado(destino, tecnicoNombre, motivo));
      if (destino === 'Asignado') notificar(db, tecnicoId, t.id, `Nueva orden ${folio}`, `${t.categoria} · ${t.severidad} — Edif. ${t.edificio} · ${t.espacio_nombre}`);
      if (destino === 'Resuelto') {
        const admins = db.prepare("SELECT id FROM usuarios WHERE rol = 'admin' AND activo = 1").all();
        for (const a of admins) notificar(db, a.id, t.id, `${folio} listo para cierre`, `${usuario.nombre} registró la solución con evidencia.`);
      }
      if (destino === 'Cerrado' && usuario.rol === 'solicitante' && tecnicoId) notificar(db, tecnicoId, t.id, `${folio} · Cerrado`, 'El solicitante confirmó la solución.');
    });
  } catch (e) {
    borrarFotos(fotoEvidencia);
    throw e;
  }
}

/* ---------------- Edición de datos del reporte ---------------- */
/* El solicitante puede corregir su reporte mientras está Abierto; el admin, en cualquier momento */
function editar(usuario, folio, d) {
  const db = conexion();
  const t = obtener(folio);
  if (usuario.rol === 'solicitante') {
    if (t.solicitante_id !== usuario.id) throw new ErrorHttp(403, 'Solo puedes editar tus propios reportes.');
    if (t.estado !== 'Abierto') throw new ErrorHttp(409, 'Solo puedes editar reportes que aún no han sido asignados.');
  } else if (usuario.rol !== 'admin') {
    throw new ErrorHttp(403, 'Tu rol no puede editar reportes.');
  }
  const cambios = {};
  if (d.descripcion != null) {
    const desc = String(d.descripcion).trim();
    if (desc.length < 10 || desc.length > 500) throw new ErrorHttp(400, 'La descripción debe tener entre 10 y 500 caracteres.');
    if (desc !== t.descripcion) cambios.descripcion = desc;
  }
  if (d.severidad != null && d.severidad !== t.severidad) {
    if (!db.prepare('SELECT 1 FROM severidades WHERE nombre = ?').get(d.severidad)) throw new ErrorHttp(400, 'La severidad seleccionada no existe.');
    cambios.severidad = d.severidad;
  }
  if (d.activo != null) {
    const activo = String(d.activo).trim().slice(0, 80);
    if (!activo) throw new ErrorHttp(400, 'Indica el activo afectado.');
    if (activo !== t.activo) cambios.activo = activo;
  }
  const campos = Object.keys(cambios);
  if (!campos.length) return false;
  transaccion(() => {
    const ahora = fecha();
    db.prepare(`UPDATE tickets SET ${campos.map(c => `${c} = ?`).join(', ')}, actualizado_en = ? WHERE id = ?`)
      .run(...campos.map(c => cambios[c]), ahora, t.id);
    const nombres = { descripcion: 'descripción', severidad: 'severidad', activo: 'activo' };
    db.prepare('INSERT INTO historial_estados (ticket_id, estado_anterior, estado_nuevo, usuario_id, usuario_nombre, nota, fecha) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(t.id, t.estado, t.estado, usuario.id, usuario.nombre, `Reporte editado: ${campos.map(c => nombres[c]).join(', ')}`, ahora);
    if (cambios.severidad === 'Crítica') {
      const admins = db.prepare("SELECT id FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id <> ?").all(usuario.id);
      for (const a of admins) notificar(db, a.id, t.id, `Alerta crítica ${folio}`, `La severidad del reporte subió a Crítica — Edif. ${t.edificio} · ${t.espacio_nombre}`);
    }
  });
  return true;
}

/* ---------------- Baja de un ticket ---------------- */
function eliminar(usuario, folio) {
  const db = conexion();
  const t = obtener(folio);
  if (usuario.rol === 'solicitante') {
    if (t.solicitante_id !== usuario.id) throw new ErrorHttp(403, 'Solo puedes cancelar tus propios reportes.');
    if (t.estado !== 'Abierto') throw new ErrorHttp(409, 'Solo puedes cancelar reportes que aún no han sido asignados.');
  } else if (usuario.rol !== 'admin') {
    throw new ErrorHttp(403, 'Tu rol no puede eliminar tickets.');
  }
  const res = db.prepare('SELECT foto FROM resoluciones WHERE ticket_id = ?').get(t.id);
  // ON DELETE CASCADE borra historial, resolución y notificaciones relacionadas
  db.prepare('DELETE FROM tickets WHERE id = ?').run(t.id);
  borrarFotos(t.foto, res?.foto);
}

module.exports = { listar, crear, transicion, editar, eliminar, notificar };
