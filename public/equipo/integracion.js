/* =========================================================
   CampusCare · Integración de los módulos del equipo
   Se carga después de app.js, admin.js y pwa.js. Registra las
   vistas nuevas, el menú "Más" para el teléfono, el módulo de
   origen de cada cambio (para la bitácora), las alertas
   críticas y la edición de reportes.

   Equipo:
     Aldo Misael Leal Palafox ....... Mapa de calor y analítica (base de la app)
     Roger Alexis Atenco Guerrero ... Reporte visual con orden de trabajo
     Carlos Manuel Ojeda Hernández .. Auditoría de red Wi-Fi y zona muerta
     Adrián Olmedo Arango ........... CampusCare sin conexión
   ========================================================= */
'use strict';

/* ---------- Iconos adicionales ---------- */
Object.assign(ICONOS, {
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  arrowUpRight: '<path d="M7 17 17 7M8 7h9v9"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  note: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 12h10"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 3"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 17a9 9 0 1 1 17.4 0"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  cloudOff: '<path d="M3 3l18 18"/><path d="M8.5 6.2A6 6 0 0 1 17.7 10H18a4 4 0 0 1 2.4 7.2M17 18H7a5 5 0 0 1-1.6-9.7"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  team: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2.5 20a5.5 5.5 0 0 1 11 0M10.5 20a5.5 5.5 0 0 1 11 0"/>',
  siren: '<path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M5 21h14v-3H5zM12 3V1M4.2 6.2 2.8 4.8M19.8 6.2l1.4-1.4"/>',
  plusUser: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M19 8v6M16 11h6"/>'
});

/* ---------- Integrantes y su aportación ---------- */
const EQUIPO = [
  { clave: 'aldo', nombre: 'Aldo Misael Leal Palafox', modulo: 'Mapa de calor y analítica', vista: 'metricas', icono: 'chart', img: 'img/banner-admin.jpg',
    texto: 'Concentra los reportes por edificio, categoría y severidad para descubrir dónde se repiten las fallas y medir el cumplimiento de SLA.' },
  { clave: 'roger', nombre: 'Roger Alexis Atenco Guerrero', modulo: 'Reporte visual', vista: 'reporte-visual', icono: 'pencil', img: 'img/demo-visual-1.jpg',
    texto: 'Quien reporta señala la falla dibujando sobre la foto (flecha, círculo, lápiz y nota) y se genera una orden de trabajo descargable.' },
  { clave: 'carlos', nombre: 'Carlos Manuel Ojeda Hernández', modulo: 'Auditoría de red Wi-Fi', vista: 'red', icono: 'wifi', img: 'img/cat-red.jpg',
    texto: 'Mide latencia, jitter, pérdida y velocidad, traduce el resultado a un semáforo de aptitud académica y escala las zonas muertas a Red/TI.' },
  { clave: 'adrian', nombre: 'Adrián Olmedo Arango', modulo: 'CampusCare sin conexión', vista: 'sin-conexion', icono: 'cloudOff', img: 'img/edificio-c.jpg',
    texto: 'Permite entrar, consultar y registrar cambios sin internet; la cola se sincroniza en orden cuando vuelve la conexión.' }
];
const autorDe = vista => EQUIPO.find(e => e.vista === vista);

/* ---------- Vistas nuevas ---------- */
Object.assign(VISTAS, {
  'reporte-visual': { titulo: 'Reporte visual',          corto: 'Visual',    icono: 'pencil' },
  red:              { titulo: 'Auditoría de red Wi-Fi',  corto: 'Red Wi-Fi', icono: 'wifi' },
  'sin-conexion':   { titulo: 'Modo sin conexión',       corto: 'Sin red',   icono: 'cloudOff' },
  historial:        { titulo: 'Historial de registros',  corto: 'Historial', icono: 'history' },
  compartir:        { titulo: 'Invitar por enlace o QR', corto: 'Invitar',   icono: 'qr' }
});
const VISTAS_EQUIPO = ['metricas', 'reporte-visual', 'red', 'sin-conexion'];

