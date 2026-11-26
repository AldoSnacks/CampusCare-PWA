/* =========================================================
   CampusCare · Service Worker
   - Caché del app shell, imágenes y datos de la API
   - Página sin conexión
   - Notificaciones push
   - Sincronización en segundo plano de reportes guardados offline
   ========================================================= */
'use strict';

const VERSION = 'v4.1.0';
const CACHE_APP = `campuscare-app-${VERSION}`;
const CACHE_IMG = 'campuscare-imagenes';
const CACHE_API = 'campuscare-api';
const CACHE_FUENTES = 'campuscare-fuentes';
const MAX_IMAGENES = 80;

/* Archivos mínimos para abrir la aplicación sin internet (app shell) */
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/pwa.css',
  '/ssr.css',
  '/app.js',
  '/admin.js',
  '/pwa.js',
  '/equipo/equipo.css',
  '/equipo/integracion.js',
  '/equipo/sin-conexion.js',
  '/equipo/reporte-visual.js',
  '/equipo/auditoria-red.js',
  '/equipo/historial.js',
  '/equipo/monitoreo.js',
  '/equipo/bienvenida.js',
  '/manifest.webmanifest',
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/img/logo.png'
];

/* ---------- Instalación: precarga del app shell ---------- */
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_APP).then(cache => cache.addAll(APP_SHELL)));
});

/* ---------- Activación: borra cachés de versiones anteriores ---------- */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres
      .filter(n => n.startsWith('campuscare-app-') && n !== CACHE_APP)
      .map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

/* ---------- Mensajes desde la página ---------- */
self.addEventListener('message', event => {
  const { tipo } = event.data || {};
  if (tipo === 'saltar-espera') self.skipWaiting();
  if (tipo === 'limpiar-api') event.waitUntil(caches.delete(CACHE_API));
  if (tipo === 'version') event.source?.postMessage({ tipo: 'version', version: VERSION });
  if (tipo === 'enviar-pendientes') event.waitUntil(enviarPendientes());
});

/* ---------- Intercepción de peticiones: elección de estrategia ---------- */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST, PUT, DELETE siempre van a la red
  const url = new URL(req.url);

  if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    event.respondWith(cachePrimero(req, CACHE_FUENTES));
    return;
  }
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // No se guardan: tiempo real, administración, push, sesión (token) ni las pruebas de red de la auditoría Wi-Fi
    if (url.pathname === '/api/eventos' || /^\/api\/(admin|push|auth)\//.test(url.pathname) || /^\/api\/red\/(ping|prueba)/.test(url.pathname)) return;
    event.respondWith(redPrimero(req));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(navegacion(req));
    return;
  }
  if (/\.(png|jpe?g|webp|svg|ico)$/i.test(url.pathname)) {
    event.respondWith(cachePrimero(req, CACHE_IMG, MAX_IMAGENES));
    return;
  }
  event.respondWith(cacheYActualiza(req));
});

/* Red primero (API): datos frescos y, sin conexión, la última copia guardada */
async function redPrimero(req) {
  const cache = await caches.open(CACHE_API);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const guardada = await cache.match(req);
    if (guardada) {
      const cuerpo = await guardada.blob();
      const headers = new Headers(guardada.headers);
      headers.set('X-Desde-Cache', 'service-worker');
      return new Response(cuerpo, { status: 200, headers });
    }
    return new Response(JSON.stringify({ error: 'Sin conexión: este dato todavía no se ha guardado en el dispositivo.', offline: true }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    });
  }
}

/* Caché primero (imágenes y fuentes) */
async function cachePrimero(req, nombre, maximo) {
  const cache = await caches.open(nombre);
  const guardada = await cache.match(req);
  if (guardada) return guardada;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') {
      await cache.put(req, res.clone());
      if (maximo) recortar(cache, maximo);
    }
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

/* Stale-while-revalidate (CSS y JavaScript): respuesta inmediata y actualización en segundo plano */
async function cacheYActualiza(req) {
  const cache = await caches.open(CACHE_APP);
  const guardada = await cache.match(req, { ignoreSearch: true });
  const deRed = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return guardada || (await deRed) || new Response('', { status: 504 });
}

/* Navegación: red primero; sin conexión, la copia guardada o la página offline */
async function navegacion(req) {
  const cache = await caches.open(CACHE_APP);
  const url = new URL(req.url);
  const esApp = url.pathname === '/' || url.pathname === '/index.html';
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(esApp ? '/' : req, res.clone());
    return res;
  } catch {
    return (await cache.match(esApp ? '/' : req, { ignoreSearch: esApp }))
      || (await cache.match('/offline.html'));
  }
}

/* Mantiene la caché de imágenes por debajo del máximo (borra las más antiguas) */
async function recortar(cache, maximo) {
  const claves = await cache.keys();
  for (let i = 0; i < claves.length - maximo; i++) await cache.delete(claves[i]);
}

/* =========================================================
   Notificaciones push
   ========================================================= */
