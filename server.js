/* =========================================================
   CampusCare · Servidor (Node.js + Express + SQLite)
   Inicia con:  npm start   →   http://localhost:3000
   ========================================================= */
'use strict';
const path = require('node:path');
const os = require('node:os');
const express = require('express');

const { abrir, conexion, DB_PATH } = require('./src/db');
const { sembrarSiVacia, PASSWORD_DEMO } = require('./src/seed');
const { requiereSesion, requiereRol, ErrorHttp } = require('./src/auth');
const eventos = require('./src/eventos');
const { CARPETA: UPLOADS } = require('./src/fotos');
const vistas = require('./src/vistas');
const push = require('./src/push');
const bitacora = require('./src/bitacora');
const qr = require('./src/qr');

const PUERTO = Number(process.env.PORT) || 3000;

/* ---------- Base de datos ---------- */
abrir();
const sembrada = sembrarSiVacia();

/* ---------- Aplicación ---------- */
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

// Permite usar el frontend desde Live Server (otro puerto) durante el desarrollo
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Modulo');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '12mb' })); // las fotos llegan en base64

// Contexto de la bitácora: cada petición empieza como "visitante"; requiereSesion pone al usuario.
// El frontend indica en la cabecera X-Modulo desde qué módulo se hizo el cambio.
app.use('/api', (req, res, next) => {
  req.modulo = bitacora.moduloValido(String(req.headers['x-modulo'] || 'app'));
  bitacora.establecer(conexion(), null, req.modulo);
  next();
});

// Registro de peticiones en la terminal
app.use('/api', (req, res, next) => {
  const inicio = Date.now();
  res.on('finish', () => {
    if (req.path === '/eventos') return;
    console.log(`  ${req.method.padEnd(6)} ${req.originalUrl.split('?')[0].padEnd(42)} ${res.statusCode}  ${Date.now() - inicio} ms`);
  });
  next();
});

/* ---------- Rutas públicas ---------- */
app.get('/api/salud', (req, res) => {
  res.json({ ok: true, baseDeDatos: path.basename(DB_PATH), conectados: eventos.totalConectados() });
});

app.get('/api/publico/resumen', (req, res) => {
  const db = conexion();
  const r = db.prepare(`
    SELECT COUNT(*) AS atendidos,
           SUM(CASE WHEN (julianday(r.resuelto_en) - julianday(t.creado_en)) * 24 <= s.sla_horas THEN 1 ELSE 0 END) AS a_tiempo
    FROM resoluciones r JOIN tickets t ON t.id = r.ticket_id JOIN severidades s ON s.nombre = t.severidad`).get();
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM edificios').get();
  res.json({ atendidos: r.atendidos, sla: r.atendidos ? Math.round((r.a_tiempo || 0) / r.atendidos * 100) : 0, edificios: n });
});

/* Mapa de calor agregado en el servidor (datos públicos, sin información personal) */
app.get('/api/publico/mapa-calor', (req, res) => {
  res.json(vistas.mapaCalor(String(req.query.periodo || 'todo')));
});

/* Llave pública VAPID para que el navegador se suscriba a las notificaciones push */
app.get('/api/push/clave', (req, res) => {
  res.json({ clave: push.clavePublica() });
});

/* Prueba de red de la auditoría Wi-Fi: respuesta sin caché (latencia) y un bloque de datos (velocidad) */
// Express responde también a HEAD con esta misma ruta
app.get('/api/red/ping', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ ok: true, t: Date.now() }); });
const BLOQUE_PRUEBA = Buffer.alloc(256 * 1024, 'CampusCare');
app.get('/api/red/prueba', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/octet-stream').send(BLOQUE_PRUEBA);
});

/* Código QR en SVG para compartir el enlace de registro (solo direcciones de esta misma aplicación) */
app.get('/api/qr', (req, res, next) => {
  const texto = String(req.query.texto || '');
  let host = null;
  try { host = new URL(texto).host; } catch { /* no es una dirección */ }
  if (!host || host !== req.headers.host || texto.length > 300) return next(new ErrorHttp(400, 'Solo se generan códigos QR de enlaces de esta aplicación.'));
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('image/svg+xml').send(qr.svg(texto));
});

app.use('/api/auth', require('./routes/auth'));

