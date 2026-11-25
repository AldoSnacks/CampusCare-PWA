/* =========================================================
   CampusCare sin conexión
   Aportación de Adrián Olmedo Arango
   ---------------------------------------------------------
   1. Inicio de sesión sin internet: al entrar con conexión se
      guarda un verificador PBKDF2 (SHA-256, 150 000 iteraciones,
      sal aleatoria). La contraseña nunca se guarda; el token de
      la sesión queda cifrado con AES-GCM usando una llave que
      también se deriva de la contraseña.
   2. Copia de datos por usuario: cada consulta lleva el id del
      usuario (_u) para que la caché no se mezcle entre cuentas.
   3. Cola de cambios: crear, editar, cambiar de estado y borrar
      se guardan en el dispositivo con folio provisional
      (LOCAL-0001) y se ven al momento en la interfaz.
   4. Sincronización en orden al volver la red: si falla la red
      se detiene y reintenta; si el servidor rechaza un cambio,
      se descarta y se avisa (un reporte nuevo se conserva para
      corregirlo). El servidor vuelve a validar roles y permisos.
   ========================================================= */
'use strict';

const SinConexion = {
  CLAVE_CUENTAS: 'campuscare_offline_cuentas',
  CLAVE_FOLIO: 'campuscare_folio_local',
  CLAVE_MODO: 'campuscare_sesion_offline',
  CLAVE_SIMULAR: 'campuscare_simular_offline',
  ITERACIONES: 150000,
  disponible: !!(window.crypto?.subtle && window.isSecureContext)
};

/* ---------- Utilidades de bytes ---------- */
const aB64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const deB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const leerJSON = (clave, defecto) => { try { return JSON.parse(localStorage.getItem(clave)) ?? defecto; } catch { return defecto; } };
const escribirJSON = (clave, valor) => { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento */ } };
const esErrorDeRed = e => !!e && (e.offline || /conexión|Failed to fetch|NetworkError/i.test(e.message || ''));

/* =========================================================
   1. VERIFICADOR PBKDF2 Y TOKEN CIFRADO
   ========================================================= */
async function derivarLlaves(password, sal) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: SinConexion.ITERACIONES }, base, 512));
  const llave = await crypto.subtle.importKey('raw', bits.slice(32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { verificador: bits.slice(0, 32), llave };
}
function iguales(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}
const cuentasOffline = () => leerJSON(SinConexion.CLAVE_CUENTAS, {});

async function guardarCredencialOffline(correo, password, token) {
  if (!SinConexion.disponible || !token) return;
  try {
    const sal = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const { verificador, llave } = await derivarLlaves(password, sal);
    const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, llave, new TextEncoder().encode(token));
    const d = desdeB64url(token.split('.')[1]);
    const cuentas = cuentasOffline();
    cuentas[correo] = { correo, nombre: d.name, rol: d.role, uid: d.uid, sal: aB64(sal), verificador: aB64(verificador), iv: aB64(iv), token: aB64(cifrado), guardado: Date.now() };
    escribirJSON(SinConexion.CLAVE_CUENTAS, cuentas);
  } catch (e) { console.warn('No se guardó el acceso sin conexión:', e.message); }
}

async function loginSinConexion(correo, password) {
  if (!SinConexion.disponible) throw new Error('Sin conexión. El acceso sin internet necesita HTTPS (o localhost) en este navegador.');
  const c = cuentasOffline()[correo];
  if (!c) throw new Error('Sin conexión. Para entrar sin internet, primero inicia sesión una vez con conexión en este dispositivo.');
  const { verificador, llave } = await derivarLlaves(password, deB64(c.sal));
  if (!iguales(verificador, deB64(c.verificador))) throw new Error('Contraseña incorrecta (verificación sin conexión en este dispositivo).');
  const token = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(c.iv) }, llave, deB64(c.token)));
  try { sessionStorage.setItem(SinConexion.CLAVE_MODO, '1'); } catch { /* sin almacenamiento */ }
  Auth.guardar(token);
  const s = Auth.sesion();
  if (!s) throw new Error('No se pudo recuperar la sesión guardada.');
  return s;
}
const enModoSinConexion = () => { try { return sessionStorage.getItem(SinConexion.CLAVE_MODO) === '1'; } catch { return false; } };