self.addEventListener('push', event => {
  let datos = {};
  try { datos = event.data ? event.data.json() : {}; } catch { datos = { body: event.data?.text() }; }
  const titulo = datos.title || 'CampusCare';
  // Las alertas críticas (severidad Crítica o zona muerta de Wi-Fi) no se cierran solas y vibran más
  const alerta = /^Alerta crítica/i.test(titulo);
  event.waitUntil((async () => {
    await self.registration.showNotification(titulo, {
      body: datos.body || 'Hay una actualización en tus reportes.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: alerta ? `alerta-${datos.folio || Date.now()}` : (datos.folio || 'campuscare'),
      renotify: true,
      requireInteraction: alerta,
      vibrate: alerta ? [300, 120, 300, 120, 300] : [120, 60, 120],
      data: { url: datos.url || '/', folio: datos.folio || null },
      actions: [{ action: 'abrir', title: 'Ver en CampusCare' }]
    });
    // Si la app está abierta, se le avisa para que vuelva a pedir los datos
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    ventanas.forEach(c => c.postMessage({ tipo: 'push', datos }));
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destino = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const abierta = ventanas.find(c => new URL(c.url).origin === self.location.origin);
    if (abierta) {
      await abierta.focus();
      abierta.postMessage({ tipo: 'abrir', folio: event.notification.data?.folio, url: destino });
      return;
    }
    await self.clients.openWindow(destino);
  })());
});

/* =========================================================
   Sincronización en segundo plano (cambios hechos sin internet)
   La página guarda en IndexedDB cada cambio (reporte nuevo,
   edición, cambio de estado, borrado o auditoría Wi-Fi) y
   registra el evento "enviar-reportes"; el navegador lo
   dispara al volver la red. Se envían en el orden en que se
   hicieron (módulo "sin conexión" de Adrián Olmedo).
   ========================================================= */
self.addEventListener('sync', event => {
  if (event.tag === 'enviar-reportes') event.waitUntil(enviarPendientes());
});

function abrirBD() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open('campuscare-local', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('borradores')) db.createObjectStore('borradores');
      if (!db.objectStoreNames.contains('pendientes')) db.createObjectStore('pendientes', { keyPath: 'clienteId' });
      if (!db.objectStoreNames.contains('sesion')) db.createObjectStore('sesion');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}
function operacion(db, almacen, modo, fn) {
  return new Promise((ok, mal) => {
    const tx = db.transaction(almacen, modo);
    const r = fn(tx.objectStore(almacen));
    tx.oncomplete = () => ok(r?.result);
    tx.onerror = () => mal(tx.error);
  });
}

let enviando = null;
function enviarPendientes() {
  if (enviando) return enviando;
  enviando = (async () => {
    const db = await abrirBD();
    const token = await operacion(db, 'sesion', 'readonly', s => s.get('token'));
    const pendientes = await operacion(db, 'pendientes', 'readonly', s => s.getAll());
    if (!token || !pendientes?.length) return;
    let uid = null;
    try { uid = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).uid; } catch { return; }
    // Solo los cambios del usuario con sesión abierta, en el orden en que se hicieron
    const cola = pendientes.filter(x => !x.error && x.uid === uid).sort((a, b) => a.creado - b.creado);
    const folios = {}; // folio provisional (LOCAL-0001) → folio real (CC-1030)
    for (const original of cola) {
      let p = original;
      for (const [local, real] of Object.entries(folios)) {
        if (p.folio === local || (p.ruta || '').includes(local)) p = { ...p, folio: real, ruta: p.ruta.replace(local, encodeURIComponent(real)) };
      }
      const metodo = p.metodo || 'POST';
      const tipo = p.tipo || 'crear';
      const res = await fetch(`/api${p.ruta || '/tickets'}`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Modulo': 'sin-conexion' },
        body: metodo === 'DELETE' ? undefined : JSON.stringify(p.datos)
      }); // si no hay red, fetch lanza un error, se detiene la cola y el navegador reintenta más tarde
      const cuerpo = await res.json().catch(() => ({}));
      if (res.status === 401) return; // sesión expirada: se intentará al volver a iniciar sesión
      if (res.ok) {
        await operacion(db, 'pendientes', 'readwrite', s => s.delete(p.clienteId));
        if (tipo === 'crear' && p.folioLocal && cuerpo.folio) {
          folios[p.folioLocal] = cuerpo.folio;
          await reescribirFolios(db, p.folioLocal, cuerpo.folio);
        }
        avisar(tipo === 'crear' ? { tipo: 'reporte-enviado', clienteId: p.clienteId, folio: cuerpo.folio } : { tipo: 'op-enviada', etiqueta: p.etiqueta, folio: cuerpo.folio });
      } else if (tipo === 'crear') {
        // Un reporte nuevo se conserva con el motivo para que la persona lo corrija o lo descarte
        await operacion(db, 'pendientes', 'readwrite', s => s.put({ ...p, error: cuerpo.error || `Error ${res.status}` }));
        avisar({ tipo: 'reporte-error', clienteId: p.clienteId, error: cuerpo.error });
      } else {
        // Cambio rechazado por el servidor (permisos o estado distinto): se descarta y se avisa
        await operacion(db, 'pendientes', 'readwrite', s => s.delete(p.clienteId));
        avisar({ tipo: 'op-descartada', etiqueta: p.etiqueta, error: cuerpo.error || `Error ${res.status}` });
      }
    }
  })().finally(() => { enviando = null; });
  return enviando;
}
/* Cambia el folio provisional por el real en los cambios que siguen en la cola */
async function reescribirFolios(db, local, real) {
  const todos = await operacion(db, 'pendientes', 'readonly', s => s.getAll());
  for (const p of todos) {
    if (p.folio === local || (p.ruta || '').includes(local)) {
      await operacion(db, 'pendientes', 'readwrite', s => s.put({ ...p, folio: real, ruta: p.ruta.replace(local, encodeURIComponent(real)), etiqueta: (p.etiqueta || '').replace(local, real) }));
    }
  }
}
async function avisar(mensaje) {
  const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  ventanas.forEach(c => c.postMessage(mensaje));
}