ROLES.solicitante.vistas = ['inicio', 'reportar', 'mis-tickets', 'notificaciones', 'reporte-visual', 'red', 'sin-conexion', 'historial', 'compartir'];
ROLES.solicitante.movil = ['inicio', 'reportar', 'mis-tickets', 'notificaciones'];
ROLES.mantenimiento.vistas = ['inicio', 'tareas', 'notificaciones', 'red', 'sin-conexion', 'historial', 'compartir'];
ROLES.mantenimiento.movil = ['inicio', 'tareas', 'red', 'notificaciones'];
ROLES.admin.vistas = ['inicio', 'dashboard', 'reportar', 'usuarios', 'catalogo', 'basedatos', 'notificaciones', 'metricas', 'reporte-visual', 'red', 'sin-conexion', 'historial', 'compartir'];
ROLES.admin.movil = ['inicio', 'dashboard', 'reportar', 'notificaciones'];

/* Vistas con formularios o lienzos que no se deben redibujar cuando llegan datos nuevos */
VISTAS_SIN_REFRESCO.push('reporte-visual', 'red', 'compartir');

/* =========================================================
   1. MÓDULO DE ORIGEN DE CADA CAMBIO (cabecera X-Modulo)
   El servidor lo guarda en la bitácora junto con el usuario.
   ========================================================= */
const MODULO_VISTA = {
  reportar: 'formulario', 'reporte-visual': 'reporte-visual', red: 'auditoria-red', 'sin-conexion': 'sin-conexion',
  metricas: 'mapa-calor', basedatos: 'explorador-bd', usuarios: 'administracion', catalogo: 'administracion',
  dashboard: 'administracion', compartir: 'enlace'
};
const moduloActual = () => MODULO_VISTA[state.vista] || (Auth.sesion()?.role === 'admin' ? 'administracion' : 'app');

/* Cache por usuario (propuesta de Adrián): cada GET lleva el id del usuario para que
   la copia guardada en el dispositivo no se mezcle entre cuentas */
function rutaConUsuario(ruta, method) {
  const s = Auth.sesion();
  if (method !== 'GET' || !s) return ruta;
  return `${ruta}${ruta.includes('?') ? '&' : '?'}_u=${s.id}`;
}

api = async function (ruta, { method = 'GET', body, modulo } = {}) {
  const token = Auth.token();
  const headers = { 'X-Modulo': modulo || moduloActual() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${API_ORIGEN}/api${rutaConUsuario(ruta, method)}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('No hay conexión con el servidor. Verifica que esté encendido con "npm start".');
  }
  let datos = null;
  try { datos = await res.json(); } catch { /* respuesta sin cuerpo */ }
  if (res.status === 401 && token && !datos?.offline) {
    Auth.logout();
    setTimeout(() => cerrarSesion(true), 0);
    throw new Error(datos?.error || 'Tu sesión expiró.');
  }
  if (!res.ok) {
    const e = new Error(datos?.error || `Error ${res.status} del servidor.`);
    e.status = res.status;
    e.offline = !!datos?.offline;
    throw e;
  }
  return datos;
};

/* =========================================================
   2. MENÚ LATERAL AGRUPADO Y MENÚ "MÁS" EN EL TELÉFONO
   ========================================================= */
const _renderShell = renderShell;
renderShell = function (s) {
  _renderShell(s);
  // Separador de "Módulos del equipo" en el menú lateral
  const primero = $(`#sideNav [data-view="${ROLES[s.role].vistas.find(v => VISTAS_EQUIPO.includes(v))}"]`);
  primero?.insertAdjacentHTML('beforebegin', '<div class="nav-sep">Módulos del equipo</div>');
  const historial = $('#sideNav [data-view="historial"]');
  historial?.insertAdjacentHTML('beforebegin', '<div class="nav-sep">Registros y acceso</div>');
  // Botón "Más" en la barra inferior: da acceso a todas las vistas desde el teléfono
  const bn = $('#bottomNav');
  const n = (ROLES[s.role].movil || ROLES[s.role].vistas).length + 1;
  bn.style.setProperty('--n', n);
  bn.insertAdjacentHTML('beforeend', `<button class="bnav-item" data-action="mas" data-mas><span class="bnav-ic">${icon('more')}</span><span>Más</span></button>`);
};

