/* =========================================================
   CampusCare · Funciones de Aplicación Web Progresiva (PWA)
   Se carga después de app.js y amplía la aplicación con:
     1. Registro del service worker, actualización e instalación
     2. Datos locales (IndexedDB): sesión, borrador y cola offline
     3. Modo sin conexión: aviso de red y envío automático al volver
     4. Notificaciones push (Web Push + VAPID)
     5. Elementos físicos del dispositivo: cámara, GPS y vibración
     6. Compartir el seguimiento de un reporte (Web Share)
   ========================================================= */
'use strict';

/* ---------- Iconos adicionales ---------- */
Object.assign(ICONOS, {
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  wifiOff: '<path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.1-1.6M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8a15 15 0 0 0-10-3.8"/><circle cx="12" cy="20" r="1"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  gps: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
  flip: '<path d="M4 7h13l-3-3M20 17H7l3 3"/>'
});

const PWA = {
  registro: null,
  instalador: null,
  pendientes: [],
  push: { soportado: 'serviceWorker' in navigator && 'PushManager' in window, activo: false },
  datosDeCache: false
};

const vibrar = patron => { try { if ('vibrate' in navigator) navigator.vibrate(patron); } catch { /* sin motor de vibración */ } };
const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const uidDeToken = token => { try { return desdeB64url(token.split('.')[1]).uid; } catch { return null; } };

/* =========================================================
   1. DATOS LOCALES — IndexedDB
   borradores: el reporte que se está escribiendo
   pendientes: reportes hechos sin conexión (cola de envío)
   sesion:     copia del token para mantener la sesión y para el service worker
   ========================================================= */
const LocalDB = {
  _db: null,
  abrir() {
    if (this._db) return this._db;
    this._db = new Promise((ok, mal) => {
      if (!('indexedDB' in window)) return mal(new Error('IndexedDB no disponible'));
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
    return this._db;
  },
  async _op(almacen, modo, fn) {
    const db = await this.abrir();
    return new Promise((ok, mal) => {
      const tx = db.transaction(almacen, modo);
      const r = fn(tx.objectStore(almacen));
      tx.oncomplete = () => ok(r?.result);
      tx.onerror = () => mal(tx.error);
    });
  },
  get: (a, k) => LocalDB._op(a, 'readonly', s => s.get(k)),
  todos: a => LocalDB._op(a, 'readonly', s => s.getAll()),
  poner: (a, v, k) => LocalDB._op(a, 'readwrite', s => (k === undefined ? s.put(v) : s.put(v, k))),
  borrar: (a, k) => LocalDB._op(a, 'readwrite', s => s.delete(k))
};

/* ---------- Sesión persistente: el token también se guarda en IndexedDB ---------- */
const _guardarToken = Auth.guardar.bind(Auth);
Auth.guardar = function (token) {
  _guardarToken(token);
  LocalDB.poner('sesion', token, 'token').catch(() => {});
};
const _logout = Auth.logout.bind(Auth);
Auth.logout = function () {
  _logout();
  LocalDB.borrar('sesion', 'token').catch(() => {});
};

/* =========================================================
   2. SERVICE WORKER: registro, actualización e instalación
   ========================================================= */
async function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    PWA.registro = await navigator.serviceWorker.register('/sw.js');
    PWA.registro.addEventListener('updatefound', () => {
      const nuevo = PWA.registro.installing;
      nuevo?.addEventListener('statechange', () => {
        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) mostrarBanner('actualizacion');
      });
    });
    let recargando = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (PWA.actualizando && !recargando) { recargando = true; location.reload(); }
    });
    navigator.serviceWorker.addEventListener('message', e => mensajeDelServiceWorker(e.data || {}));
    await revisarPush();
  } catch (err) {
    console.warn('Service worker no registrado:', err.message);
  }
}

function mensajeDelServiceWorker(m) {
  if (m.tipo === 'push') { vibrar([120, 60, 120]); if (Auth.sesion()) sincronizar().catch(() => {}); }
  if (m.tipo === 'abrir' && Auth.sesion()) { if (m.folio && DB.ticket(m.folio)) abrirDetalle(m.folio); else navegar('notificaciones'); }
  if (m.tipo === 'reporte-enviado') {
    vibrar([60, 40, 60]);
    toast('Reporte enviado', `El reporte guardado sin conexión ya está en el servidor con el folio ${m.folio}.`);
    cargarPendientes().then(() => Auth.sesion() && sincronizar().catch(() => {}));
  }
  if (m.tipo === 'reporte-error') { toast('Un reporte pendiente no se pudo enviar', m.error || 'Revisa sus datos.', 'error'); cargarPendientes(); }
}

