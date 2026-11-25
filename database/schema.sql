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
  registrado_por TEXT    NOT NULL DEFAULT 'administrador',  -- semilla, registro, enlace o administrador
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
  origen          TEXT    NOT NULL DEFAULT 'formulario'   -- módulo que creó el reporte
                  CHECK (origen IN ('formulario', 'reporte_visual', 'auditoria_red', 'sin_conexion')),
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

-- =========================================================
--  MÓDULOS DEL EQUIPO
-- =========================================================

-- ---------------------------------------------------------
-- AUDITORÍAS DE RED WI-FI (aportación de Carlos Ojeda)
-- Cada medición de latencia, jitter, pérdida y velocidad con su
-- semáforo de aptitud académica. Si la red está degradada puede
-- escalarse a un ticket de Red/TI (ticket_id).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditorias_red (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id         INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  espacio_id         INTEGER REFERENCES espacios(id) ON DELETE SET NULL,
  ubicacion          TEXT    NOT NULL,
  latencia_ms        INTEGER,
  jitter_ms          INTEGER,
  perdida_pct        INTEGER CHECK (perdida_pct IS NULL OR perdida_pct BETWEEN 0 AND 100),
  velocidad_mbps     REAL,
  tipo_conexion      TEXT,
  sin_conexion       INTEGER NOT NULL DEFAULT 0 CHECK (sin_conexion IN (0, 1)),   -- "zona muerta"
  apt_videollamadas  TEXT,
  apt_git            TEXT,
  apt_descargas      TEXT,
  degradada          INTEGER NOT NULL DEFAULT 0 CHECK (degradada IN (0, 1)),
  ticket_id          INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  cliente_id         TEXT,
  medido_en          TEXT    NOT NULL,
  creado_en          TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_red_espacio ON auditorias_red(espacio_id);

-- ---------------------------------------------------------
-- INVITACIONES: enlace y código QR para registrarse desde el teléfono
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS invitaciones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo      TEXT    NOT NULL UNIQUE,
  rol         TEXT    NOT NULL CHECK (rol IN ('solicitante', 'mantenimiento', 'admin')),
  creada_por  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  usos        INTEGER NOT NULL DEFAULT 0,
  max_usos    INTEGER NOT NULL DEFAULT 50 CHECK (max_usos > 0),
  activa      INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1)),
  expira_en   TEXT    NOT NULL,
  creada_en   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ---------------------------------------------------------
-- BITÁCORA DE CAMBIOS: qué se agregó, editó o borró, quién y desde qué módulo.
-- La llenan triggers automáticos (src/bitacora.js); "contexto" guarda
-- al usuario de la petición en curso para que el trigger sepa quién fue.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS contexto (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  usuario_id      INTEGER,
  usuario_nombre  TEXT,
  modulo          TEXT,
  fecha           TEXT      -- solo la usa la carga de datos de demostración (fechas en el pasado)
);
INSERT OR IGNORE INTO contexto (id, usuario_id, usuario_nombre, modulo) VALUES (1, NULL, 'Sistema', 'sistema');

CREATE TABLE IF NOT EXISTS bitacora (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha           TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  tabla           TEXT    NOT NULL,
  operacion       TEXT    NOT NULL CHECK (operacion IN ('INSERT', 'UPDATE', 'DELETE')),
  registro_id     TEXT,
  resumen         TEXT,
  cambios         TEXT,     -- en una edición: qué campos cambiaron (antes → después)
  antes           TEXT,     -- JSON del registro antes del cambio
  despues         TEXT,     -- JSON del registro después del cambio
  usuario_id      INTEGER,  -- sin llave foránea: el historial se conserva aunque se borre el usuario
  usuario_nombre  TEXT,
  modulo          TEXT
);
CREATE INDEX IF NOT EXISTS idx_bitacora_fecha   ON bitacora(fecha);
CREATE INDEX IF NOT EXISTS idx_bitacora_usuario ON bitacora(usuario_id);