const _renderVista = renderVista;
renderVista = function () {
  _renderVista();
  const s = Auth.sesion();
  if (!s) return;
  const enBarra = (ROLES[s.role].movil || ROLES[s.role].vistas).includes(state.vista);
  $('#bottomNav [data-mas]')?.classList.toggle('is-active', !enBarra);
  sellarAutor();
};

/* Etiqueta con el autor del módulo en las vistas del equipo */
function sellarAutor() {
  const a = autorDe(state.vista);
  if (!a || $('#view .autor-modulo')) return;
  $('#view').insertAdjacentHTML('afterbegin', `<div class="autor-modulo">${icon('team')}<span>Módulo de <b>${esc(a.nombre)}</b> · ${esc(a.modulo)}</span></div>`);
}

ACCIONES.mas = () => {
  const s = Auth.sesion();
  const vistas = ROLES[s.role].vistas;
  const principales = vistas.filter(v => !VISTAS_EQUIPO.includes(v) && !['historial', 'compartir'].includes(v));
  const equipo = vistas.filter(v => VISTAS_EQUIPO.includes(v));
  const registros = vistas.filter(v => ['historial', 'compartir'].includes(v));
  const tile = v => {
    const a = autorDe(v);
    return `<button class="mas-tile ${state.vista === v ? 'is-on' : ''}" data-action="nav-mas" data-view="${v}">
      <span class="mas-ic">${icon(VISTAS[v].icono)}</span><strong>${VISTAS[v].titulo}</strong>${a ? `<small>${esc(a.nombre.split(' ').slice(0, 1).join(' '))} · ${esc(a.modulo)}</small>` : ''}</button>`;
  };
  abrirModal(`
    <div class="modal-pad">
      <div class="modal-head"><span class="stat-ic">${icon('grid')}</span><div><h3>Todas las secciones</h3><p class="muted small">${esc(ROLES[s.role].label)} · ${esc(s.name)}</p></div></div>
      <h4 class="mas-titulo">Principal</h4><div class="mas-grid">${principales.map(tile).join('')}</div>
      <h4 class="mas-titulo">Módulos del equipo</h4><div class="mas-grid">${equipo.map(tile).join('')}</div>
      <h4 class="mas-titulo">Registros y acceso</h4><div class="mas-grid">${registros.map(tile).join('')}</div>
      <div class="modal-actions"><a class="btn btn-ghost" href="/bienvenida">${icon('info')} Página de bienvenida</a><button class="btn btn-danger" data-action="logout">${icon('logout')} Cerrar sesión</button></div>
    </div>`);
};
ACCIONES['nav-mas'] = (id, el) => { cerrarModal(); navegar(el.dataset.view); };

/* =========================================================
   3. ORIGEN DEL REPORTE (qué módulo lo generó)
   ========================================================= */
const ORIGEN = {
  formulario: null,
  reporte_visual: { texto: 'Reporte visual', icono: 'pencil' },
  auditoria_red: { texto: 'Auditoría Wi-Fi', icono: 'wifi' },
  sin_conexion: { texto: 'Enviado sin conexión', icono: 'cloudOff' }
};
function origenChip(t) {
  if (t.local) return `<span class="origen origen-local">${icon('upload')} Pendiente de envío</span>`;
  const o = ORIGEN[t.origen];
  return o ? `<span class="origen origen-${slug(t.origen)}">${icon(o.icono)} ${o.texto}</span>` : '';
}
const _ticketCard = ticketCard;
ticketCard = function (t, s) {
  return _ticketCard(t, s).replace(`<span class="folio">${t.id}</span>`, `<span class="folio">${t.id}</span>${origenChip(t)}`);
};

/* =========================================================
   4. EDICIÓN DE UN REPORTE (queda en la bitácora como "Editado")
   ========================================================= */
Tickets.editar = async function (id, cambios) {
  const r = await api(`/tickets/${encodeURIComponent(id)}`, { method: 'PATCH', body: cambios });
  await sincronizar();
  return r;
};
const puedeEditar = (t, s) => !t.local && (s.role === 'admin' || (s.role === 'solicitante' && t.solicitante.email === s.email && t.estado === 'Abierto'));