/* Instalación: el navegador avisa cuando la app cumple los requisitos */
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  PWA.instalador = e;
  $$('[data-install]').forEach(b => { b.hidden = false; });
});
window.addEventListener('appinstalled', () => {
  PWA.instalador = null;
  $$('[data-install]').forEach(b => { b.hidden = true; });
  toast('CampusCare instalada', 'Ya puedes abrirla desde el escritorio o la pantalla de inicio.');
});
const esStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
if (esStandalone()) document.body.classList.add('is-standalone');
else if (esIOS()) $$('[data-install]').forEach(b => { b.hidden = false; }); // iOS no tiene aviso automático

/* =========================================================
   3. MODO SIN CONEXIÓN
   ========================================================= */
const _fetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await _fetch(...args);
  const deCache = res.headers.get('X-Desde-Cache') === 'service-worker';
  if (String(args[0]).includes('/api/') && (deCache || res.ok) && deCache !== PWA.datosDeCache) {
    PWA.datosDeCache = deCache;
    actualizarRed();
  }
  return res;
};

function actualizarRed() {
  const offline = !navigator.onLine;
  document.body.classList.toggle('is-offline', offline);
  const pill = $('#netPill');
  if (pill) {
    pill.hidden = !offline && !PWA.datosDeCache;
    pill.innerHTML = offline ? `${icon('wifiOff')} Sin conexión` : `${icon('database')} Datos guardados`;
  }
  if (offline) mostrarBanner('offline');
  else if ($('#netBanner').dataset.tipo === 'offline') mostrarBanner('online');
}

function mostrarBanner(tipo) {
  const b = $('#netBanner');
  const textos = {
    offline: `${icon('wifiOff')}<span><b>Sin conexión.</b> Estás viendo los datos guardados en este dispositivo. Los reportes nuevos se guardan y se enviarán solos al volver el internet.</span>`,
    online: `${icon('wifi')}<span><b>Conexión restablecida.</b> Sincronizando con el servidor…</span>`,
    actualizacion: `${icon('refresh')}<span><b>Hay una nueva versión de CampusCare.</b></span><button class="btn btn-sm btn-light" data-action="actualizar-sw">Actualizar</button>`
  };
  b.dataset.tipo = tipo;
  b.className = `net-banner nb-${tipo}`;
  b.innerHTML = textos[tipo];
  b.hidden = false;
  clearTimeout(mostrarBanner.t);
  if (tipo === 'online') mostrarBanner.t = setTimeout(() => { b.hidden = true; b.dataset.tipo = ''; }, 3500);
}

window.addEventListener('offline', actualizarRed);
window.addEventListener('online', () => {
  PWA.datosDeCache = false;
  actualizarRed();
  enviarPendientes();
  if (Auth.sesion()) { sincronizar().catch(() => {}); conectarEventos(); }
});

/* ---------- Cola de reportes sin conexión ---------- */
async function cargarPendientes() {
  try {
    const s = Auth.sesion();
    const todos = await LocalDB.todos('pendientes');
    PWA.pendientes = s ? todos.filter(p => p.uid === s.id).sort((a, b) => a.creado - b.creado) : [];
  } catch { PWA.pendientes = []; }
  if (state.vista === 'mis-tickets' && !$('#app').hidden) renderVista();
  return PWA.pendientes;
}

async function encolarReporte(datos) {
  const s = Auth.sesion();
  const item = {
    clienteId: datos.clienteId, uid: s.id, datos, creado: Date.now(), error: null,
    resumen: { categoria: datos.categoria, severidad: datos.severidad, ubicacion: `Edif. ${datos.edificio} · ${datos.espacio}`, activo: datos.activo }
  };
  await LocalDB.poner('pendientes', item);
  try { if (PWA.registro?.sync) await PWA.registro.sync.register('enviar-reportes'); } catch { /* Background Sync no soportado */ }
  await cargarPendientes();
  return item;
}