/* Inicio de sesión: con red, el normal (y se guarda el verificador); sin red, el local */
const _loginOnline = Auth.login.bind(Auth);
Auth.login = async function (correo, password) {
  correo = String(correo || '').trim().toLowerCase();
  if (!navigator.onLine) return loginSinConexion(correo, password);
  try {
    const s = await _loginOnline(correo, password);
    try { sessionStorage.removeItem(SinConexion.CLAVE_MODO); } catch { /* sin almacenamiento */ }
    guardarCredencialOffline(correo, password, Auth.token());
    return s;
  } catch (e) {
    if (esErrorDeRed(e)) return loginSinConexion(correo, password);
    throw e;
  }
};

/* Sin red no se renueva el token: se sigue con la sesión local */
const _refrescar = Auth.refrescar.bind(Auth);
Auth.refrescar = async function () {
  if (!navigator.onLine) return this.sesion();
  try {
    const s = await _refrescar();
    try { sessionStorage.removeItem(SinConexion.CLAVE_MODO); } catch { /* sin almacenamiento */ }
    return s;
  } catch (e) {
    if (esErrorDeRed(e) && this.sesion()) return this.sesion();
    throw e;
  }
};

/* Una sesión abierta sin conexión sigue activa aunque el token haya vencido, mientras no haya red */
Auth.sesion = function () {
  const token = this.token();
  if (!token) return null;
  try {
    const d = desdeB64url(token.split('.')[1]);
    const vencido = d.exp * 1000 < Date.now();
    if (vencido && !(enModoSinConexion() && !navigator.onLine)) { this.logout(); return null; }
    return { id: d.uid, email: d.sub, name: d.name, role: d.role, exp: d.exp, avatar: d.avatar, sinConexion: enModoSinConexion() };
  } catch {
    this.logout();
    return null;
  }
};
const _logoutSC = Auth.logout.bind(Auth);
Auth.logout = function () {
  _logoutSC();
  try { sessionStorage.removeItem(SinConexion.CLAVE_MODO); } catch { /* sin almacenamiento */ }
};

/* Aviso en el formulario de acceso cuando no hay red */
function avisoLoginSinRed() {
  const form = $('#loginForm');
  if (!form) return;
  let aviso = $('#avisoSinRed');
  if (!aviso) {
    form.querySelector('.field')?.insertAdjacentHTML('beforebegin', `<div id="avisoSinRed" class="alert alert-info" hidden>${icon('cloudOff')}<div><strong>Sin conexión.</strong> Puedes entrar con la contraseña de tu última sesión en este dispositivo; verás tus datos guardados y tus cambios se enviarán al volver la red.</div></div>`);
    aviso = $('#avisoSinRed');
  }
  aviso.hidden = navigator.onLine;
}
window.addEventListener('online', avisoLoginSinRed);
window.addEventListener('offline', avisoLoginSinRed);

/* =========================================================
   2. SIMULACIÓN SIN CONEXIÓN (para probar y exponer el módulo)
   Hace que la aplicación se comporte como si no hubiera red:
   las consultas salen de la copia guardada y los cambios van
   a la cola. Desactivarla equivale a "volver la conexión".
   ========================================================= */
const Simulacion = { activa: (() => { try { return sessionStorage.getItem(SinConexion.CLAVE_SIMULAR) === '1'; } catch { return false; } })() };
const _onLineReal = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
try {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => (Simulacion.activa ? false : _onLineReal.get.call(navigator)) });
} catch { /* navegador que no permite redefinirlo */ }