const _abrirDetalleEquipo = abrirDetalle;
abrirDetalle = function (id, refrescar = false) {
  _abrirDetalleEquipo(id, refrescar);
  const t = DB.ticket(id);
  const s = Auth.sesion();
  if (!t || !s || state.modal?.tipo !== 'detalle') return;
  const chips = $('#modalBody .detail-hero .chip-row');
  if (chips && !chips.querySelector('.origen')) chips.insertAdjacentHTML('beforeend', origenChip(t));
  if (t.local) {
    $('#modalBody .detail-body')?.insertAdjacentHTML('afterbegin', `<div class="alert alert-info">${icon('cloudOff')}<div><strong>Guardado en este dispositivo.</strong> El folio ${esc(t.id)} es provisional; el servidor asignará el folio definitivo al sincronizar.</div></div>`);
  }
  if (puedeEditar(t, s)) {
    const acciones = $('#modalBody .modal-actions') || (() => {
      $('#modalBody .detail-body').insertAdjacentHTML('beforeend', '<div class="modal-actions"></div>');
      return $('#modalBody .modal-actions');
    })();
    acciones.insertAdjacentHTML('afterbegin', `<button class="btn btn-ghost" data-action="editar-ticket" data-id="${t.id}">${icon('edit')} Editar reporte</button>`);
  }
};

ACCIONES['editar-ticket'] = id => {
  const t = DB.ticket(id);
  if (!t) return;
  state.modal = { tipo: 'editar', id };
  abrirModal(`
    <form class="modal-pad" data-form="editar-ticket" data-id="${t.id}" novalidate>
      <div class="modal-head"><span class="stat-ic">${icon('edit')}</span><div><h3>Editar reporte</h3><p class="muted small">${t.id} · ${esc(ubicTexto(t))}</p></div></div>
      <label class="field"><span>Activo afectado</span><input type="text" name="activo" maxlength="80" value="${esc(t.ubicacion.activo)}"></label>
      <div class="field"><span>Severidad</span><div class="chip-filters">${Object.keys(SEVERIDADES).map(k => `
        <label class="fchip sev-pick ${t.severidad === k ? 'is-on' : ''}"><input type="radio" name="severidad" value="${k}" ${t.severidad === k ? 'checked' : ''} hidden>${k}</label>`).join('')}</div></div>
      <label class="field"><span>Descripción</span><textarea name="descripcion" rows="4" maxlength="500">${esc(t.descripcion)}</textarea></label>
      <p class="tiny muted">El cambio queda registrado en el historial del ticket y en la bitácora de la base de datos (antes y después).</p>
      <div class="alert alert-error" hidden></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-action="ver" data-id="${t.id}">Cancelar</button><button type="submit" class="btn btn-primary">${icon('check')} Guardar cambios</button></div>
    </form>`);
};
document.addEventListener('change', e => {
  if (e.target.matches('.sev-pick input')) $$('.sev-pick').forEach(l => l.classList.toggle('is-on', l.querySelector('input').checked));
});
FORMULARIOS['editar-ticket'] = async form => {
  const id = form.dataset.id;
  const r = await Tickets.editar(id, { activo: form.activo.value, severidad: form.severidad.value, descripcion: form.descripcion.value });
  if (r?.encolado) toast('Edición guardada sin conexión', 'Se enviará al servidor cuando vuelva el internet.', 'info');
  else toast(r?.cambio === false ? 'Sin cambios' : 'Reporte actualizado', r?.cambio === false ? 'No modificaste ningún dato.' : `${id} se actualizó y quedó en la bitácora.`);
  abrirDetalle(id);
};

/* =========================================================
   5. ALERTAS CRÍTICAS EN LA WEB Y EN EL TELÉFONO
   Reportes de severidad Crítica, zonas muertas de Wi-Fi y
   reportes que suben a Crítica llegan como "Alerta crítica".
   ========================================================= */