let enviandoPendientes = null;
let reintento = { t: null, n: 0 };
/* Si la red tarda en estabilizarse, se vuelve a intentar con espera creciente (2, 4, 8… hasta 60 s) */
function programarReintento() {
  clearTimeout(reintento.t);
  reintento.t = setTimeout(async () => {
    const quedan = (await cargarPendientes()).filter(p => !p.error).length;
    if (!quedan) { reintento.n = 0; return; }
    reintento.n++;
    enviarPendientes();
  }, Math.min(60000, 2000 * 2 ** reintento.n));
}
async function enviarPendientes() {
  if (!navigator.onLine || !Auth.sesion()) return;
  if (navigator.serviceWorker?.controller) {
    // El service worker envía la cola (también funciona con la app cerrada vía Background Sync)
    navigator.serviceWorker.controller.postMessage({ tipo: 'enviar-pendientes' });
    programarReintento();
    return;
  }
  // Sin service worker (por ejemplo, http en la red local): la página envía la cola
  if (enviandoPendientes) return enviandoPendientes;
  enviandoPendientes = (async () => {
    for (const p of (await cargarPendientes()).filter(x => !x.error)) {
      try {
        const r = await api('/tickets', { method: 'POST', body: p.datos });
        await LocalDB.borrar('pendientes', p.clienteId);
        mensajeDelServiceWorker({ tipo: 'reporte-enviado', folio: r.folio });
      } catch (err) {
        if (/conexión/i.test(err.message)) break;
        await LocalDB.poner('pendientes', { ...p, error: err.message });
      }
    }
    await cargarPendientes();
  })().finally(() => { enviandoPendientes = null; });
  return enviandoPendientes;
}

/* Tickets.crear: si no hay red, el reporte se guarda en la cola local */
const _crearTicket = Tickets.crear.bind(Tickets);
Tickets.crear = async function (d) {
  const datos = { ...d, clienteId: d.clienteId || nuevoId() };
  if (!navigator.onLine) {
    validarReporteLocal(datos);
    return { encolado: true, ...(await encolarReporte(datos)) };
  }
  try {
    return await _crearTicket(datos);
  } catch (err) {
    if (/conexión/i.test(err.message)) return { encolado: true, ...(await encolarReporte(datos)) };
    throw err;
  }
};
function validarReporteLocal(d) {
  const requeridos = [['edificio', 'el edificio'], ['nivel', 'el nivel'], ['espacio', 'el espacio o aula'], ['activo', 'el activo afectado'], ['categoria', 'la categoría del problema'], ['severidad', 'la severidad']];
  for (const [k, l] of requeridos) if (!d[k]) throw new Error(`Selecciona ${l}.`);
  if (!d.foto) throw new Error('Captura una fotografía como evidencia de la incidencia.');
  if (!d.descripcion || d.descripcion.trim().length < 10) throw new Error('Describe el problema con al menos 10 caracteres.');
}

FORMULARIOS.reporte = async function (form) {
  const datos = { ...state.reporte, descripcion: form.descripcion.value };
  const t = await Tickets.crear(datos);
  state.reporte = nuevoReporte();
  borrarBorrador();
  const s = Auth.sesion();
  if (t.encolado) {
    vibrar([60, 40, 60]);
    toast('Guardado sin conexión', 'El reporte quedó en este dispositivo y se enviará automáticamente cuando vuelva el internet.', 'info');
    navegar(s.role === 'admin' ? 'reportar' : 'mis-tickets');
    return;
  }
  vibrar(80);
  toast('Reporte enviado', `Tu folio es ${t.id}. Te avisaremos en cada cambio de estado.`);
  navegar(s.role === 'admin' ? 'dashboard' : 'mis-tickets');
  abrirDetalle(t.id);
};

