-- =========================================================
--  CampusCare · Esquema de la base de datos (SQLite)
--  Se ejecuta automáticamente al iniciar el servidor.
--  Las fechas se guardan como texto 'AAAA-MM-DD HH:MM:SS' (hora local).
-- =========================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------
-- USUARIOS (RF-01): cuentas institucionales y su rol
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  correo         TEXT    NOT NULL UNIQUE CHECK (correo LIKE '%@institucion.edu.mx'),
  nombre         TEXT    NOT NULL,
  rol            TEXT    NOT NULL DEFAULT 'solicitante'
                 CHECK (rol IN ('solicitante', 'mantenimiento', 'admin')),
  password_hash  TEXT    NOT NULL,
  avatar         TEXT,
  activo         INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  creado_en      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ---------------------------------------------------------
-- CATÁLOGO DE UBICACIONES (RF-02): Edificio > Nivel > Espacio
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS edificios (
  id       TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 5),
  nombre   TEXT NOT NULL,
  imagen   TEXT
);

CREATE TABLE IF NOT EXISTS niveles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  edificio_id  TEXT NOT NULL REFERENCES edificios(id) ON DELETE CASCADE ON UPDATE CASCADE,
  clave        TEXT NOT NULL,
  nombre       TEXT NOT NULL,
  UNIQUE (edificio_id, clave)
);

CREATE TABLE IF NOT EXISTS espacios (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nivel_id  INTEGER NOT NULL REFERENCES niveles(id) ON DELETE CASCADE,
  nombre    TEXT    NOT NULL,
  UNIQUE (nivel_id, nombre)
);

-- ---------------------------------------------------------
-- CATEGORÍAS Y SEVERIDADES (con su SLA en horas)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS categorias (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre       TEXT NOT NULL UNIQUE,
  descripcion  TEXT,
  icono        TEXT NOT NULL DEFAULT 'box',
  imagen       TEXT
);

CREATE TABLE IF NOT EXISTS severidades (
  nombre       TEXT    PRIMARY KEY CHECK (nombre IN ('Baja', 'Media', 'Crítica')),
  sla_horas    INTEGER NOT NULL CHECK (sla_horas > 0),
  descripcion  TEXT,
  orden        INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------
-- TICKETS (RF-02, RF-03): incidencias levantadas
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  folio           TEXT    UNIQUE,
  solicitante_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  espacio_id      INTEGER NOT NULL REFERENCES espacios(id) ON DELETE RESTRICT,
  activo          TEXT    NOT NULL,
  categoria_id    INTEGER NOT NULL REFERENCES categorias(id) ON DELETE RESTRICT,
  severidad       TEXT    NOT NULL REFERENCES severidades(nombre) ON UPDATE CASCADE,
  descripcion     TEXT    NOT NULL,
  foto            TEXT,
  estado          TEXT    NOT NULL DEFAULT 'Abierto'
                  CHECK (estado IN ('Abierto', 'Asignado', 'En Proceso', 'Resuelto', 'Cerrado', 'Rechazado')),
  tecnico_id      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  motivo_rechazo  TEXT,
  latitud         REAL    CHECK (latitud IS NULL OR latitud BETWEEN -90 AND 90),     -- GPS del dispositivo (opcional)
  longitud        REAL    CHECK (longitud IS NULL OR longitud BETWEEN -180 AND 180),
  precision_m     REAL,
  cliente_id      TEXT,   -- identificador generado en el navegador: evita duplicados al reenviar desde la cola offline
  creado_en       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  actualizado_en  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- El folio (CC-1001, CC-1002, ...) se genera solo al insertar un ticket
CREATE TRIGGER IF NOT EXISTS tickets_folio
AFTER INSERT ON tickets
WHEN NEW.folio IS NULL
BEGIN
  UPDATE tickets SET folio = 'CC-' || (1000 + NEW.id) WHERE id = NEW.id;
END;

-- ---------------------------------------------------------
-- RESOLUCIONES (RF-04): evidencia obligatoria del técnico
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS resoluciones (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id    INTEGER NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
  tecnico_id   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  foto         TEXT,
  notas        TEXT    NOT NULL,
  materiales   TEXT    NOT NULL,
  resuelto_en  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ---------------------------------------------------------
-- HISTORIAL DE ESTADOS (RF-03): trazabilidad de cada cambio
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS historial_estados (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id        INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  estado_anterior  TEXT,
  estado_nuevo     TEXT    NOT NULL,
  usuario_id       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nombre   TEXT,
  nota             TEXT,
  fecha            TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ---------------------------------------------------------
-- NOTIFICACIONES (RF-05)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS notificaciones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ticket_id   INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  titulo      TEXT    NOT NULL,
  mensaje     TEXT    NOT NULL,
  leida       INTEGER NOT NULL DEFAULT 0 CHECK (leida IN (0, 1)),
  creada_en   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ---------------------------------------------------------
-- BITÁCORA DE ACCESOS: cada intento de inicio de sesión
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS accesos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  correo      TEXT    NOT NULL,
  evento      TEXT    NOT NULL,
  exito       INTEGER NOT NULL CHECK (exito IN (0, 1)),
  detalle     TEXT,
  ip          TEXT,
  fecha       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ---------------------------------------------------------
-- ÍNDICES
-- ---------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tickets_estado      ON tickets(estado);
CREATE INDEX IF NOT EXISTS idx_tickets_tecnico     ON tickets(tecnico_id);
CREATE INDEX IF NOT EXISTS idx_tickets_solicitante ON tickets(solicitante_id);
CREATE INDEX IF NOT EXISTS idx_historial_ticket    ON historial_estados(ticket_id);
CREATE INDEX IF NOT EXISTS idx_notif_usuario       ON notificaciones(usuario_id);

-- ---------------------------------------------------------
-- VISTA: reporte legible de tickets (para consultar y exponer)
-- ---------------------------------------------------------
CREATE VIEW IF NOT EXISTS vista_reporte_tickets AS
SELECT t.folio,
       t.estado,
       t.severidad,
       c.nombre       AS categoria,
       ed.nombre      AS edificio,
       n.nombre       AS nivel,
       e.nombre       AS espacio,
       t.activo,
       s.nombre       AS solicitante,
       tec.nombre     AS tecnico,
       t.creado_en,
       r.resuelto_en,
       ROUND((julianday(r.resuelto_en) - julianday(t.creado_en)) * 24, 1) AS horas_resolucion,
       sv.sla_horas,
       CASE
         WHEN r.resuelto_en IS NULL THEN 'Pendiente'
         WHEN (julianday(r.resuelto_en) - julianday(t.creado_en)) * 24 <= sv.sla_horas THEN 'Cumplido'
         ELSE 'Incumplido'
       END AS sla
FROM tickets t
JOIN usuarios s          ON s.id   = t.solicitante_id
LEFT JOIN usuarios tec   ON tec.id = t.tecnico_id
JOIN espacios e          ON e.id   = t.espacio_id
JOIN niveles n           ON n.id   = e.nivel_id
JOIN edificios ed        ON ed.id  = n.edificio_id
JOIN categorias c        ON c.id   = t.categoria_id
JOIN severidades sv      ON sv.nombre = t.severidad
LEFT JOIN resoluciones r ON r.ticket_id = t.id;

-- ---------------------------------------------------------
-- SUSCRIPCIONES PUSH (PWA): un registro por navegador o dispositivo
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS suscripciones_push (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  endpoint    TEXT    NOT NULL UNIQUE,
  p256dh      TEXT    NOT NULL,
  auth        TEXT    NOT NULL,
  agente      TEXT,
  creada_en   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
