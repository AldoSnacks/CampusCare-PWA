/* =========================================================
   Bitácora de cambios de la base de datos
   ---------------------------------------------------------
   Crea triggers AFTER INSERT / UPDATE / DELETE en las tablas
   principales. Cada trigger escribe en la tabla "bitacora":
     · qué tabla y qué registro cambió
     · si se agregó (INSERT), editó (UPDATE) o borró (DELETE)
     · qué campos cambiaron (antes → después)
     · quién lo hizo y desde qué módulo de la aplicación
   El usuario y el módulo se toman de la tabla "contexto", que
   el servidor actualiza al inicio de cada petición.
   ========================================================= */
'use strict';

/* Tablas auditadas:
   id      → expresión que identifica el registro (X = NEW u OLD)
   resumen → texto legible para el historial
   cols    → columnas que se comparan y se guardan en JSON
   largas  → columnas que solo se marcan como "actualizada" (fotos, textos largos)
   secretas→ columnas que nunca se copian a la bitácora (contraseñas)
   omitirSi→ condición para no registrar una edición (por ejemplo, la asignación automática del folio) */
const TABLAS = {
  usuarios: {
    id: 'X.id',
    resumen: "X.nombre || ' · ' || X.correo || ' · rol ' || X.rol",
    cols: ['correo', 'nombre', 'rol', 'activo', 'avatar', 'registrado_por'],
    largas: ['avatar'],
    secretas: ['password_hash']
  },
  tickets: {
    id: "COALESCE(X.folio, 'CC-' || (1000 + X.id))",
    resumen: "COALESCE(X.folio, 'CC-' || (1000 + X.id)) || ' · ' || COALESCE((SELECT nombre FROM categorias WHERE id = X.categoria_id), '') || ' · ' || X.activo || ' · ' || X.severidad || ' · ' || X.estado",
    cols: ['estado', 'severidad', 'activo', 'descripcion', 'tecnico_id', 'espacio_id', 'categoria_id', 'origen', 'motivo_rechazo', 'foto', 'latitud', 'longitud'],
    largas: ['descripcion', 'foto'],
    refs: {
      tecnico_id: 'SELECT nombre FROM usuarios WHERE id = {v}',
      espacio_id: 'SELECT nombre FROM espacios WHERE id = {v}',
      categoria_id: 'SELECT nombre FROM categorias WHERE id = {v}'
    },
    omitirSi: 'OLD.folio IS NULL AND NEW.folio IS NOT NULL'
  },
  resoluciones: {
    id: 'X.id',
    resumen: "'Solución de ' || COALESCE((SELECT folio FROM tickets WHERE id = X.ticket_id), 'ticket ' || X.ticket_id) || ' · materiales: ' || X.materiales",
    cols: ['ticket_id', 'tecnico_id', 'notas', 'materiales', 'foto'],
    largas: ['foto']
  },
  edificios: { id: 'X.id', resumen: "X.id || ' · ' || X.nombre", cols: ['nombre', 'imagen'], largas: ['imagen'] },
  niveles: { id: 'X.id', resumen: "X.edificio_id || ' · ' || X.nombre || ' (' || X.clave || ')'", cols: ['edificio_id', 'clave', 'nombre'] },
  espacios: { id: 'X.id', resumen: "X.nombre", cols: ['nivel_id', 'nombre'] },
  categorias: { id: 'X.id', resumen: "X.nombre", cols: ['nombre', 'descripcion', 'icono', 'imagen'], largas: ['imagen'] },
  severidades: { id: 'X.nombre', resumen: "X.nombre || ' · SLA ' || X.sla_horas || ' h'", cols: ['sla_horas', 'descripcion', 'orden'] },
  auditorias_red: {
    id: 'X.id',
    resumen: "'Auditoría Wi-Fi · ' || X.ubicacion || ' · ' || CASE WHEN X.sin_conexion = 1 THEN 'zona muerta (sin conexión)' ELSE X.latencia_ms || ' ms · ' || X.velocidad_mbps || ' Mbps' END",
    cols: ['ubicacion', 'latencia_ms', 'jitter_ms', 'perdida_pct', 'velocidad_mbps', 'tipo_conexion', 'sin_conexion', 'degradada', 'ticket_id']
  },
  sensores_eventos: {
    id: 'X.id',
    resumen: "'Sensor de ' || X.sensor || ' · ' || X.mensaje || CASE WHEN X.fuente = 'demo' THEN ' (demostración)' ELSE '' END",
    cols: ['sensor', 'estado', 'anterior', 'valor', 'fuente', 'ticket_id']
  },
  invitaciones: {
    id: 'X.codigo',
    resumen: "'Enlace de registro ' || X.codigo || ' · rol ' || X.rol || ' · ' || X.usos || ' uso(s)'",
    cols: ['rol', 'usos', 'max_usos', 'activa', 'expira_en']
  }
};

/* Nombres legibles de los campos en el texto de cambios */
const ETIQUETAS = {
  tecnico_id: 'técnico', espacio_id: 'espacio', categoria_id: 'categoría', motivo_rechazo: 'motivo de rechazo',
  descripcion: 'descripción', activo: 'activo', registrado_por: 'registrado por', latencia_ms: 'latencia (ms)',
  jitter_ms: 'jitter (ms)', perdida_pct: 'pérdida (%)', velocidad_mbps: 'velocidad (Mbps)', ticket_id: 'ticket',
  sla_horas: 'SLA (h)', max_usos: 'usos máximos', expira_en: 'vence', sin_conexion: 'sin conexión', nivel_id: 'nivel',
  edificio_id: 'edificio', tipo_conexion: 'tipo de conexión', origen: 'origen', avatar: 'foto de perfil', foto: 'foto'
};
const etiqueta = c => ETIQUETAS[c] || c;