/* ---------- Rutas protegidas (requieren token JWT) ---------- */
app.get('/api/eventos', requiereSesion, eventos.conectar);
app.use('/api/catalogo', requiereSesion, require('./routes/catalogo'));
app.use('/api/tickets', requiereSesion, require('./routes/tickets'));
app.use('/api/notificaciones', requiereSesion, require('./routes/notificaciones'));
app.use('/api/usuarios', requiereSesion, requiereRol('admin'), require('./routes/usuarios'));
app.use('/api/admin', requiereSesion, requiereRol('admin'), require('./routes/admin'));
app.use('/api/push', requiereSesion, require('./routes/push'));
app.use('/api/red', requiereSesion, require('./routes/red'));
app.use('/api/invitaciones', requiereSesion, require('./routes/invitaciones'));
app.use('/api/bitacora', requiereSesion, require('./routes/bitacora'));
app.use('/api/sensores', requiereSesion, require('./routes/sensores'));

app.use('/api', (req, res, next) => next(new ErrorHttp(404, `No existe la ruta ${req.method} ${req.originalUrl}`)));

/* ---------- Vistas generadas en el servidor (SSR) ---------- */
app.get('/estado', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.send(vistas.paginaEstado(String(req.query.periodo || 'todo')));
});
app.get('/reporte', (req, res) => {
  const folio = String(req.query.folio || '').trim().toUpperCase();
  res.redirect(folio ? `/reporte/${encodeURIComponent(folio)}` : '/estado');
});
app.get('/reporte/:folio', (req, res) => {
  const { status, html } = vistas.paginaReporte(req.params.folio);
  res.setHeader('Cache-Control', 'no-cache');
  res.status(status).send(html);
});

/* ---------- Página de bienvenida y registro por enlace (misma aplicación de una sola página) ---------- */
const INDEX = path.join(__dirname, 'public', 'index.html');
for (const ruta of ['/bienvenida', '/registro', '/entrar']) {
  app.get(ruta, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(INDEX);
  });
}

/* ---------- Archivos del frontend y fotografías ---------- */
app.use('/uploads', express.static(UPLOADS, { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, ruta) {
    // El service worker y el manifest siempre se revisan contra el servidor para detectar versiones nuevas
    if (/(sw\.js|manifest\.webmanifest)$/.test(ruta)) res.setHeader('Cache-Control', 'no-cache');
  }
}));

/* ---------- Manejo de errores ---------- */
function traducirErrorSQLite(mensaje) {
  if (/FOREIGN KEY constraint failed/i.test(mensaje)) return 'No se puede completar: otros registros dependen de este (por ejemplo, tickets que lo usan) o la referencia no existe.';
  let m = mensaje.match(/UNIQUE constraint failed: ([\w., ]+)/i);
  if (m) return `Ya existe un registro con ese valor (${m[1]}).`;
  m = mensaje.match(/CHECK constraint failed: (.+)/i);
  if (m) return `Valor no permitido por la regla: ${m[1]}.`;
  m = mensaje.match(/NOT NULL constraint failed: ([\w.]+)/i);
  if (m) return `El campo ${m[1]} es obligatorio.`;
  if (/syntax error|no such (column|table)/i.test(mensaje)) return `Error en la consulta SQL: ${mensaje}`;
  if (/database is locked|SQLITE_BUSY/i.test(mensaje)) return 'La base de datos está ocupada por otro programa (cierra los cambios pendientes en DB Browser).';
  return null;
}

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'La información enviada es demasiado grande (máximo 12 MB).' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido.' });
  if (err.status) return res.status(err.status).json({ error: err.message });
  const traducido = traducirErrorSQLite(err.message || '');
  if (traducido) return res.status(400).json({ error: traducido, detalle: err.message });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

/* ---------- Inicio ---------- */
const servidor = app.listen(PUERTO, () => {
  const red = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal);
  console.log(`
  ==========================================================
    CampusCare · Servidor en marcha
  ----------------------------------------------------------
    En esta computadora:  http://localhost:${PUERTO}
    ${red ? `En tu celular (misma red Wi-Fi):  http://${red.address}:${PUERTO}` : ''}
    Base de datos:  ${DB_PATH}
    ${sembrada ? `Se cargaron datos de demostración (contraseña: ${PASSWORD_DEMO})` : 'Usando los datos guardados'}
    Para detener el servidor presiona  Ctrl + C
  ==========================================================
`);
});

servidor.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  El puerto ${PUERTO} ya está en uso. Cierra la otra terminal donde corre el servidor o usa otro puerto.\n`);
    process.exit(1);
  }
  throw err;
});