const _fetchAntesSimulacion = window.fetch;
window.fetch = async (entrada, init = {}) => {
  const url = typeof entrada === 'string' ? entrada : entrada?.url || String(entrada);
  if (!Simulacion.activa || !url.includes('/api/')) return _fetchAntesSimulacion(entrada, init);
  const metodo = String(init.method || entrada?.method || 'GET').toUpperCase();
  if (metodo !== 'GET') throw new TypeError('Failed to fetch (simulación sin conexión)');
  const absoluta = new URL(url, location.href).href;
  const guardada = await caches.match(absoluta, { cacheName: 'campuscare-api' }).catch(() => null);
  if (guardada) {
    PWA.datosDeCache = true;
    const headers = new Headers(guardada.headers);
    headers.set('X-Desde-Cache', 'service-worker');
    return new Response(await guardada.blob(), { status: 200, headers });
  }
  if (url.includes('/api/red/')) throw new TypeError('Failed to fetch (simulación sin conexión)');
  return new Response(JSON.stringify({ error: 'Sin conexión: este dato todavía no se ha guardado en el dispositivo.', offline: true }), { status: 503, headers: { 'Content-Type': 'application/json' } });
};

function cambiarSimulacion(activar) {
  Simulacion.activa = activar;
  try { sessionStorage.setItem(SinConexion.CLAVE_SIMULAR, activar ? '1' : '0'); } catch { /* sin almacenamiento */ }
  if (activar) desconectarEventos();
  window.dispatchEvent(new Event(activar ? 'offline' : 'online'));
}
ACCIONES['simular-offline'] = () => {
  cambiarSimulacion(!Simulacion.activa);
  toast(Simulacion.activa ? 'Simulación sin conexión activada' : 'Conexión restablecida',
    Simulacion.activa ? 'La app usa los datos guardados y manda tus cambios a la cola.' : 'Se enviará la cola de cambios en orden.', 'info');
  renderVista();
};

/* =========================================================
   3. COLA DE CAMBIOS (IndexedDB "pendientes")
   Cada elemento: { clienteId, uid, tipo, metodo, ruta, datos, etiqueta, folio, folioLocal, creado, error }
   ========================================================= */
function siguienteFolioLocal() {
  const n = (Number(localStorage.getItem(SinConexion.CLAVE_FOLIO)) || 0) + 1;
  try { localStorage.setItem(SinConexion.CLAVE_FOLIO, String(n)); } catch { /* sin almacenamiento */ }
  return `LOCAL-${String(n).padStart(4, '0')}`;
}
const tipoDe = p => p.tipo || 'crear';
const esFolioLocal = id => /^LOCAL-\d+$/.test(String(id || ''));

async function encolarOperacion(op) {
  const s = Auth.sesion();
  if (!s) throw new Error('Inicia sesión para guardar cambios.');
  const item = { clienteId: op.clienteId || nuevoId(), uid: s.id, creado: Date.now(), error: null, ...op };
  await LocalDB.poner('pendientes', item);
  if (!Simulacion.activa) { try { if (PWA.registro?.sync) await PWA.registro.sync.register('enviar-reportes'); } catch { /* Background Sync no soportado */ } }
  await cargarPendientes();
  return item;
}

/* Alta de reporte sin conexión (la usa Tickets.crear de pwa.js) */
encolarReporte = async function (datos) {
  const folioLocal = siguienteFolioLocal();
  const d = { ...datos, origen: datos.origen && datos.origen !== 'formulario' ? datos.origen : 'sin_conexion' };
  return encolarOperacion({
    clienteId: datos.clienteId, tipo: 'crear', metodo: 'POST', ruta: '/tickets', datos: d, folioLocal,
    etiqueta: `Nuevo reporte ${folioLocal}`,
    resumen: { categoria: d.categoria, severidad: d.severidad, ubicacion: `Edif. ${d.edificio} · ${d.espacio}`, activo: d.activo }
  });
};

