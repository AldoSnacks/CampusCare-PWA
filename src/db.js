/* =========================================================
   Conexión a la base de datos SQLite
   Usa el módulo node:sqlite que viene incluido en Node.js 22+
   (no requiere instalar ni compilar nada extra).
   ========================================================= */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  console.error(`
  ============================================================
   Tu versión de Node.js (${process.version}) no incluye SQLite.
   Instala Node.js 22 LTS o más reciente desde https://nodejs.org
   y vuelve a ejecutar:  npm start
  ============================================================
`);
  process.exit(1);
}

const RAIZ = path.join(__dirname, '..');
const DB_PATH = process.env.DB_PATH || path.join(RAIZ, 'database', 'campuscare.db');
const SCHEMA_PATH = path.join(RAIZ, 'database', 'schema.sql');

let db = null;

function abrir() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  // Integridad referencial y espera si otro programa (DB Browser) tiene la base ocupada
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  migrar(db);
  return db;
}

/* Agrega a una base existente las columnas nuevas de la versión PWA (GPS y cola offline) */
function migrar(d) {
  const columnas = d.prepare('PRAGMA table_info(tickets)').all().map(c => c.name);
  const nuevas = { latitud: 'REAL', longitud: 'REAL', precision_m: 'REAL', cliente_id: 'TEXT' };
  for (const [col, tipo] of Object.entries(nuevas)) {
    if (!columnas.includes(col)) d.exec(`ALTER TABLE tickets ADD COLUMN ${col} ${tipo}`);
  }
  d.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_cliente ON tickets(cliente_id) WHERE cliente_id IS NOT NULL');

  // Versión integrada del equipo: origen de cada reporte y forma en que se dio de alta cada cuenta
  if (!columnas.includes('origen')) {
    d.exec("ALTER TABLE tickets ADD COLUMN origen TEXT NOT NULL DEFAULT 'formulario' CHECK (origen IN ('formulario', 'reporte_visual', 'auditoria_red', 'sin_conexion', 'sensor'))");
  }
  // Bases creadas antes del monitoreo físico: se agrega 'sensor' a la lista de orígenes permitidos
  const sqlTickets = d.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tickets'").get().sql;
  if (!sqlTickets.includes("'sensor'")) {
    const version = d.prepare('PRAGMA schema_version').get().schema_version;
    d.exec('PRAGMA writable_schema = ON');
    d.prepare("UPDATE sqlite_master SET sql = replace(sql, ?, ?) WHERE type = 'table' AND name = 'tickets'")
      .run("'sin_conexion')", "'sin_conexion', 'sensor')");
    d.exec(`PRAGMA schema_version = ${version + 1}`);
    d.exec('PRAGMA writable_schema = OFF');
  }
  const colsUsuarios = d.prepare('PRAGMA table_info(usuarios)').all().map(c => c.name);
  if (!colsUsuarios.includes('registrado_por')) d.exec("ALTER TABLE usuarios ADD COLUMN registrado_por TEXT NOT NULL DEFAULT 'administrador'");
  const colsContexto = d.prepare('PRAGMA table_info(contexto)').all().map(c => c.name);
  if (!colsContexto.includes('fecha')) d.exec('ALTER TABLE contexto ADD COLUMN fecha TEXT');

  // Triggers de la bitácora (qué se agregó, editó o borró)
  require('./bitacora').instalar(d);
}

function conexion() {
  if (!db) abrir();
  return db;
}

/* Ejecuta varias operaciones como una sola unidad (todo o nada) */
function transaccion(fn) {
  const d = conexion();
  d.exec('BEGIN');
  try {
    const r = fn(d);
    d.exec('COMMIT');
    return r;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

/* Borra todas las tablas, vistas y triggers, y vuelve a crear el esquema */
function recrearEsquema() {
  const d = conexion();
  const objetos = d.prepare(
    "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('view','trigger','table')"
  ).all();
  d.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const tipo of ['view', 'trigger', 'table']) {
      for (const o of objetos.filter(x => x.type === tipo)) {
        d.exec(`DROP ${tipo.toUpperCase()} IF EXISTS ${ident(o.name)}`);
      }
    }
  } finally {
    d.exec('PRAGMA foreign_keys = ON');
  }
  d.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  migrar(d);
}

/* Fechas: texto legible en la base, milisegundos en la API */
const dos = n => String(n).padStart(2, '0');
function fecha(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}
function aMs(texto) {
  if (!texto) return null;
  const ms = new Date(String(texto).replace(' ', 'T')).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/* Comillas seguras para nombres de tablas y columnas */
const ident = nombre => `"${String(nombre).replace(/"/g, '""')}"`;

module.exports = { abrir, conexion, transaccion, recrearEsquema, fecha, aMs, ident, DB_PATH };
