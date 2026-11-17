/* =========================================================
   Notificaciones push (PWA) con el protocolo Web Push + VAPID
   - Las llaves VAPID se toman de variables de entorno o se
     generan la primera vez y se guardan en database/vapid.json
   - Cada notificación que se guarda en la base de datos se
     envía también como push a los dispositivos del usuario
   ========================================================= */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const webpush = require('web-push');
const { conexion } = require('./db');

const ARCHIVO_LLAVES = path.join(__dirname, '..', 'database', 'vapid.json');
let llaves = null;

function configurar() {
  if (llaves) return llaves;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    llaves = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    try {
      llaves = JSON.parse(fs.readFileSync(ARCHIVO_LLAVES, 'utf8'));
    } catch {
      llaves = webpush.generateVAPIDKeys();
      fs.mkdirSync(path.dirname(ARCHIVO_LLAVES), { recursive: true });
      fs.writeFileSync(ARCHIVO_LLAVES, JSON.stringify(llaves, null, 2));
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:soporte@institucion.edu.mx', llaves.publicKey, llaves.privateKey);
  return llaves;
}

const clavePublica = () => configurar().publicKey;

function guardarSuscripcion(usuarioId, sub, agente = '') {
  const endpoint = String(sub?.endpoint || '');
  const p256dh = sub?.keys?.p256dh, auth = sub?.keys?.auth;
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) {
    const e = new Error('La suscripción push no es válida.'); e.status = 400; throw e;
  }
  conexion().prepare(`
    INSERT INTO suscripciones_push (usuario_id, endpoint, p256dh, auth, agente) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET usuario_id = excluded.usuario_id, p256dh = excluded.p256dh, auth = excluded.auth, agente = excluded.agente`)
    .run(usuarioId, endpoint, p256dh, auth, String(agente).slice(0, 200));
}

function borrarSuscripcion(usuarioId, endpoint) {
  return conexion().prepare('DELETE FROM suscripciones_push WHERE usuario_id = ? AND endpoint = ?').run(usuarioId, String(endpoint || '')).changes;
}

/* Envía un mensaje a todos los dispositivos de un usuario */
async function enviarAUsuario(usuarioId, mensaje) {
  configurar();
  const db = conexion();
  const subs = db.prepare('SELECT * FROM suscripciones_push WHERE usuario_id = ?').all(usuarioId);
  const resultados = await Promise.allSettled(subs.map(s =>
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(mensaje), { TTL: 60 * 60 * 24 })
  ));
  resultados.forEach((r, i) => {
    // 404 o 410: el navegador ya no existe o canceló el permiso → se elimina la suscripción
    if (r.status === 'rejected' && [404, 410].includes(r.reason?.statusCode)) {
      db.prepare('DELETE FROM suscripciones_push WHERE id = ?').run(subs[i].id);
    }
  });
  return { enviadas: resultados.filter(r => r.status === 'fulfilled').length, total: subs.length };
}

/* Se llama al guardar una notificación; espera a que termine la transacción */
function programar(notificacionId) {
  setImmediate(async () => {
    try {
      const n = conexion().prepare(`
        SELECT n.*, t.folio FROM notificaciones n LEFT JOIN tickets t ON t.id = n.ticket_id WHERE n.id = ?`).get(notificacionId);
      if (!n) return; // la transacción se revirtió
      await enviarAUsuario(n.usuario_id, { title: n.titulo, body: n.mensaje, folio: n.folio, url: n.folio ? `/#notificaciones` : '/' });
    } catch (e) {
      console.error('  Push no enviado:', e.message);
    }
  });
}

module.exports = { clavePublica, guardarSuscripcion, borrarSuscripcion, enviarAUsuario, programar };