/* Cambios sobre reportes existentes: si no hay red van a la cola */
function conCola(original, construir) {
  return async function (...args) {
    const op = construir(...args);
    if (navigator.onLine && !esFolioLocal(op.folio)) {
      try { return await original(...args); }
      catch (e) { if (!esErrorDeRed(e)) throw e; }
    }
    const item = await encolarOperacion(op);
    return { encolado: true, ...item };
  };
}
const _transicion = Tickets.transicion.bind(Tickets);
Tickets.transicion = conCola(_transicion, (id, destino, extra = {}) => ({
  tipo: 'transicion', metodo: 'POST', ruta: `/tickets/${encodeURIComponent(id)}/transicion`, folio: id,
  datos: { estado: destino, ...extra }, etiqueta: `${id} → ${destino}`
}));
const _editar = Tickets.editar.bind(Tickets);
Tickets.editar = conCola(_editar, (id, cambios) => ({
  tipo: 'editar', metodo: 'PATCH', ruta: `/tickets/${encodeURIComponent(id)}`, folio: id, datos: cambios, etiqueta: `Editar ${id}`
}));
const _eliminar = Tickets.eliminar.bind(Tickets);
Tickets.eliminar = async function (id) {
  // Un reporte que aún no llega al servidor solo se quita de la cola (con sus cambios)
  if (esFolioLocal(id)) {
    DB.data.tickets = DB.data.tickets.filter(t => t.id !== id);
    for (const p of PWA.pendientes.filter(x => x.folioLocal === id || x.folio === id)) await LocalDB.borrar('pendientes', p.clienteId);
    await cargarPendientes();
    await sincronizar().catch(() => Bus.emit('data'));
    return { encolado: false };
  }
  return conCola(_eliminar, folio => ({ tipo: 'eliminar', metodo: 'DELETE', ruta: `/tickets/${encodeURIComponent(folio)}`, folio, etiqueta: `Borrar ${folio}` }))(id);
};

/* ---------- Interfaz optimista: los cambios de la cola se ven al momento ---------- */
function aplicarPendientes() {
  const s = Auth.sesion();
  if (!s || !PWA.pendientes.length) return;
  const T = DB.data.tickets;
  for (const p of PWA.pendientes) {
    const tipo = tipoDe(p);
    if (tipo === 'crear') {
      const id = p.folioLocal || `LOCAL-${p.clienteId.slice(0, 4)}`;
      if (T.some(t => t.id === id)) continue;
      const d = p.datos;
      T.unshift({
        id, dbId: null, local: true, createdAt: p.creado, updatedAt: p.creado, origen: d.origen,
        solicitante: { email: s.email, name: s.name }, ubicacion: { edificio: d.edificio, nivel: d.nivel, espacio: d.espacio, activo: d.activo },
        categoria: d.categoria, severidad: d.severidad, descripcion: d.descripcion, foto: d.foto, estado: 'Abierto',
        tecnico: null, tecnicoNombre: null, rechazo: null, gps: d.gps || null, resolucion: null,
        historial: [{ de: null, a: 'Abierto', porNombre: s.name, at: p.creado, nota: 'Guardado en este dispositivo; pendiente de envío' }],
        _aplicados: new Set([p.clienteId])
      });
      continue;
    }
    const t = T.find(x => x.id === p.folio);
    if (!t) continue;
    t._aplicados ??= new Set();
    if (t._aplicados.has(p.clienteId)) continue;
    t._aplicados.add(p.clienteId);
    if (tipo === 'eliminar') { T.splice(T.indexOf(t), 1); continue; }
    if (tipo === 'editar') {
      Object.assign(t, { descripcion: p.datos.descripcion ?? t.descripcion, severidad: p.datos.severidad ?? t.severidad });
      if (p.datos.activo) t.ubicacion = { ...t.ubicacion, activo: p.datos.activo };
      t.historial = [...t.historial, { de: t.estado, a: t.estado, porNombre: s.name, at: p.creado, nota: 'Edición pendiente de sincronizar' }];
    }
    if (tipo === 'transicion') {
      const d = p.datos;
      t.historial = [...t.historial, { de: t.estado, a: d.estado, porNombre: s.name, at: p.creado, nota: 'Cambio pendiente de sincronizar' }];
      t.estado = d.estado;
      if (d.tecnico) { t.tecnico = d.tecnico; t.tecnicoNombre = nombreDe(d.tecnico); }
      if (d.motivo) t.rechazo = d.motivo;
      if (d.estado === 'Resuelto') t.resolucion = { foto: d.foto, notas: d.notas, materiales: d.materiales, at: p.creado };
    }
    t.updatedAt = p.creado;
    t.pendiente = true;
  }
}
const _syncDB = DB.sync.bind(DB);
DB.sync = async function () {
  await _syncDB();
  aplicarPendientes();
};

