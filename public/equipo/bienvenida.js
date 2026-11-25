/* =========================================================
   Página de bienvenida, registro por enlace o QR e invitaciones
   ---------------------------------------------------------
   /bienvenida (o /)  → portada con el contexto del proyecto
   /entrar            → inicio de sesión
   /registro?codigo=  → registro con el rol de la invitación
   La persona que entra con el enlace desde su teléfono usa la
   misma aplicación (misma interfaz y mismas funciones de su rol).
   ========================================================= */
'use strict';

const Bienvenida = { forzarApp: false, sesion: null };
const ORIGEN_APP = () => API_ORIGEN || location.origin;
const enlaceRegistro = codigo => `${ORIGEN_APP()}/registro${codigo ? `?codigo=${encodeURIComponent(codigo)}` : ''}`;
const qrDe = texto => `${API_ORIGEN}/api/qr?texto=${encodeURIComponent(texto)}`;
const ROL_TEXTO = { solicitante: 'Alumno / Docente', mantenimiento: 'Personal de mantenimiento', admin: 'Administrador' };

/* ---------- Cambiar de pantalla sin salir de la aplicación ---------- */
function irA(ruta) {
  if (location.pathname + location.search !== ruta) history.pushState(null, '', ruta);
}
function mostrarBienvenida(sesion = null) {
  Bienvenida.sesion = sesion;
  $('#app').hidden = true;
  $('#login').hidden = true;
  $('#bienvenida').hidden = false;
  // Con sesión abierta, "Entrar" lleva directo al panel
  $$('[data-bv-entrar]').forEach(b => { b.lastChild.textContent = sesion ? ' Ir a mi panel' : (b.classList.contains('btn-lg') ? ' Entrar a la aplicación' : 'Entrar'); });
  document.title = 'Bienvenido a CampusCare · Mantenimiento Universitario';
  cargarDatosBienvenida();
}
async function cargarDatosBienvenida() {
  const link = enlaceRegistro('');
  $('#bvLink').textContent = link.replace(/^https?:\/\//, '');
  $('#bvQR').src = qrDe(link);
  try {
    const r = await api('/publico/resumen');
    $('#bvStat1').textContent = r.atendidos;
    $('#bvStat2').textContent = `${r.sla}%`;
    $('#bvStat3').textContent = r.edificios;
  } catch { /* sin servidor: se quedan los valores iniciales */ }
}

function mostrarAcceso(registro = false, codigo = '') {
  $('#bienvenida').hidden = true;
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#loginForm').hidden = registro;
  $('#registroForm').hidden = !registro;
  document.title = 'CampusCare · Mantenimiento Universitario';
  actualizarHeroStats();
  if (registro) prepararRegistro(codigo);
}

/* Registro con código: se muestra el rol que dará la invitación */
async function prepararRegistro(codigo) {
  const caja = $('#regInvitacion');
  $('#regCodigo').value = codigo || '';
  const texto = $('#registroForm .muted');
  if (!codigo) {
    caja.hidden = true;
    texto.textContent = 'Regístrate con tu correo institucional. Tu cuenta tendrá el rol de Alumno / Docente.';
    return;
  }
  caja.hidden = false;
  caja.innerHTML = `${icon('link')}<div>Revisando el enlace de registro…</div>`;
  try {
    const i = await api(`/auth/invitacion/${encodeURIComponent(codigo)}`);
    texto.textContent = 'Te invitaron a CampusCare. Crea tu cuenta con tu correo institucional.';
    caja.innerHTML = `${icon('checkCircle')}<div><strong>Invitación ${esc(i.codigo)} válida.</strong> Tu cuenta tendrá el rol de <b>${esc(i.rolTexto)}</b> y verás la interfaz completa de ese rol. Vence el ${new Date(i.expira).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}.</div>`;
  } catch (e) {
    $('#regCodigo').value = '';
    caja.className = 'alert alert-error';
    caja.textContent = `${e.message} Puedes registrarte de todos modos como Alumno / Docente.`;
    return;
  }
  caja.className = 'alert alert-info';
}

/* El inicio decide qué mostrar según la dirección */
const _mostrarLoginBv = mostrarLogin;
mostrarLogin = function () {
  const ruta = location.pathname;
  const q = new URLSearchParams(location.search);
  if (ruta === '/registro' || q.has('codigo')) { mostrarAcceso(true, q.get('codigo') || ''); return; }
  if (ruta === '/entrar' || q.has('origen') || esStandalone()) { _mostrarLoginBv(); mostrarAcceso(false); return; }
  mostrarBienvenida();
};

const _entrarAppBv = entrarApp;
entrarApp = async function (s) {
  if (location.pathname === '/bienvenida' && !Bienvenida.forzarApp) { mostrarBienvenida(s); return; }
  Bienvenida.forzarApp = false;
  $('#bienvenida').hidden = true;
  if (['/bienvenida', '/registro', '/entrar'].includes(location.pathname) || location.search) history.replaceState(null, '', `/${location.hash}`);
  document.title = 'CampusCare · Mantenimiento Universitario';
  return _entrarAppBv(s);
};

window.addEventListener('popstate', () => {
  const s = Auth.sesion();
  if (location.pathname === '/bienvenida' || (!s && location.pathname === '/')) { mostrarBienvenida(s); return; }
  if (!s) mostrarLogin();
  else if ($('#app').hidden) { Bienvenida.forzarApp = true; entrarApp(s); }
});

ACCIONES['bv-entrar'] = () => {
  const s = Auth.sesion();
  if (s) { Bienvenida.forzarApp = true; irA('/'); entrarApp(s); return; }
  irA('/entrar');
  mostrarAcceso(false);
  $('#loginEmail').focus();
};
/* Botones de cuentas de demostración en la portada (entran con un clic) */
ACCIONES['bv-demo'] = (id, el) => {
  if (Auth.sesion()) cerrarSesion(false);
  irA('/entrar');
  mostrarAcceso(false);
  ACCIONES.demo(id, el);
};
ACCIONES['bv-registro'] = () => {
  irA('/registro');
  mostrarAcceso(true, '');
  $('#regNombre').focus();
};
ACCIONES['bv-inicio'] = (id, el, e) => {
  e?.preventDefault();
  irA('/bienvenida');
  mostrarBienvenida(Auth.sesion());
  window.scrollTo({ top: 0 });
};
ACCIONES['bv-copiar'] = async () => {
  const link = enlaceRegistro('');
  try { await navigator.clipboard.writeText(link); toast('Enlace copiado', link, 'info'); }
  catch { prompt('Copia el enlace de registro:', link); }
};
const _mostrarRegistro = ACCIONES['mostrar-registro'];
ACCIONES['mostrar-registro'] = () => { irA('/registro'); _mostrarRegistro(); prepararRegistro($('#regCodigo').value); };
const _mostrarLoginForm = ACCIONES['mostrar-login'];
ACCIONES['mostrar-login'] = () => { irA('/entrar'); _mostrarLoginForm(); };

/* Correo: si se escribe solo el usuario, se completa el dominio institucional (útil en el teléfono) */
const completarCorreo = c => { c = String(c || '').trim(); return c && !c.includes('@') ? `${c}${DOMINIO}` : c; };
const _registroBv = Auth.registro;
Auth.registro = function (d) { return _registroBv.call(this, { ...d, correo: completarCorreo(d.correo) }); };
const _loginBv = Auth.login;
Auth.login = function (correo, password) { return _loginBv.call(this, completarCorreo(correo), password); };

/* =========================================================
   VISTA "INVITAR POR ENLACE O QR"
   ========================================================= */
const Compartir = { lista: null, codigo: null };
const vigente = i => i.vigente;

RENDER.compartir = s => {
  const esAdmin = s.role === 'admin';
  const lista = Compartir.lista || [];
  const actual = lista.find(i => i.codigo === Compartir.codigo);
  const link = enlaceRegistro(actual?.codigo || '');
  const rol = actual ? ROL_TEXTO[actual.rol] : 'Alumno / Docente';
  return `
  <div class="grid-2 cmp-grid">
    <section class="card cmp-qr-card">
      <div class="card-head"><h3>Comparte este enlace</h3><span class="pill" style="background:var(--g100);color:var(--g800)">${icon('user')} Rol: ${esc(rol)}</span></div>
      <div class="cmp-qr">
        <img src="${qrDe(link)}" alt="Código QR del enlace de registro" width="260" height="260">
        <div class="cmp-datos">
          <p class="small muted">Pide a la otra persona que escanee el código con la cámara de su teléfono. Se abrirá CampusCare, creará su cuenta y entrará con la interfaz completa de su rol: reportar, dar seguimiento${actual?.rol === 'admin' ? ', crear usuarios y administrar la base de datos' : actual?.rol === 'mantenimiento' ? ' y atender órdenes de trabajo' : ''}.</p>
          <label class="field"><span>Enlace</span><input type="text" readonly value="${esc(link)}" id="cmpLink"></label>
          <div class="btn-row">
            <button class="btn btn-primary btn-sm" data-action="cmp-copiar">${icon('copy')} Copiar</button>
            <button class="btn btn-ghost btn-sm" data-action="cmp-compartir">${icon('share')} Compartir</button>
            <a class="btn btn-ghost btn-sm" href="${esc(link)}" target="_blank" rel="noopener">${icon('link')} Abrir</a>
          </div>
          ${actual ? `<p class="tiny muted">Código ${esc(actual.codigo)} · ${actual.usos} de ${actual.maxUsos} registros · vence el ${new Date(actual.expira).toLocaleDateString('es-MX')}</p>` : '<p class="tiny muted">Enlace general: cualquier persona se registra como Alumno / Docente.</p>'}
        </div>
      </div>
    </section>
    <form class="card form-card cmp-form" data-form="invitacion" novalidate>
      <div class="card-head"><h3>Crear enlace de registro</h3></div>
      <label class="field"><span>Rol que tendrá la cuenta</span><select name="rol">
        <option value="solicitante">Alumno / Docente</option>
        ${esAdmin ? '<option value="mantenimiento">Personal de mantenimiento</option><option value="admin">Administrador (puede crear usuarios)</option>' : ''}
      </select></label>
      <div class="field-grid">
        <label class="field"><span>Vigencia</span><select name="dias"><option value="1">1 día</option><option value="7" selected>7 días</option><option value="30">30 días</option></select></label>
        <label class="field"><span>Registros permitidos</span><select name="maxUsos"><option value="1">1 persona</option><option value="10">10</option><option value="30" selected>30</option><option value="100">100</option></select></label>
      </div>
      ${esAdmin ? '' : '<p class="tiny muted">Solo la administración puede invitar a personal de mantenimiento o administradores.</p>'}
      <div class="alert alert-error" hidden></div>
      <button type="submit" class="btn btn-primary">${icon('plusUser')} Generar enlace y código QR</button>
    </form>
  </div>
  <section class="card">
    <div class="card-head"><h3>${esAdmin ? 'Enlaces creados' : 'Mis enlaces'}</h3><button class="btn btn-ghost btn-sm" data-action="cmp-general">${icon('qr')} Mostrar enlace general</button></div>
    ${Compartir.lista === null ? '<p class="muted small">Cargando…</p>' : lista.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Código</th><th>Rol</th><th>Registros</th><th>Vence</th><th>Estado</th>${esAdmin ? '<th>Creó</th>' : ''}<th></th></tr></thead>
      <tbody>${lista.map(i => `<tr class="${i.codigo === Compartir.codigo ? 'is-sel' : ''}">
        <td data-label="Código"><span class="folio">${esc(i.codigo)}</span></td>
        <td data-label="Rol">${esc(ROL_TEXTO[i.rol])}</td>
        <td data-label="Registros">${i.usos} / ${i.maxUsos}</td>
        <td data-label="Vence">${new Date(i.expira).toLocaleDateString('es-MX')}</td>
        <td data-label="Estado">${i.vigente ? '<span class="chip st-resuelto">Vigente</span>' : !i.activa ? '<span class="chip st-rechazado">Desactivado</span>' : '<span class="chip st-cerrado">Vencido o agotado</span>'}</td>
        ${esAdmin ? `<td data-label="Creó">${esc(i.creadaPor || '—')}</td>` : ''}
        <td data-label=""><div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-action="cmp-mostrar" data-id="${esc(i.codigo)}">${icon('qr')} QR</button>
          <button class="btn btn-ghost btn-sm" data-action="cmp-activa" data-id="${esc(i.codigo)}">${i.activa ? `${icon('ban')} Desactivar` : `${icon('check')} Activar`}</button>
        </div></td>
      </tr>`).join('')}</tbody></table></div>` : vacio('Aún no hay enlaces', 'Genera uno para invitar a alguien con un rol específico.', 'link')}
  </section>`;
};

async function cargarInvitaciones() {
  try { Compartir.lista = await api('/invitaciones'); } catch { Compartir.lista = []; }
  const s = Auth.sesion();
  if (Compartir.codigo === null) {
    // Para la exposición: el admin ve primero el enlace de administrador de demostración
    const expo = s?.role === 'admin' && Compartir.lista.find(i => i.codigo === 'EXPO-2026' && i.vigente);
    Compartir.codigo = (expo || Compartir.lista.find(vigente))?.codigo || '';
  }
  if (state.vista === 'compartir') { $('#view').innerHTML = RENDER.compartir(s); sellarAutor(); }
}
POST_RENDER.compartir = () => { if (Compartir.lista === null) cargarInvitaciones(); };

FORMULARIOS.invitacion = async form => {
  const r = await api('/invitaciones', { method: 'POST', body: { rol: form.rol.value, dias: Number(form.dias.value), maxUsos: Number(form.maxUsos.value) } });
  Compartir.codigo = r.codigo;
  toast('Enlace creado', `Código ${r.codigo}. Compártelo con el QR o el enlace.`);
  await cargarInvitaciones();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
ACCIONES['cmp-mostrar'] = id => { Compartir.codigo = id; $('#view').innerHTML = RENDER.compartir(Auth.sesion()); sellarAutor(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
ACCIONES['cmp-general'] = () => ACCIONES['cmp-mostrar']('');
ACCIONES['cmp-activa'] = async id => {
  const i = Compartir.lista.find(x => x.codigo === id);
  await api(`/invitaciones/${encodeURIComponent(id)}`, { method: 'PATCH', body: { activa: !i.activa } });
  toast(i.activa ? 'Enlace desactivado' : 'Enlace activado', `Código ${id}.`);
  await cargarInvitaciones();
};
ACCIONES['cmp-copiar'] = async () => {
  const link = $('#cmpLink').value;
  try { await navigator.clipboard.writeText(link); toast('Enlace copiado', link, 'info'); }
  catch { $('#cmpLink').select(); document.execCommand?.('copy'); toast('Enlace seleccionado', 'Cópialo con Ctrl + C.', 'info'); }
};
ACCIONES['cmp-compartir'] = async () => {
  const link = $('#cmpLink').value;
  if (navigator.share) { try { await navigator.share({ title: 'Regístrate en CampusCare', text: 'Crea tu cuenta en CampusCare con este enlace', url: link }); } catch { /* cancelado */ } return; }
  ACCIONES['cmp-copiar']();
};
Bus.on('data', () => { if (!Auth.sesion()) Compartir.lista = null; });

/* Al cerrar sesión se olvida la lista de invitaciones del usuario anterior */
const _cerrarSesionBv = cerrarSesion;
cerrarSesion = function (expirada = false) {
  Compartir.lista = null;
  Compartir.codigo = null;
  _cerrarSesionBv(expirada);
};

/* Los enlaces internos de la bienvenida solo desplazan la página (no cambian la vista de la app) */
document.addEventListener('click', e => {
  const a = e.target.closest('.bienvenida a[href^="#"]');
  if (!a) return;
  e.preventDefault();
  $(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