const ctx = campo => `(SELECT ${campo} FROM contexto WHERE id = 1)`;
const con = (expr, fila) => expr.replace(/\bX\./g, `${fila}.`);
const json = (cols, fila) => `json_object(${cols.map(c => `'${c}', ${fila}."${c}"`).join(', ')})`;

function triggers(tabla, t) {
  const sql = [];
  const todas = [...t.cols, ...(t.secretas || [])];
  const comun = `${ctx('usuario_id')}, ${ctx('usuario_nombre')}, ${ctx('modulo')}, COALESCE(${ctx('fecha')}, datetime('now', 'localtime'))`;
  const valor = (c, fila) => t.refs?.[c]
    ? `COALESCE((${t.refs[c].replace('{v}', `${fila}."${c}"`)}), ${fila}."${c}", '—')`
    : `COALESCE(${fila}."${c}", '—')`;

  sql.push(`DROP TRIGGER IF EXISTS bit_${tabla}_ins`, `DROP TRIGGER IF EXISTS bit_${tabla}_upd`, `DROP TRIGGER IF EXISTS bit_${tabla}_del`);

  sql.push(`CREATE TRIGGER bit_${tabla}_ins AFTER INSERT ON ${tabla} BEGIN
    INSERT INTO bitacora (tabla, operacion, registro_id, resumen, despues, usuario_id, usuario_nombre, modulo, fecha)
    VALUES ('${tabla}', 'INSERT', ${con(t.id, 'NEW')}, ${con(t.resumen, 'NEW')}, ${json(t.cols, 'NEW')}, ${comun});
  END`);

  const cambio = todas.map(c => `OLD."${c}" IS NOT NEW."${c}"`).join(' OR ');
  const detalle = todas.map(c => {
    if ((t.secretas || []).includes(c)) return `CASE WHEN OLD."${c}" IS NOT NEW."${c}" THEN 'contraseña actualizada; ' ELSE '' END`;
    if ((t.largas || []).includes(c)) return `CASE WHEN OLD."${c}" IS NOT NEW."${c}" THEN '${etiqueta(c)} actualizada; ' ELSE '' END`;
    return `CASE WHEN OLD."${c}" IS NOT NEW."${c}" THEN '${etiqueta(c)}: ' || ${valor(c, 'OLD')} || ' → ' || ${valor(c, 'NEW')} || '; ' ELSE '' END`;
  }).join(' || ');
  const omitir = t.omitirSi ? ` AND NOT (${t.omitirSi})` : '';
  sql.push(`CREATE TRIGGER bit_${tabla}_upd AFTER UPDATE ON ${tabla} WHEN (${cambio})${omitir} BEGIN
    INSERT INTO bitacora (tabla, operacion, registro_id, resumen, cambios, antes, despues, usuario_id, usuario_nombre, modulo, fecha)
    VALUES ('${tabla}', 'UPDATE', ${con(t.id, 'NEW')}, ${con(t.resumen, 'NEW')}, rtrim(${detalle}, '; '), ${json(t.cols, 'OLD')}, ${json(t.cols, 'NEW')}, ${comun});
  END`);

  sql.push(`CREATE TRIGGER bit_${tabla}_del AFTER DELETE ON ${tabla} BEGIN
    INSERT INTO bitacora (tabla, operacion, registro_id, resumen, antes, usuario_id, usuario_nombre, modulo, fecha)
    VALUES ('${tabla}', 'DELETE', ${con(t.id, 'OLD')}, ${con(t.resumen, 'OLD')}, ${json(t.cols, 'OLD')}, ${comun});
  END`);
  return sql;
}

/* Crea (o vuelve a crear) todos los triggers de la bitácora */
function instalar(db) {
  for (const [tabla, t] of Object.entries(TABLAS)) {
    for (const sentencia of triggers(tabla, t)) db.exec(sentencia);
  }
}

/* Módulos de la aplicación que pueden originar un cambio (cabecera X-Modulo) */
const MODULOS = {
  formulario: 'Reporte con formulario',
  'reporte-visual': 'Reporte visual',
  'auditoria-red': 'Auditoría de red Wi-Fi',
  'sin-conexion': 'Cola sin conexión',
  'mapa-calor': 'Mapa de calor',
  sensores: 'Monitoreo físico (Arduino)',
  registro: 'Registro de cuenta',
  enlace: 'Registro por enlace o QR',
  administracion: 'Administración',
  'explorador-bd': 'Explorador de la base de datos',
  app: 'Aplicación',
  semilla: 'Datos de demostración',
  sistema: 'Sistema',
  publico: 'Visitante'
};
const moduloValido = m => (MODULOS[m] ? m : 'app');

/* Guarda quién hace la petición actual (lo leen los triggers) */
function establecer(db, usuario, modulo, fechaFija = null) {
  db.prepare('UPDATE contexto SET usuario_id = ?, usuario_nombre = ?, modulo = ?, fecha = ? WHERE id = 1')
    .run(usuario?.id ?? null, usuario?.nombre ?? 'Visitante', modulo || 'app', fechaFija);
}

module.exports = { TABLAS, MODULOS, instalar, establecer, moduloValido };