/* Tarjeta de reportes pendientes en "Mis reportes" */
function pendientesHTML() {
  if (!PWA.pendientes.length) return '';
  return `<section class="card pend-card">
    <div class="pend-head">${icon('upload')}<div><h3>Pendientes de envío (${PWA.pendientes.length})</h3>
      <p class="muted small">Guardados en este dispositivo (IndexedDB). Se envían solos cuando hay conexión.</p></div></div>
    ${PWA.pendientes.map(p => `
      <div class="pend-item ${p.error ? 'has-error' : ''}">
        <div><strong>${esc(p.resumen.categoria)} · ${esc(p.resumen.activo)}</strong>
          <small>${esc(p.resumen.ubicacion)} · ${esc(p.resumen.severidad)} · guardado ${hace(p.creado)}</small>
          ${p.error ? `<small class="pend-err">${esc(p.error)}</small>` : `<small class="pend-ok">${navigator.onLine ? 'Enviando…' : 'Esperando conexión'}</small>`}</div>
        <div class="btn-row">
          ${p.error ? `<button class="btn btn-sm btn-ghost" data-action="pend-reintentar" data-id="${p.clienteId}">${icon('refresh')} Reintentar</button>` : ''}
          <button class="btn btn-sm btn-ghost" data-action="pend-descartar" data-id="${p.clienteId}">${icon('trash')} Descartar</button>
        </div>
      </div>`).join('')}
  </section>`;
}
const _renderMis = RENDER['mis-tickets'];
RENDER['mis-tickets'] = s => pendientesHTML() + _renderMis(s);

ACCIONES['pend-descartar'] = async id => {
  if (!confirm('¿Descartar este reporte guardado sin conexión?')) return;
  await LocalDB.borrar('pendientes', id);
  await cargarPendientes();
};
ACCIONES['pend-reintentar'] = async id => {
  const p = await LocalDB.get('pendientes', id);
  if (p) await LocalDB.poner('pendientes', { ...p, error: null });
  await cargarPendientes();
  enviarPendientes();
};
ACCIONES['actualizar-sw'] = () => {
  PWA.actualizando = true;
  PWA.registro?.waiting?.postMessage({ tipo: 'saltar-espera' });
};
ACCIONES.instalar = async () => {
  if (PWA.instalador) {
    PWA.instalador.prompt();
    const { outcome } = await PWA.instalador.userChoice;
    if (outcome === 'accepted') PWA.instalador = null;
    return;
  }
  if (esIOS()) toast('Instalar en iPhone o iPad', 'Toca el botón Compartir de Safari y elige "Agregar a pantalla de inicio".', 'info');
};

/* ---------- Borrador del reporte (se recupera aunque se cierre la app) ---------- */
let borradorGuardado = null;
let borradorRecuperado = false; // muestra el aviso mientras se termina el reporte
let temporizadorBorrador;
function guardarBorrador() {
  clearTimeout(temporizadorBorrador);
  temporizadorBorrador = setTimeout(() => {
    const r = state.reporte;
    const tieneDatos = r.edificio || r.categoria || r.severidad || r.foto || r.descripcion || r.gps;
    (tieneDatos ? LocalDB.poner('borradores', { ...r, guardado: Date.now() }, 'reporte') : LocalDB.borrar('borradores', 'reporte')).catch(() => {});
  }, 400);
}
function borrarBorrador() {
  clearTimeout(temporizadorBorrador);
  borradorGuardado = null;
  borradorRecuperado = false;
  LocalDB.borrar('borradores', 'reporte').catch(() => {});
}
const _actualizarResumen = actualizarResumen;
actualizarResumen = function () { _actualizarResumen(); guardarBorrador(); };
document.addEventListener('change', e => { if (e.target.closest('[data-form="reporte"]')) guardarBorrador(); });
const _limpiar = ACCIONES['limpiar-reporte'];
ACCIONES['limpiar-reporte'] = (...a) => { borrarBorrador(); return _limpiar(...a); };

/* =========================================================
   4. GPS, CÁMARA Y VIBRACIÓN (elementos físicos del dispositivo)
   ========================================================= */