/* Lectura de la cola del usuario actual */
cargarPendientes = async function () {
  try {
    const s = Auth.sesion();
    const todos = await LocalDB.todos('pendientes');
    PWA.pendientes = s ? todos.filter(p => p.uid === s.id).sort((a, b) => a.creado - b.creado) : [];
  } catch { PWA.pendientes = []; }
  aplicarPendientes();
  if (Auth.sesion() && !$('#app').hidden) Bus.emit('data');
  return PWA.pendientes;
};

/* ---------- Envío en orden (sin service worker; con él lo hace sw.js) ---------- */
async function reescribirFolio(folioLocal, folio) {
  for (const p of await LocalDB.todos('pendientes')) {
    if (p.folio === folioLocal || (p.ruta || '').includes(folioLocal)) {
      await LocalDB.poner('pendientes', { ...p, folio, ruta: p.ruta.replace(folioLocal, encodeURIComponent(folio)), etiqueta: (p.etiqueta || '').replace(folioLocal, folio) });
    }
  }
}
enviarPendientes = async function () {
  if (!navigator.onLine || !Auth.sesion()) return;
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ tipo: 'enviar-pendientes' });
    programarReintento();
    return;
  }
  if (enviandoPendientes) return enviandoPendientes;
  enviandoPendientes = (async () => {
    for (const p of (await cargarPendientes()).filter(x => !x.error)) {
      try {
        const r = await api(p.ruta || '/tickets', { method: p.metodo || 'POST', body: p.metodo === 'DELETE' ? undefined : p.datos, modulo: 'sin-conexion' });
        await LocalDB.borrar('pendientes', p.clienteId);
        if (tipoDe(p) === 'crear' && p.folioLocal && r?.folio) await reescribirFolio(p.folioLocal, r.folio);
        mensajeDelServiceWorker(tipoDe(p) === 'crear' ? { tipo: 'reporte-enviado', folio: r?.folio } : { tipo: 'op-enviada', etiqueta: p.etiqueta, folio: r?.folio });
      } catch (err) {
        if (esErrorDeRed(err)) break;
        if (tipoDe(p) === 'crear') await LocalDB.poner('pendientes', { ...p, error: err.message });
        else { await LocalDB.borrar('pendientes', p.clienteId); mensajeDelServiceWorker({ tipo: 'op-descartada', etiqueta: p.etiqueta, error: err.message }); }
      }
    }
    await cargarPendientes();
  })().finally(() => { enviandoPendientes = null; });
  return enviandoPendientes;
};

const _mensajeSW = mensajeDelServiceWorker;
mensajeDelServiceWorker = function (m) {
  if (m.tipo === 'op-enviada') {
    toast('Cambio sincronizado', `${m.etiqueta || 'Un cambio guardado sin conexión'} ya está en el servidor${m.folio ? ` (folio ${m.folio})` : ''}.`);
    cargarPendientes().then(() => Auth.sesion() && sincronizar().catch(() => {}));
    return;
  }
  if (m.tipo === 'op-descartada') {
    toast('El servidor rechazó un cambio guardado', `${m.etiqueta || ''}: ${m.error || 'ya no es válido'}. Se quitó de la cola.`, 'error');
    cargarPendientes().then(() => Auth.sesion() && sincronizar().catch(() => {}));
    return;
  }
  _mensajeSW(m);
};

