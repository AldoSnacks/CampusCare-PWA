/* =========================================================
   Pruebas automatizadas del servidor (backend + vistas SSR)
   Ejecutar con:  npm test
   Cada ejecución arranca el servidor en un puerto libre con
   una base de datos temporal, así no toca tus datos.
   ========================================================= */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PUERTO = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PUERTO}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'campuscare-test-'));
const FOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAEhgGAWw9kpwAAAABJRU5ErkJggg==';
let servidor;
const tokens = {};
let folioAsignado = null;

async function pedir(ruta, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + ruta, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const tipo = res.headers.get('content-type') || '';
  const datos = tipo.includes('json') ? await res.json() : await res.text();
  return { status: res.status, datos, headers: res.headers };
}
async function entrar(correo) {
  const r = await pedir('/api/auth/login', { method: 'POST', body: { correo, password: 'Campus2026' } });
  assert.equal(r.status, 200, r.datos.error);
  return r.datos.token;
}
const reporteValido = extra => ({
  edificio: 'B', nivel: 'PB', espacio: 'Aula B-101', activo: 'Proyector', categoria: 'Red/TI', severidad: 'Media',
  descripcion: 'El proyector del aula no enciende desde la mañana.', foto: FOTO, ...extra
});

before(async () => {
  servidor = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PUERTO), DB_PATH: path.join(DIR, 'prueba.db') },
    stdio: 'ignore'
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/api/salud`)).ok) break; } catch { /* aún arrancando */ }
    await new Promise(r => setTimeout(r, 150));
  }
  tokens.alumno = await entrar('alumno@institucion.edu.mx');
  tokens.admin = await entrar('admin@institucion.edu.mx');
  tokens.tecnico = await entrar('tecnico@institucion.edu.mx');
});
after(() => { servidor?.kill(); fs.rmSync(DIR, { recursive: true, force: true }); });

/* ---------- Servidor y autenticación ---------- */
test('P01 · El servidor responde y usa SQLite', async () => {
  const r = await pedir('/api/salud');
  assert.equal(r.status, 200);
  assert.equal(r.datos.ok, true);
  assert.match(r.datos.baseDeDatos, /\.db$/);
});

test('P02 · El inicio de sesión rechaza una contraseña incorrecta', async () => {
  const r = await pedir('/api/auth/login', { method: 'POST', body: { correo: 'alumno@institucion.edu.mx', password: 'otra' } });
  assert.equal(r.status, 401);
});

test('P03 · Solo se aceptan correos institucionales', async () => {
  const r = await pedir('/api/auth/login', { method: 'POST', body: { correo: 'alguien@gmail.com', password: 'Campus2026' } });
  assert.equal(r.status, 400);
});

test('P04 · Las rutas protegidas exigen token JWT', async () => {
  assert.equal((await pedir('/api/tickets')).status, 401);
  assert.equal((await pedir('/api/tickets', { token: 'token.falso.123' })).status, 401);
});

test('P05 · Un alumno no puede entrar al panel de administración', async () => {
  const r = await pedir('/api/admin/tablas', { token: tokens.alumno });
  assert.equal(r.status, 403);
});

/* ---------- Datos remotos: tickets ---------- */
test('P06 · El catálogo trae edificios, niveles, categorías y severidades', async () => {
  const r = await pedir('/api/catalogo', { token: tokens.alumno });
  assert.equal(r.status, 200);
  assert.ok(r.datos.edificios.length >= 4);
  assert.ok(r.datos.categorias.length >= 5);
  assert.ok(r.datos.severidades.length === 3);
});

test('P07 · No se acepta un reporte sin fotografía', async () => {
  const r = await pedir('/api/tickets', { method: 'POST', token: tokens.alumno, body: reporteValido({ foto: '' }) });
  assert.equal(r.status, 400);
  assert.match(r.datos.error, /fotograf/i);
});

test('P08 · Se crea un reporte con coordenadas GPS del dispositivo', async () => {
  const r = await pedir('/api/tickets', { method: 'POST', token: tokens.alumno, body: reporteValido({ gps: { lat: 19.04141, lng: -98.20632, precision: 12 } }) });
  assert.equal(r.status, 201);
  assert.match(r.datos.folio, /^CC-\d+$/);
  const lista = await pedir('/api/tickets', { token: tokens.alumno });
  const t = lista.datos.find(x => x.id === r.datos.folio);
  assert.deepEqual(t.gps, { lat: 19.04141, lng: -98.20632, precision: 12 });
});

test('P09 · Se rechazan coordenadas GPS fuera de rango', async () => {
  const r = await pedir('/api/tickets', { method: 'POST', token: tokens.alumno, body: reporteValido({ gps: { lat: 120, lng: 0 } }) });
  assert.equal(r.status, 400);
});

test('P10 · La cola offline no duplica reportes (mismo clienteId → mismo folio)', async () => {
  const clienteId = `prueba-${Date.now()}`;
  const a = await pedir('/api/tickets', { method: 'POST', token: tokens.alumno, body: reporteValido({ clienteId }) });
  const b = await pedir('/api/tickets', { method: 'POST', token: tokens.alumno, body: reporteValido({ clienteId }) });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(a.datos.folio, b.datos.folio);
});

test('P11 · La máquina de estados respeta los permisos por rol', async () => {
  const { datos } = await pedir('/api/tickets', { method: 'POST', token: tokens.alumno, body: reporteValido() });
  const porAlumno = await pedir(`/api/tickets/${datos.folio}/transicion`, { method: 'POST', token: tokens.alumno, body: { estado: 'Asignado', tecnico: 'tecnico@institucion.edu.mx' } });
  assert.equal(porAlumno.status, 403);
  const porAdmin = await pedir(`/api/tickets/${datos.folio}/transicion`, { method: 'POST', token: tokens.admin, body: { estado: 'Asignado', tecnico: 'tecnico@institucion.edu.mx' } });
  assert.equal(porAdmin.status, 200);
  folioAsignado = datos.folio;
});

test('P12 · Cada cambio de estado genera una notificación para el usuario', async () => {
  const r = await pedir('/api/notificaciones', { token: tokens.tecnico });
  assert.equal(r.status, 200);
  assert.ok(r.datos.some(n => n.title === `Nueva orden ${folioAsignado}`), 'el técnico debe recibir la nueva orden');
  const alumno = await pedir('/api/notificaciones', { token: tokens.alumno });
  assert.ok(alumno.datos.some(n => n.title === `${folioAsignado} · Asignado`), 'el alumno debe recibir el cambio de estado');
});

/* ---------- Mapa de calor y vistas del servidor ---------- */
test('P13 · El mapa de calor se calcula en el servidor y cuadra con los totales', async () => {
  const r = await pedir('/api/publico/mapa-calor');
  assert.equal(r.status, 200);
  const suma = r.datos.categoria.matriz.flat().reduce((a, b) => a + b, 0);
  assert.equal(suma, r.datos.total);
  assert.equal(r.datos.categoria.matriz.length, r.datos.edificios.length);
  assert.ok(r.datos.nivel.matriz.flat().includes(null), 'debe marcar niveles que no existen');
});

test('P14 · /estado es una vista generada en el servidor (HTML completo)', async () => {
  const r = await pedir('/estado');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.datos, /Mapa de calor · Edificio × Categoría/);
  assert.match(r.datos, /<table class="hm">/);
  assert.match(r.datos, /Página generada en el servidor/);
});

test('P15 · /reporte/:folio muestra el seguimiento sin datos personales', async () => {
  const ok = await pedir('/reporte/CC-1001');
  assert.equal(ok.status, 200);
  assert.match(ok.datos, /Reporte CC-1001/);
  assert.doesNotMatch(ok.datos, /@institucion\.edu\.mx/);
  const no = await pedir('/reporte/CC-99999');
  assert.equal(no.status, 404);
});

/* ---------- Archivos de la PWA ---------- */
test('P16 · El manifest es válido para instalar la app', async () => {
  const r = await pedir('/manifest.webmanifest');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /manifest\+json|json/);
  const m = typeof r.datos === 'string' ? JSON.parse(r.datos) : r.datos;
  assert.ok(m.name && m.short_name && m.start_url);
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some(i => i.sizes === '192x192'));
  assert.ok(m.icons.some(i => i.sizes === '512x512'));
  assert.ok(m.icons.some(i => i.purpose === 'maskable'));
});

test('P17 · El service worker se sirve sin caché HTTP para poder actualizarse', async () => {
  const r = await pedir('/sw.js');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control') || '', /no-cache/);
  assert.match(r.datos, /addEventListener\('fetch'/);
  assert.match(r.datos, /addEventListener\('push'/);
  assert.match(r.datos, /addEventListener\('sync'/);
});

test('P18 · La página sin conexión existe', async () => {
  const r = await pedir('/offline.html');
  assert.equal(r.status, 200);
  assert.match(r.datos, /No hay conexión/);
});

/* ---------- Notificaciones push ---------- */
test('P19 · El servidor publica su llave VAPID', async () => {
  const r = await pedir('/api/push/clave');
  assert.equal(r.status, 200);
  assert.match(r.datos.clave, /^[A-Za-z0-9_-]{80,}$/);
});

test('P20 · Se valida y guarda la suscripción push del dispositivo', async () => {
  const mala = await pedir('/api/push/suscripcion', { method: 'POST', token: tokens.alumno, body: { endpoint: 'http://inseguro' } });
  assert.equal(mala.status, 400);
  // Llaves reales de curva P-256 como las que genera el navegador al suscribirse
  const ecdh = require('node:crypto').createECDH('prime256v1');
  ecdh.generateKeys();
  const sub = { endpoint: 'https://push.example.test/sub/123', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: require('node:crypto').randomBytes(16).toString('base64url') } };
  const ok = await pedir('/api/push/suscripcion', { method: 'POST', token: tokens.alumno, body: sub });
  assert.equal(ok.status, 201);
  const prueba = await pedir('/api/push/prueba', { method: 'POST', token: tokens.alumno });
  assert.equal(prueba.status, 200);
  assert.equal(prueba.datos.total, 1);
});