function gpsHTML(g) {
  const soportado = 'geolocation' in navigator;
  return `<div class="form-step" id="gpsStep">
    <div class="step-head"><span class="step-n">5</span><div><h3>Ubicación GPS <span class="muted small">(opcional)</span></h3>
      <p class="muted small">Adjunta las coordenadas del dispositivo para ubicar la falla en el mapa del campus.</p></div></div>
    <div class="gps-box ${g ? 'has-gps' : ''}" id="gpsBox">
      ${g ? `<div class="gps-ok">${icon('gps')}<div><strong>${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}</strong>
               <small>Precisión aproximada de ${Math.round(g.precision)} m · <a href="https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lng}#map=19/${g.lat}/${g.lng}" target="_blank" rel="noopener">ver en el mapa</a></small></div>
             <button type="button" class="btn btn-sm btn-ghost" data-action="gps-quitar">${icon('x')} Quitar</button></div>`
        : soportado ? `<button type="button" class="btn btn-ghost" data-action="gps">${icon('gps')} Adjuntar mi ubicación actual</button><small class="muted" id="gpsMsg"></small>`
          : '<small class="muted">Este navegador no permite usar el GPS.</small>'}
    </div>
  </div>`;
}
function borradorRecuperadoHTML() {
  return `<div class="alert alert-info draft-note">${icon('refresh')}<div><strong>Se recuperó tu borrador.</strong> El reporte que estabas escribiendo se guardó en este dispositivo.</div></div>`;
}
const _renderReportar = RENDER.reportar;
RENDER.reportar = s => {
  let aviso = '';
  const r = state.reporte;
  const vacio = !r.edificio && !r.categoria && !r.foto && !r.descripcion;
  if (borradorGuardado && vacio) {
    const { guardado, ...datos } = borradorGuardado;
    state.reporte = { ...nuevoReporte(), ...datos };
    borradorGuardado = null;
    borradorRecuperado = true;
  }
  if (borradorRecuperado) aviso = borradorRecuperadoHTML();
  const html = _renderReportar(s);
  return html.replace('<div class="alert alert-error" hidden></div>', `${gpsHTML(state.reporte.gps)}<div class="alert alert-error" hidden></div>`)
    .replace('<form class="card form-card" data-form="reporte" novalidate>', `<form class="card form-card" data-form="reporte" novalidate>${aviso}`);
};

ACCIONES.gps = async (id, el) => {
  const msg = $('#gpsMsg');
  el.disabled = true;
  if (msg) msg.textContent = 'Obteniendo la ubicación del dispositivo…';
  try {
    const pos = await new Promise((ok, mal) => navigator.geolocation.getCurrentPosition(ok, mal, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }));
    state.reporte.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy };
    vibrar(40);
    $('#gpsStep').outerHTML = gpsHTML(state.reporte.gps);
    guardarBorrador();
  } catch (err) {
    const textos = { 1: 'Permiso de ubicación denegado. Actívalo en la configuración del navegador.', 2: 'No se pudo determinar la ubicación.', 3: 'El GPS tardó demasiado en responder. Intenta de nuevo.' };
    if (msg) msg.textContent = textos[err.code] || err.message;
    el.disabled = false;
  }
};
ACCIONES['gps-quitar'] = () => {
  delete state.reporte.gps;
  $('#gpsStep').outerHTML = gpsHTML(null);
  guardarBorrador();
};

/* ---------- Cámara con vista previa en vivo (getUserMedia) ---------- */
const _photoZoneInner = photoZoneInner;
photoZoneInner = function (foto, campo) {
  const html = _photoZoneInner(foto, campo);
  if (foto || !navigator.mediaDevices?.getUserMedia) return html;
  return `${html}<button type="button" class="btn btn-primary btn-sm cam-open" data-action="camara" data-field="${campo}">${icon('camera')} Usar la cámara del dispositivo</button>`;
};