/* Tarjeta de pendientes en "Mis reportes" con todos los tipos de cambio */
const ETIQUETA_TIPO = { crear: 'Reporte nuevo', transicion: 'Cambio de estado', editar: 'Edición', eliminar: 'Borrado', auditoria: 'Auditoría Wi-Fi' };
function itemPendiente(p) {
  const tipo = tipoDe(p);
  const titulo = tipo === 'crear' && p.resumen ? `${p.folioLocal ? `${p.folioLocal} · ` : ''}${p.resumen.categoria} · ${p.resumen.activo}` : (p.etiqueta || ETIQUETA_TIPO[tipo]);
  const detalle = tipo === 'crear' && p.resumen ? `${p.resumen.ubicacion} · ${p.resumen.severidad}` : (p.ruta || '');
  return `
    <div class="pend-item ${p.error ? 'has-error' : ''}">
      <div><span class="pend-tipo">${ETIQUETA_TIPO[tipo]}</span><strong>${esc(titulo)}</strong>
        <small>${esc(detalle)} · guardado ${hace(p.creado)}</small>
        ${p.error ? `<small class="pend-err">${esc(p.error)}</small>` : `<small class="pend-ok">${navigator.onLine ? 'Enviando…' : 'Esperando conexión'}</small>`}</div>
      <div class="btn-row">
        ${p.error ? `<button class="btn btn-sm btn-ghost" data-action="pend-reintentar" data-id="${p.clienteId}">${icon('refresh')} Reintentar</button>` : ''}
        <button class="btn btn-sm btn-ghost" data-action="pend-descartar" data-id="${p.clienteId}">${icon('trash')} Descartar</button>
      </div>
    </div>`;
}
pendientesHTML = function () {
  if (!PWA.pendientes.length) return '';
  return `<section class="card pend-card">
    <div class="pend-head">${icon('upload')}<div><h3>Pendientes de envío (${PWA.pendientes.length})</h3>
      <p class="muted small">Guardados en este dispositivo (IndexedDB). Se envían solos y en orden cuando hay conexión.</p></div>
      <button class="btn btn-sm btn-ghost" data-action="nav" data-view="sin-conexion">${icon('cloudOff')} Ver cola</button></div>
    ${PWA.pendientes.map(itemPendiente).join('')}
  </section>`;
};
ACCIONES['pend-descartar'] = async id => {
  if (!confirm('¿Descartar este cambio guardado sin conexión?')) return;
  await LocalDB.borrar('pendientes', id);
  await cargarPendientes();
  await sincronizar().catch(() => Bus.emit('data'));
};
ACCIONES['sincronizar-ahora'] = async () => {
  if (!navigator.onLine) return toast('Sigues sin conexión', 'La cola se enviará sola en cuanto vuelva la red.', 'error');
  await enviarPendientes();
  toast('Sincronizando', 'Se están enviando los cambios en el orden en que se hicieron.', 'info');
};

/* =========================================================
   4. VISTA DEL MÓDULO
   ========================================================= */