const esAlerta = n => /^Alerta crítica/i.test(n.title || '');
const _notificacionSistema = notificacionSistema;
notificacionSistema = function (n) {
  if (!esAlerta(n)) return _notificacionSistema(n);
  mostrarAlerta(n);
  try { if ('vibrate' in navigator) navigator.vibrate([300, 120, 300, 120, 300]); } catch { /* sin vibración */ }
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opciones = {
      body: n.body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: `alerta-${n.ticketId || n.id}`,
      requireInteraction: true, renotify: true, vibrate: [300, 120, 300, 120, 300],
      data: { folio: n.ticketId, url: '/#notificaciones' }
    };
    const titulo = `CampusCare · ${n.title}`;
    if (PWA.registro?.active) PWA.registro.showNotification(titulo, opciones).catch(() => new Notification(titulo, opciones));
    else new Notification(titulo, opciones);
  } catch { /* el navegador no permite mostrarla */ }
};

function mostrarAlerta(n) {
  let barra = $('#alertaCritica');
  if (!barra) {
    document.body.insertAdjacentHTML('beforeend', '<div id="alertaCritica" class="alerta-critica" role="alert"></div>');
    barra = $('#alertaCritica');
  }
  barra.innerHTML = `<span class="alerta-ic">${icon('siren')}</span>
    <div><strong>${esc(n.title)}</strong><p>${esc(n.body)}</p></div>
    <div class="btn-row">${n.ticketId ? `<button class="btn btn-sm btn-light" data-action="alerta-ver" data-id="${esc(n.ticketId)}">Ver reporte</button>` : ''}
    <button class="btn btn-sm btn-glass" data-action="alerta-cerrar">Entendido</button></div>`;
  barra.hidden = false;
}
ACCIONES['alerta-ver'] = id => { $('#alertaCritica').hidden = true; abrirDetalle(id); };
ACCIONES['alerta-cerrar'] = () => { $('#alertaCritica').hidden = true; };
ACCIONES['alerta-prueba'] = () => notificacionSistema({
  id: `prueba-${Date.now()}`, title: 'Alerta crítica (prueba)',
  body: 'Así se ve una alerta crítica en este dispositivo: aviso en pantalla, vibración y notificación que no se cierra sola.'
});

iconoNotif = (function (original) {
  return titulo => (/^Alerta crítica/i.test(titulo) ? 'siren' : /red degradada/i.test(titulo) ? 'wifi' : original(titulo));
})(iconoNotif);

/* Explicación de los canales de aviso en la vista de notificaciones */
const _renderNotif = RENDER.notificaciones;
RENDER.notificaciones = s => `
  <section class="card canales">
    <div class="card-head"><h3>Alertas y notificaciones</h3><span class="muted small">Cómo te avisa CampusCare</span></div>
    <div class="canal-grid">
      <article class="canal"><span class="canal-ic">${icon('grid')}</span><strong>En la web</strong><p class="small">Contador en la campana, aviso emergente al instante (tiempo real con Server-Sent Events) y esta bandeja guardada en la base de datos.</p></article>
      <article class="canal"><span class="canal-ic">${icon('phone')}</span><strong>En el smartphone</strong><p class="small">Notificación push del sistema con vibración, aun con la aplicación cerrada (Web Push + VAPID). Instala la app para recibirlas como una aplicación nativa.</p></article>
      <article class="canal canal-alerta"><span class="canal-ic">${icon('siren')}</span><strong>Alertas críticas</strong><p class="small">Reportes de severidad Crítica y zonas muertas de Wi-Fi: barra roja en pantalla, vibración larga y notificación que no se cierra sola.</p></article>
    </div>
    <div class="btn-row">${botonPush()}<button class="btn btn-ghost btn-sm" data-action="alerta-prueba">${icon('siren')} Probar una alerta crítica aquí</button></div>
  </section>
  ${_renderNotif(s)}`;

/* =========================================================
   6. REGISTRO CON CÓDIGO DE INVITACIÓN
   ========================================================= */
const _registro = Auth.registro.bind(Auth);
Auth.registro = function (datos) {
  const codigo = $('#regCodigo')?.value?.trim();
  return _registro({ ...datos, ...(codigo ? { codigo } : {}), desde: codigo ? 'enlace' : undefined });
};