const Camara = { stream: null, zona: null, campo: null, frontal: false };
ACCIONES.camara = async (id, el) => {
  Camara.zona = el.closest('.photo-zone');
  Camara.campo = el.dataset.field;
  let capa = $('#camOverlay');
  if (!capa) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="camOverlay" class="cam-overlay" role="dialog" aria-modal="true" aria-label="Cámara">
        <div class="cam-card">
          <div class="cam-head"><strong>${icon('camera')} Cámara</strong><button class="icon-btn" data-action="camara-cerrar" aria-label="Cerrar">${icon('x')}</button></div>
          <video id="camVideo" autoplay playsinline muted></video>
          <p class="cam-msg muted small" id="camMsg">Solicitando acceso a la cámara…</p>
          <div class="cam-actions">
            <button class="btn btn-ghost" data-action="camara-voltear">${icon('flip')} Cambiar cámara</button>
            <button class="btn btn-primary btn-lg" data-action="camara-capturar" id="camShot" disabled>${icon('camera')} Capturar</button>
          </div>
        </div>
      </div>`);
    capa = $('#camOverlay');
  }
  capa.hidden = false;
  await iniciarCamara();
};
async function iniciarCamara() {
  detenerCamara();
  const msg = $('#camMsg');
  try {
    Camara.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: Camara.frontal ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
    $('#camVideo').srcObject = Camara.stream;
    msg.textContent = 'Encuadra la falla y presiona Capturar.';
    $('#camShot').disabled = false;
  } catch (err) {
    msg.textContent = err.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Puedes usar "Tomar o subir fotografía".' : `No se pudo abrir la cámara: ${err.message}`;
  }
}
function detenerCamara() {
  Camara.stream?.getTracks().forEach(t => t.stop());
  Camara.stream = null;
}
ACCIONES['camara-voltear'] = () => { Camara.frontal = !Camara.frontal; iniciarCamara(); };
ACCIONES['camara-cerrar'] = () => { detenerCamara(); $('#camOverlay').hidden = true; };
ACCIONES['camara-capturar'] = () => {
  const video = $('#camVideo');
  if (!video.videoWidth) return;
  const escala = Math.min(1, 900 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * escala);
  canvas.height = Math.round(video.videoHeight * escala);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  const foto = canvas.toDataURL('image/jpeg', 0.75);
  vibrar(30);
  ACCIONES['camara-cerrar']();
  if (Camara.campo === 'foto') { state.reporte.foto = foto; actualizarResumen(); } else state.resolucion.foto = foto;
  if (Camara.zona?.isConnected) {
    Camara.zona.classList.add('has-photo');
    Camara.zona.innerHTML = photoZoneInner(foto, Camara.campo);
  }
};

/* =========================================================
   5. NOTIFICACIONES PUSH
   ========================================================= */
function b64aBytes(base64) {
  const relleno = '='.repeat((4 - base64.length % 4) % 4);
  const bin = atob((base64 + relleno).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
async function revisarPush() {
  if (!PWA.push.soportado || !PWA.registro) return;
  try {
    const sub = await PWA.registro.pushManager.getSubscription();
    PWA.push.activo = !!sub && Notification.permission === 'granted';
    if (sub && Auth.sesion()) await api('/push/suscripcion', { method: 'POST', body: sub.toJSON() }); // asocia el dispositivo al usuario actual
  } catch { /* sin conexión o sin servicio push */ }
}
async function activarPush() {
  if (!('Notification' in window)) throw new Error('Este navegador no admite notificaciones.');
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') throw new Error('Permiso no concedido. Puedes activarlo después desde la configuración del navegador.');
  if (!PWA.push.soportado || !PWA.registro) {
    toast('Notificaciones activadas', 'Este navegador mostrará avisos del sistema mientras la app esté abierta.');
    return;
  }
  const { clave } = await api('/push/clave');
  let sub = await PWA.registro.pushManager.getSubscription();
  if (!sub) sub = await PWA.registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aBytes(clave) });
  await api('/push/suscripcion', { method: 'POST', body: sub.toJSON() });
  PWA.push.activo = true;
  vibrar([80, 40, 80]);
  toast('Notificaciones push activadas', 'Recibirás avisos aunque la aplicación esté cerrada.');
}
ACCIONES['push-permiso'] = async () => {
  try { await activarPush(); }
  catch (err) { toast('No se activaron las notificaciones push', err.message, 'error'); }
  renderPanel();
  if (state.vista === 'notificaciones') renderVista();
};
ACCIONES['push-prueba'] = async () => {
  const r = await api('/push/prueba', { method: 'POST' });
  toast('Notificación de prueba enviada', `Se envió a ${r.enviadas} de ${r.total} dispositivo(s) registrados.`, 'info');
};
ACCIONES['push-desactivar'] = async () => {
  const sub = await PWA.registro?.pushManager.getSubscription();
  if (sub) {
    await api('/push/suscripcion', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }
  PWA.push.activo = false;
  toast('Notificaciones push desactivadas', 'Este dispositivo ya no recibirá avisos.', 'info');
  renderVista();
};

botonPush = function () {
  if (!('Notification' in window)) return '';
  if (Notification.permission === 'denied') return '<span class="muted small">Notificaciones bloqueadas en el navegador</span>';
  if (PWA.push.activo) {
    return `<span class="pill" style="background:var(--g100);color:var(--g800)">${icon('check')} Push activo en este dispositivo</span>
      <button class="btn btn-ghost btn-sm" data-action="push-prueba">${icon('send')} Enviar prueba</button>
      <button class="btn btn-ghost btn-sm" data-action="push-desactivar">${icon('x')} Desactivar</button>`;
  }
  return `<button class="btn btn-primary btn-sm" data-action="push-permiso">${icon('bell')} Activar notificaciones push</button>`;
};

/* Avisos del sistema mientras la app está abierta: se muestran desde el service worker */
notificacionSistema = function (n) {
  vibrar([100, 50, 100]);
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opciones = { body: n.body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: n.ticketId || n.id, vibrate: [100, 50, 100], data: { folio: n.ticketId, url: '/#notificaciones' } };
    const titulo = `CampusCare · ${n.title}`;
    if (PWA.registro?.active) PWA.registro.showNotification(titulo, opciones).catch(() => new Notification(titulo, opciones));
    else new Notification(titulo, opciones);
  } catch { /* algunos navegadores no permiten mostrarla */ }
};

/* =========================================================
   6. COMPARTIR EL SEGUIMIENTO (Web Share) y GPS en el detalle
   ========================================================= */
const _abrirDetalle = abrirDetalle;
abrirDetalle = function (id, refrescar = false) {
  _abrirDetalle(id, refrescar);
  const t = DB.ticket(id);
  const grid = $('#modalBody .info-grid');
  if (!t || !grid) return;
  const url = `${location.origin}/reporte/${encodeURIComponent(t.id)}`;
  grid.insertAdjacentHTML('afterend', `
    <div class="pwa-extra">
      ${t.gps ? `<a class="pwa-gps" href="https://www.openstreetmap.org/?mlat=${t.gps.lat}&mlon=${t.gps.lng}#map=19/${t.gps.lat}/${t.gps.lng}" target="_blank" rel="noopener">${icon('gps')}<span><small>Ubicación GPS del reporte</small><strong>${t.gps.lat.toFixed(5)}, ${t.gps.lng.toFixed(5)}</strong></span></a>` : ''}
      <div class="btn-row">
        <button class="btn btn-ghost btn-sm" data-action="compartir" data-id="${t.id}">${icon('share')} Compartir seguimiento</button>
        <a class="btn btn-ghost btn-sm" href="${url}" target="_blank" rel="noopener">${icon('link')} Página pública (servidor)</a>
      </div>
    </div>`);
};
ACCIONES.compartir = async id => {
  const url = `${location.origin}/reporte/${encodeURIComponent(id)}`;
  const datos = { title: `Reporte ${id} · CampusCare`, text: `Sigue el avance del reporte ${id}`, url };
  if (navigator.share) {
    try { await navigator.share(datos); } catch { /* el usuario canceló */ }
    return;
  }
  await navigator.clipboard?.writeText(url);
  toast('Enlace copiado', url, 'info');
};

/* =========================================================
   7. SESIÓN, ARRANQUE Y CIERRE
   ========================================================= */
const _entrarApp = entrarApp;
entrarApp = async function (s) {
  await _entrarApp(s);
  await cargarPendientes();
  revisarPush();
  enviarPendientes();
  actualizarRed();
};
const _cerrarSesion = cerrarSesion;
cerrarSesion = function (expirada = false) {
  // Al cerrar sesión se quita la suscripción push del servidor y la copia local de la API
  (async () => {
    const sub = await PWA.registro?.pushManager?.getSubscription().catch(() => null);
    if (sub) await sub.unsubscribe().catch(() => {});
    PWA.push.activo = false;
  })();
  navigator.serviceWorker?.controller?.postMessage({ tipo: 'limpiar-api' });
  borradorGuardado = null;
  borradorRecuperado = false;
  PWA.pendientes = [];
  _cerrarSesion(expirada);
};

(async function iniciarPWA() {
  actualizarRed();
  await registrarServiceWorker();
  try { borradorGuardado = await LocalDB.get('borradores', 'reporte') || null; } catch { borradorGuardado = null; }
  // Mantener la sesión: si se cerró la app, se recupera el token guardado en IndexedDB
  if (!Auth.token()) {
    try {
      const token = await LocalDB.get('sesion', 'token');
      if (token) {
        _guardarToken(token);
        const s = Auth.sesion(); // valida la expiración
        if (s && $('#app').hidden) await entrarApp(s);
      }
    } catch { /* sin IndexedDB */ }
  } else {
    LocalDB.poner('sesion', Auth.token(), 'token').catch(() => {});
    if (Auth.sesion()) { await cargarPendientes(); enviarPendientes(); }
  }
  if (state.vista === 'reportar' && borradorGuardado && !$('#app').hidden) renderVista();
})();