async function contarCopiasGuardadas() {
  const s = Auth.sesion();
  try {
    const cache = await caches.open('campuscare-api');
    const claves = await cache.keys();
    return claves.filter(r => r.url.includes(`_u=${s.id}`)).length;
  } catch { return 0; }
}
RENDER['sin-conexion'] = s => {
  const cuenta = cuentasOffline()[s.email];
  const enLinea = navigator.onLine;
  const tarjeta = (ic, titulo, valor, texto, tono = '') => `<article class="sc-stat ${tono}"><span class="stat-ic">${icon(ic)}</span><div><small>${titulo}</small><strong>${valor}</strong><p class="tiny muted">${texto}</p></div></article>`;
  return `
  <section class="hero-banner hero-sm" style="--bg:url('img/edificio-c.jpg')">
    <div class="hero-banner-content">
      <span class="pill pill-glass">${icon('cloudOff')} CampusCare sin conexión</span>
      <h2>Trabaja aunque se caiga el internet</h2>
      <p>Entra, consulta tus reportes y registra cambios sin red. Todo se guarda en este dispositivo y se envía en orden cuando vuelve la conexión.</p>
      <div class="btn-row">
        <button class="btn ${Simulacion.activa ? 'btn-light' : 'btn-glass'}" data-action="simular-offline">${icon(Simulacion.activa ? 'wifi' : 'wifiOff')} ${Simulacion.activa ? 'Volver a conectar' : 'Simular sin conexión'}</button>
        <button class="btn btn-glass" data-action="sincronizar-ahora">${icon('refresh')} Sincronizar ahora</button>
      </div>
    </div>
  </section>

  <section class="sc-grid">
    ${tarjeta(enLinea ? 'wifi' : 'wifiOff', 'Conexión', Simulacion.activa ? 'Simulada sin red' : enLinea ? 'En línea' : 'Sin conexión', enLinea ? 'Los cambios van directo al servidor.' : 'Los cambios se guardan en la cola.', enLinea ? '' : 'is-off')}
    ${tarjeta('key', 'Acceso sin internet', cuenta ? 'Habilitado' : 'Pendiente', cuenta ? `Verificador PBKDF2 guardado ${hace(cuenta.guardado)}.` : SinConexion.disponible ? 'Se habilita al iniciar sesión con conexión.' : 'Requiere HTTPS en este navegador.')}
    ${tarjeta('upload', 'Cambios en cola', PWA.pendientes.length, PWA.pendientes.length ? 'Se enviarán en el orden en que se hicieron.' : 'No hay cambios pendientes.')}
    ${tarjeta('database', 'Consultas guardadas', '<span id="scCopias">…</span>', 'Copias de la API solo de tu usuario.')}
  </section>

  <section class="card">
    <div class="card-head"><h3>Cola de cambios</h3><span class="muted small">IndexedDB · campuscare-local / pendientes</span></div>
    ${PWA.pendientes.length ? PWA.pendientes.map(itemPendiente).join('') : vacio('Todo está sincronizado', 'Activa "Simular sin conexión" y crea, edita o cambia el estado de un reporte para ver cómo se forma la cola.', 'checkCircle')}
  </section>

  <section class="card">
    <div class="card-head"><h3>Cómo funciona</h3><span class="muted small">Propuesta de Adrián Olmedo Arango</span></div>
    <ol class="sc-pasos">
      <li><span class="step-n">1</span><div><strong>Entrar sin internet</strong><p class="small muted">Al iniciar sesión con red se guarda un verificador PBKDF2 (SHA-256, ${SinConexion.ITERACIONES.toLocaleString('es-MX')} iteraciones, sal aleatoria). La contraseña nunca se guarda y el token queda cifrado con AES-GCM.</p></div></li>
      <li><span class="step-n">2</span><div><strong>Copia por usuario</strong><p class="small muted">Cada consulta se guarda con el id del usuario, así dos cuentas en el mismo teléfono no ven datos ajenos.</p></div></li>
      <li><span class="step-n">3</span><div><strong>Cola de cambios</strong><p class="small muted">Crear, editar, avanzar de estado o borrar se guardan con folio provisional (LOCAL-0001) y se reflejan al momento en la pantalla.</p></div></li>
      <li><span class="step-n">4</span><div><strong>Sincronización en orden</strong><p class="small muted">Al volver la red se envía todo en orden. Si la red falla, se detiene y reintenta; si el servidor rechaza un cambio (por permisos o porque ya no aplica), se quita y se avisa.</p></div></li>
    </ol>
    ${cuenta ? `<button class="btn btn-danger btn-sm" data-action="olvidar-dispositivo">${icon('trash')} Olvidar el acceso sin conexión en este dispositivo</button>` : ''}
  </section>`;
};
POST_RENDER['sin-conexion'] = async () => {
  const n = await contarCopiasGuardadas();
  const el = $('#scCopias');
  if (el) el.textContent = n;
};
ACCIONES['olvidar-dispositivo'] = async () => {
  const s = Auth.sesion();
  if (!confirm('¿Quitar el acceso sin conexión y las copias guardadas de tu usuario en este dispositivo?')) return;
  const cuentas = cuentasOffline();
  delete cuentas[s.email];
  escribirJSON(SinConexion.CLAVE_CUENTAS, cuentas);
  try {
    const cache = await caches.open('campuscare-api');
    for (const r of await cache.keys()) if (r.url.includes(`_u=${s.id}`)) await cache.delete(r);
  } catch { /* sin caché */ }
  toast('Dispositivo olvidado', 'Para volver a entrar sin internet, inicia sesión una vez con conexión.', 'info');
  renderVista();
};

/* Al cerrar sesión se conserva la copia por usuario para poder entrar sin red (ver pwa.js) */
const _cerrarSesionSC = cerrarSesion;
cerrarSesion = function (expirada = false) {
  _cerrarSesionSC(expirada);
  setTimeout(avisoLoginSinRed, 0);
};

document.addEventListener('DOMContentLoaded', () => {
  avisoLoginSinRed();
  if (Simulacion.activa) window.dispatchEvent(new Event('offline'));
});
