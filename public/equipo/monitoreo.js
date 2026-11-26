/* =========================================================
   Monitoreo físico con Arduino
   ---------------------------------------------------------
   Tres escenas animadas que siguen a los sensores reales:
     Cisterna ........... potenciómetro (nivel de agua)
     Equipo de cómputo .. sensor de flama (encendedor)
     Fallas de luz ...... sensor de luz (fotorresistencia)
   La computadora que tiene el Arduino por USB lo lee con
   Web Serial (Chrome o Edge) y manda las lecturas al
   servidor; los demás dispositivos las ven en vivo.
   Sin Arduino se puede usar el modo demostración.
   ========================================================= */
'use strict';

Object.assign(ICONOS, {
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5 1-8.5z"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  usb: '<path d="M12 3v14"/><path d="m9 6 3-3 3 3"/><circle cx="12" cy="19" r="2"/><path d="M7 10v2a2 2 0 0 0 2 2h3M17 9v3a2 2 0 0 1-2 2h-3"/>',
  volumeOff: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'
});

VISTAS.sensores = { titulo: 'Monitoreo físico (Arduino)', corto: 'Sensores', icono: 'activity' };
VISTAS_EQUIPO.push('sensores');
VISTAS_SIN_REFRESCO.push('sensores');
MODULO_VISTA.sensores = 'sensores';
for (const rol of ['solicitante', 'mantenimiento', 'admin']) {
  const v = ROLES[rol].vistas;
  v.splice(v.indexOf('sin-conexion') + 1, 0, 'sensores');
}

/* ---------- Estado ---------- */
const CAL_DEFECTO = { luzClaro: 100, luzOscuro: 950, flamaNada: 1010, flamaCerca: 300, umbralFlama: 55, aguaVacio: 0, aguaLleno: 1023 };
const Monitor = {
  modo: 'ninguno',            // ninguno | arduino | demo
  puerto: null, lector: null, escritor: null,
  crudo: null,                // última línea del Arduino
  lectura: { luz: 85, fuego: false, flama: 0, agua: 55 },
  confirmados: null,          // estados confirmados por el servidor
  enLinea: false, ultimoDato: 0, fuenteRemota: null,
  alarma: true,
  historia: { luz: [], flama: [], agua: [] },
  eventos: null,
  ultimoEnvio: 0, ultimoEstadoEnviado: '',
  cal: (() => { try { return { ...CAL_DEFECTO, ...JSON.parse(localStorage.getItem('campuscare_calibracion') || '{}') }; } catch { return { ...CAL_DEFECTO }; } })()
};
const soportaSerial = () => 'serial' in navigator && window.isSecureContext;
const limitar = v => Math.round(Math.min(Math.max(v, 0), 100));
const escala = (v, cero, cien) => (cien === cero ? 0 : limitar(((v - cero) / (cien - cero)) * 100));

/* Mismos umbrales que el servidor (src/sensores.js) */
function estadosLocales(l) {
  return {
    luz: l.luz < 15 ? 'apagada' : l.luz < 45 ? 'falla' : 'encendida',
    flama: l.fuego ? 'fuego' : 'normal',
    agua: l.agua < 20 ? 'bajo' : l.agua > 90 ? 'desbordamiento' : 'normal'
  };
}
const TEXTO = {
  luz: { encendida: ['Encendida', 'ok'], falla: ['Falla (parpadeo)', 'warn'], apagada: ['Apagada', 'bad'] },
  flama: { normal: ['Normal', 'ok'], fuego: ['Fuego detectado', 'bad'] },
  agua: { normal: ['Normal', 'ok'], bajo: ['Nivel bajo', 'bad'], desbordamiento: ['Desbordamiento', 'bad'] }
};
const nivelAgua = v => (v < 20 ? 'Bajo' : v > 90 ? 'Desbordamiento' : v < 40 ? 'Bajo' : v > 70 ? 'Alto' : 'Medio');

/* =========================================================
   VISTA
   ========================================================= */
function escenaHTML(id, titulo, icono, img, cuerpo, control) {
  return `<article class="mon-esc" id="esc-${id}">
    <div class="mon-esc-foto" style="--img:url('${img}')"><span>${icon(icono)} ${titulo}</span><b class="mon-pill" id="pill-${id}">—</b></div>
    <div class="mon-esc-cuerpo">${cuerpo}</div>
    <svg class="mon-spark" id="spark-${id}" viewBox="0 0 240 36" preserveAspectRatio="none" aria-hidden="true"><polyline points=""/></svg>
    <div class="mon-control" data-solo-demo ${Monitor.modo === 'demo' ? '' : 'hidden'}>${control}</div>
  </article>`;
}

const SVG_CISTERNA = `<svg viewBox="0 0 200 150" class="mon-svg" role="img" aria-label="Cisterna">
  <defs><clipPath id="clipCisterna"><rect x="45" y="18" width="110" height="112" rx="8"/></clipPath></defs>
  <rect x="45" y="18" width="110" height="112" rx="8" class="mon-tanque"/>
  <g clip-path="url(#clipCisterna)"><g id="aguaNivel" style="transition:transform .35s"><g class="mon-ola"><path d="M0 0 Q15 -6 30 0 T60 0 T90 0 T120 0 T150 0 T180 0 T210 0 T240 0 V200 H0 Z" class="mon-agua"/></g></g></g>
  <line x1="158" y1="40" x2="166" y2="40" class="mon-marca"/><text x="169" y="44" class="mon-txt-s">90%</text>
  <line x1="158" y1="108" x2="166" y2="108" class="mon-marca"/><text x="169" y="112" class="mon-txt-s">20%</text>
  <text id="aguaTxt" x="100" y="80" text-anchor="middle" class="mon-txt-g">55%</text>
</svg>`;
const SVG_EQUIPO = `<svg viewBox="0 0 200 150" class="mon-svg" role="img" aria-label="Equipo de cómputo">
  <rect x="30" y="24" width="104" height="70" rx="6" class="mon-carcasa"/>
  <rect id="pantalla" x="38" y="32" width="88" height="54" rx="3" class="mon-pantalla"/>
  <text id="pantallaTxt" x="82" y="63" text-anchor="middle" class="mon-txt-p">En línea</text>
  <rect x="72" y="94" width="20" height="14" class="mon-base"/><rect x="55" y="108" width="54" height="6" rx="3" class="mon-base"/>
  <rect x="144" y="38" width="32" height="76" rx="4" class="mon-carcasa"/><circle cx="160" cy="50" r="3" id="ledCpu" class="mon-led"/>
  <g id="fuegoGrp" class="mon-fuego">
    <circle class="mon-humo" cx="150" cy="22" r="8"/><circle class="mon-humo" cx="167" cy="15" r="6" style="animation-delay:.6s"/>
    <path class="mon-llama mon-llama-a" d="M139 114 Q137 84 152 68 Q150 88 160 80 Q173 95 171 114 Z"/>
    <path class="mon-llama mon-llama-b" d="M148 114 Q147 96 156 87 Q156 99 162 96 Q167 104 165 114 Z" style="animation-delay:.15s"/>
  </g>
</svg>`;
const SVG_AULA = `<svg viewBox="0 0 200 150" class="mon-svg" role="img" aria-label="Aula">
  <rect x="8" y="8" width="184" height="134" rx="8" id="aulaFondo" class="mon-aula"/>
  <line x1="100" y1="8" x2="100" y2="28" class="mon-cable"/>
  <g id="foco"><path id="haz" d="M89 46 L44 134 H156 L111 46 Z" class="mon-haz"/><circle cx="100" cy="38" r="11" class="mon-foco"/></g>
  <rect x="34" y="100" width="46" height="8" rx="2" class="mon-base"/><rect x="120" y="100" width="46" height="8" rx="2" class="mon-base"/>
  <rect x="39" y="108" width="4" height="24" class="mon-base"/><rect x="71" y="108" width="4" height="24" class="mon-base"/>
  <rect x="125" y="108" width="4" height="24" class="mon-base"/><rect x="157" y="108" width="4" height="24" class="mon-base"/>
</svg>`;

function barraConexionHTML(s) {
  const m = Monitor.modo;
  const estado = m === 'arduino' ? ['usb', 'Arduino conectado a esta computadora', 'is-on']
    : m === 'demo' ? ['sliders', 'Modo demostración (sin Arduino)', 'is-demo']
    : Monitor.enLinea ? ['activity', `En vivo desde otro equipo${Monitor.fuenteRemota ? ` · ${esc(Monitor.fuenteRemota)}` : ''}`, 'is-on']
    : ['usb', 'Sin datos del Arduino', ''];
  return `<div class="mon-estado ${estado[2]}"><span class="mon-punto"></span>${icon(estado[0])}<div><strong>${estado[1]}</strong><small id="monUltimo">${Monitor.ultimoDato ? `Último dato ${hace(Monitor.ultimoDato)}` : 'Conecta el Arduino o usa el modo demostración.'}</small></div></div>
    <div class="btn-row">
      ${m === 'arduino'
        ? `<button class="btn btn-ghost btn-sm" data-action="mon-alarma">${icon(Monitor.alarma ? 'volumeOff' : 'bell')} ${Monitor.alarma ? 'Silenciar alarma' : 'Activar alarma'}</button>
           <button class="btn btn-ghost btn-sm" data-action="mon-probar">${icon('zap')} Probar LEDs y buzzer</button>
           <button class="btn btn-danger btn-sm" data-action="mon-desconectar">${icon('logout')} Desconectar</button>`
        : `<button class="btn btn-primary btn-sm" data-action="mon-conectar">${icon('usb')} Conectar Arduino</button>
           <button class="btn ${m === 'demo' ? 'btn-light' : 'btn-ghost'} btn-sm" data-action="mon-demo">${icon('sliders')} ${m === 'demo' ? 'Salir de la demostración' : 'Modo demostración'}</button>`}
    </div>`;
}

RENDER.sensores = s => `
  <section class="card mon-barra" id="monBarra">${barraConexionHTML(s)}</section>
  ${!soportaSerial() ? `<div class="alert alert-info">${icon('info')}<div>Para conectar el Arduino abre CampusCare en <b>Google Chrome</b> o <b>Microsoft Edge</b> en la computadora (con HTTPS o en localhost). En este navegador puedes ver las lecturas en vivo y usar el modo demostración.</div></div>` : ''}
  <section class="mon-grid">
    ${escenaHTML('agua', 'Cisterna', 'drop', '/img/cat-plomeria.jpg', SVG_CISTERNA,
      `<label class="mon-lbl">Potenciómetro (nivel)</label><input type="range" min="0" max="100" step="1" value="${Monitor.lectura.agua}" data-demo="agua">`)}
    ${escenaHTML('flama', 'Equipo de cómputo', 'flame', '/img/cat-red.jpg', SVG_EQUIPO,
      `<button class="btn btn-ghost btn-sm mon-btn-fuego" data-action="mon-fuego">${icon('flame')} ${Monitor.lectura.fuego ? 'Retirar encendedor' : 'Acercar encendedor'}</button>`)}
    ${escenaHTML('luz', 'Fallas de luz', 'bulb', '/img/cat-electrica.jpg', SVG_AULA,
      `<label class="mon-lbl">Sensor de luz</label><input type="range" min="0" max="100" step="1" value="${Monitor.lectura.luz}" data-demo="luz">`)}
  </section>
  <div class="grid-2 mon-abajo">
    <section class="card">
      <div class="card-head"><h3>Eventos de los sensores</h3><span class="muted small">Solo cambios que duran más de 1 s</span></div>
      <ol class="mon-eventos" id="monEventos">${eventosHTML()}</ol>
    </section>
    <section class="card">
      <div class="card-head"><h3>Qué hace cada sensor</h3><span class="muted small">Se conecta con la app</span></div>
      <ul class="mon-reglas">
        <li><span class="mon-ic agua">${icon('drop')}</span><div><strong>Cisterna</strong><p class="small muted">Abajo de 20 % o arriba de 90 % genera un reporte de Plomería (Almacén, Edif. D).</p></div></li>
        <li><span class="mon-ic flama">${icon('flame')}</span><div><strong>Equipo de cómputo</strong><p class="small muted">La flama genera un reporte Crítico de Eléctrica y una alerta en la web y en el teléfono (Lab. de Cómputo 1).</p></div></li>
        <li><span class="mon-ic luz">${icon('bulb')}</span><div><strong>Fallas de luz</strong><p class="small muted">Bajo 45 % es una falla; bajo 15 % es un corte de luz y genera un reporte (Aula B-101).</p></div></li>
      </ul>
      <p class="tiny muted">Cada reporte entra al flujo de atención, al mapa de calor y al historial de registros. Mientras siga abierto no se repite.</p>
    </section>
  </div>
  <section class="card mon-cal" id="monCal" ${Monitor.modo === 'arduino' ? '' : 'hidden'}>${calibracionHTML()}</section>`;

function eventosHTML() {
  if (!Monitor.eventos) return '<li class="muted small">Cargando…</li>';
  if (!Monitor.eventos.length) return `<li class="muted small">Aún no hay eventos. Prueben apagar la luz, acercar el encendedor o girar el potenciómetro.</li>`;
  const tono = e => (['fuego', 'apagada', 'bajo', 'desbordamiento'].includes(e.estado) ? 'bad' : e.estado === 'falla' ? 'warn' : 'ok');
  const ic = { luz: 'bulb', flama: 'flame', agua: 'drop' };
  return Monitor.eventos.slice(0, 15).map(e => `<li class="mon-ev mon-${tono(e)}">
    <span class="mon-ev-ic">${icon(ic[e.sensor])}</span>
    <div><strong>${esc(e.mensaje)}</strong><small>${fmtFecha(e.at)} · ${e.valor ?? '—'}%${e.fuente === 'demo' ? ' · demostración' : ''}</small></div>
    ${e.folio ? `<button class="btn btn-ghost btn-sm" data-action="ver" data-id="${esc(e.folio)}">${esc(e.folio)}</button>` : ''}
  </li>`).join('');
}

function calibracionHTML() {
  const c = Monitor.crudo || {};
  const cal = Monitor.cal;
  return `<div class="card-head"><h3>Calibración</h3><span class="muted small">Se guarda en esta computadora</span></div>
    <div class="mon-cal-grid">
      <div><small>Luz (A0)</small><strong id="crudoLuz">${c.luz ?? '—'}</strong>
        <div class="btn-row"><button class="btn btn-ghost btn-sm" data-action="mon-cal" data-k="luzClaro" data-v="luz">Luz normal</button><button class="btn btn-ghost btn-sm" data-action="mon-cal" data-k="luzOscuro" data-v="luz">Oscuro</button></div>
        <small class="tiny muted">Normal ${cal.luzClaro} · oscuro ${cal.luzOscuro}</small></div>
      <div><small>Flama (A1)</small><strong id="crudoFlama">${c.flamaRaw ?? '—'}</strong>
        <div class="btn-row"><button class="btn btn-ghost btn-sm" data-action="mon-cal" data-k="flamaNada" data-v="flamaRaw">Sin flama</button><button class="btn btn-ghost btn-sm" data-action="mon-cal" data-k="flamaCerca" data-v="flamaRaw">Encendedor cerca</button></div>
        <label class="tiny muted">Alarma desde <b id="umbralTxt">${cal.umbralFlama}</b>%<input type="range" min="10" max="95" step="5" value="${cal.umbralFlama}" data-umbral></label></div>
      <div><small>Potenciómetro (A2)</small><strong id="crudoAgua">${c.agua ?? '—'}</strong>
        <div class="btn-row"><button class="btn btn-ghost btn-sm" data-action="mon-cal" data-k="aguaVacio" data-v="agua">Tanque vacío</button><button class="btn btn-ghost btn-sm" data-action="mon-cal" data-k="aguaLleno" data-v="agua">Tanque lleno</button></div>
        <small class="tiny muted">Vacío ${cal.aguaVacio} · lleno ${cal.aguaLleno}</small></div>
    </div>
    <button class="btn btn-ghost btn-sm" data-action="mon-cal-reset">${icon('refresh')} Restablecer calibración</button>`;
}

POST_RENDER.sensores = () => {
  pintarEscenas();
  cargarSensores();
};

async function cargarSensores() {
  try {
    const r = await api('/sensores');
    Monitor.eventos = r.eventos;
    if (Monitor.modo === 'ninguno' && r.ultimo) aplicarRemoto(r.ultimo, r.enLinea);
  } catch { Monitor.eventos ??= []; }
  if (state.vista === 'sensores') { const el = $('#monEventos'); if (el) el.innerHTML = eventosHTML(); pintarEscenas(); }
}

/* ---------- Dibujo de las escenas (sin redibujar la vista) ---------- */
function pastilla(id, sensor, estado, extra = '') {
  const el = $(`#pill-${id}`);
  if (!el || !estado) return;
  const [txt, tono] = TEXTO[sensor][estado];
  el.textContent = `${txt}${extra}`;
  el.className = `mon-pill mon-${tono}`;
}
function pintarEscenas() {
  if (state.vista !== 'sensores' || !$('#esc-agua')) return;
  const l = Monitor.lectura;
  const est = estadosLocales(l);
  // Cisterna
  $('#aguaNivel').style.transform = `translateY(${130 - l.agua * 1.12}px)`;
  $('#aguaTxt').textContent = `${l.agua}%`;
  pastilla('agua', 'agua', est.agua, est.agua === 'normal' ? ` · ${nivelAgua(l.agua)} ${l.agua}%` : ` · ${l.agua}%`);
  // Equipo de cómputo
  $('#esc-flama').classList.toggle('en-fuego', l.fuego);
  $('#pantallaTxt').textContent = l.fuego ? 'Alerta de fuego' : 'En línea';
  pastilla('flama', 'flama', est.flama, l.fuego ? ` · ${l.flama}%` : '');
  const bf = $('.mon-btn-fuego');
  if (bf) bf.innerHTML = `${icon('flame')} ${l.fuego ? 'Retirar encendedor' : 'Acercar encendedor'}`;
  // Fallas de luz
  const foco = $('#foco');
  foco.style.opacity = Math.max(0.08, l.luz / 100);
  foco.classList.toggle('mon-parpadeo', est.luz === 'falla');
  $('#esc-luz').classList.toggle('a-oscuras', est.luz === 'apagada');
  pastilla('luz', 'luz', est.luz, ` · ${l.luz}%`);
  // Gráficas de los últimos segundos
  for (const k of ['agua', 'flama', 'luz']) {
    const h = Monitor.historia[k];
    const pts = h.map((v, i) => `${(i / Math.max(h.length - 1, 1)) * 240},${34 - v * 0.32}`).join(' ');
    $(`#spark-${k} polyline`)?.setAttribute('points', pts);
  }
  const u = $('#monUltimo');
  if (u && Monitor.ultimoDato) u.textContent = `Último dato ${hace(Monitor.ultimoDato)}`;
  if (Monitor.crudo && $('#crudoLuz')) {
    $('#crudoLuz').textContent = Monitor.crudo.luz; $('#crudoFlama').textContent = Monitor.crudo.flamaRaw; $('#crudoAgua').textContent = Monitor.crudo.agua;
  }
}
let cuadroPendiente = false;
function programarPintado() {
  if (cuadroPendiente) return;
  cuadroPendiente = true;
  requestAnimationFrame(() => { cuadroPendiente = false; pintarEscenas(); });
}
function guardarHistoria() {
  const l = Monitor.lectura;
  for (const [k, v] of [['agua', l.agua], ['flama', l.fuego ? Math.max(l.flama, 60) : l.flama], ['luz', l.luz]]) {
    const h = Monitor.historia[k];
    h.push(v);
    if (h.length > 120) h.shift();
  }
}
function repintarBarra() {
  const s = Auth.sesion();
  const b = $('#monBarra');
  if (b && s) b.innerHTML = barraConexionHTML(s);
  $$('[data-solo-demo]').forEach(el => { el.hidden = Monitor.modo !== 'demo'; });
  const cal = $('#monCal');
  if (cal) { cal.hidden = Monitor.modo !== 'arduino'; if (!cal.hidden) cal.innerHTML = calibracionHTML(); }
}

/* =========================================================
   LECTURAS: Arduino, demostración o remotas
   ========================================================= */
function nuevaLectura(l, fuente) {
  Monitor.lectura = l;
  Monitor.ultimoDato = Date.now();
  guardarHistoria();
  programarPintado();
  enviarLectura(fuente);
}

/* Se manda al servidor una vez por segundo, o al momento si cambió un estado */
async function enviarLectura(fuente) {
  const ahora = Date.now();
  const firma = JSON.stringify(estadosLocales(Monitor.lectura));
  if (ahora - Monitor.ultimoEnvio < 900 && firma === Monitor.ultimoEstadoEnviado) return;
  Monitor.ultimoEnvio = ahora;
  Monitor.ultimoEstadoEnviado = firma;
  try {
    const r = await api('/sensores/lectura', { method: 'POST', body: { ...Monitor.lectura, fuente }, modulo: 'sensores' });
    Monitor.confirmados = r.ultimo.estados;
  } catch { /* sin conexión con el servidor: la escena sigue funcionando en local */ }
}

/* Si un estado sigue igual, se manda cada segundo para que el servidor lo confirme */
setInterval(() => {
  if (Monitor.modo === 'demo') nuevaLectura({ ...Monitor.lectura }, 'demo');
  else if (Monitor.modo === 'arduino' && Date.now() - Monitor.ultimoDato > 3000) {
    const u = $('#monUltimo');
    if (u) u.textContent = 'El Arduino no está mandando datos. Revisa el cable o recarga el código.';
  } else if (Monitor.modo === 'ninguno' && Monitor.enLinea && Date.now() - Monitor.ultimoDato > 15000) {
    Monitor.enLinea = false;
    if (state.vista === 'sensores') repintarBarra();
  }
  if (state.vista === 'sensores' && Monitor.ultimoDato) { const u = $('#monUltimo'); if (u && !/no está/.test(u.textContent)) u.textContent = `Último dato ${hace(Monitor.ultimoDato)}`; }
}, 1000);

/* Lectura cruda del Arduino → porcentajes con la calibración */
function convertir(c) {
  const cal = Monitor.cal;
  const flama = escala(c.flamaRaw ?? 1023, cal.flamaNada, cal.flamaCerca);
  return {
    luz: escala(c.luz, cal.luzOscuro, cal.luzClaro),
    flama,
    fuego: c.flama === 1 || flama >= cal.umbralFlama,
    agua: escala(c.agua, cal.aguaVacio, cal.aguaLleno)
  };
}
function procesarLinea(linea) {
  linea = linea.trim();
  if (!linea.startsWith('{')) return;
  let c;
  try { c = JSON.parse(linea); } catch { return; }
  if (c.pong) { toast('Arduino responde', 'La conexión por USB funciona.', 'info'); return; }
  if (!Number.isFinite(c.luz) || !Number.isFinite(c.agua)) return;
  Monitor.crudo = c;
  if (typeof c.alarma === 'number') Monitor.alarma = c.alarma === 1;
  nuevaLectura(convertir(c), 'arduino');
}

async function conectarArduino() {
  if (!soportaSerial()) {
    toast('Navegador sin Web Serial', 'Abre CampusCare en Google Chrome o Microsoft Edge en la computadora.', 'error');
    return;
  }
  try {
    const puerto = await navigator.serial.requestPort();
    await puerto.open({ baudRate: 9600 });
    Monitor.puerto = puerto;
    Monitor.modo = 'arduino';
    Monitor.escritor = puerto.writable?.getWriter() || null;
    repintarBarra();
    toast('Arduino conectado', 'Ya se están leyendo los sensores.');
    leerPuerto(puerto);
  } catch (e) {
    if (e?.name === 'NotFoundError') return; // la persona cerró la ventana sin elegir puerto
    toast('No se pudo abrir el puerto', `${e?.message || e}. Cierra el Monitor Serie del Arduino IDE si está abierto.`, 'error');
  }
}
async function leerPuerto(puerto) {
  const decodificador = new TextDecoder();
  let resto = '';
  while (puerto.readable && Monitor.puerto === puerto) {
    const lector = puerto.readable.getReader();
    Monitor.lector = lector;
    try {
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        resto += decodificador.decode(value, { stream: true });
        const lineas = resto.split('\n');
        resto = lineas.pop();
        lineas.forEach(procesarLinea);
      }
    } catch { /* el cable se desconectó */ } finally { lector.releaseLock(); }
    if (Monitor.modo !== 'arduino') break;
  }
}
async function desconectarArduino(aviso = true) {
  const p = Monitor.puerto;
  Monitor.modo = 'ninguno';
  Monitor.puerto = null;
  try { await Monitor.lector?.cancel(); } catch { /* ya cerrado */ }
  try { Monitor.escritor?.releaseLock(); } catch { /* ya liberado */ }
  try { await p?.close(); } catch { /* ya cerrado */ }
  Monitor.lector = Monitor.escritor = null;
  repintarBarra();
  if (aviso) toast('Arduino desconectado', 'Puedes volver a conectarlo cuando quieras.', 'info');
}
async function mandarComando(letra) {
  if (!Monitor.escritor) return;
  try { await Monitor.escritor.write(new TextEncoder().encode(letra)); } catch { toast('No se pudo enviar al Arduino', 'Revisa la conexión USB.', 'error'); }
}
if ('serial' in navigator) {
  navigator.serial.addEventListener('disconnect', e => {
    if (Monitor.puerto && e.target === Monitor.puerto) desconectarArduino(false).then(() => toast('Se desconectó el Arduino', 'Revisa el cable USB.', 'error'));
  });
}

/* Lecturas que llegan de otro dispositivo (tiempo real) */
function aplicarRemoto(u, enLinea = true) {
  Monitor.lectura = { luz: u.luz, fuego: u.fuego, flama: u.flama, agua: u.agua };
  Monitor.confirmados = u.estados;
  Monitor.ultimoDato = u.at;
  Monitor.enLinea = enLinea;
  const antes = Monitor.fuenteRemota;
  Monitor.fuenteRemota = `${u.fuente === 'demo' ? 'demostración de ' : ''}${u.usuario}`;
  guardarHistoria();
  if (state.vista === 'sensores') { if (antes !== Monitor.fuenteRemota || !$('#monBarra .is-on')) repintarBarra(); programarPintado(); }
}

const _conectarEventosMon = conectarEventos;
conectarEventos = function () {
  _conectarEventosMon();
  fuenteEventos?.addEventListener('sensores', ev => {
    let d;
    try { d = JSON.parse(ev.data); } catch { return; }
    if (Monitor.modo === 'ninguno' && d.ultimo) aplicarRemoto(d.ultimo, true);
    if (d.eventos?.length) {
      Monitor.eventos = [...d.eventos.map(e => ({ ...e, usuario: d.ultimo?.usuario })), ...(Monitor.eventos || [])].slice(0, 40);
      if (state.vista === 'sensores') { const el = $('#monEventos'); if (el) el.innerHTML = eventosHTML(); }
      for (const e of d.eventos) {
        const malo = ['fuego', 'apagada', 'bajo', 'desbordamiento'].includes(e.estado);
        // Quien no recibe la notificación del reporte (alumnos) ve la alerta de fuego en pantalla
        if (e.estado === 'fuego' && Auth.sesion()?.role === 'solicitante') {
          mostrarAlerta({ title: 'Alerta crítica: fuego detectado', body: `${e.mensaje} — Lab. de Cómputo 1`, ticketId: e.folio });
        } else if (!(e.severidad === 'Crítica' && Auth.sesion()?.role !== 'solicitante')) {
          toast(e.mensaje, `${e.folio ? `Reporte ${e.folio}. ` : ''}Sensor de ${e.sensor === 'flama' ? 'flama' : e.sensor === 'agua' ? 'la cisterna' : 'luz'}.`, malo ? 'error' : 'info');
        }
      }
    }
  });
};

/* =========================================================
   ACCIONES
   ========================================================= */
ACCIONES['mon-conectar'] = () => conectarArduino();
ACCIONES['mon-desconectar'] = () => desconectarArduino();
ACCIONES['mon-alarma'] = () => { Monitor.alarma = !Monitor.alarma; mandarComando(Monitor.alarma ? 'A' : 'S'); repintarBarra(); };
ACCIONES['mon-probar'] = () => mandarComando('T');
ACCIONES['mon-demo'] = () => {
  Monitor.modo = Monitor.modo === 'demo' ? 'ninguno' : 'demo';
  if (Monitor.modo === 'demo') { Monitor.ultimoDato = Date.now(); nuevaLectura({ ...Monitor.lectura }, 'demo'); }
  repintarBarra();
};
ACCIONES['mon-fuego'] = () => {
  if (Monitor.modo !== 'demo') return;
  const f = !Monitor.lectura.fuego;
  nuevaLectura({ ...Monitor.lectura, fuego: f, flama: f ? 88 : 2 }, 'demo');
};
ACCIONES['mon-cal'] = (id, el) => {
  if (!Monitor.crudo) return toast('Sin lectura', 'Espera a que llegue un dato del Arduino.', 'error');
  Monitor.cal[el.dataset.k] = Monitor.crudo[el.dataset.v];
  guardarCalibracion();
};
ACCIONES['mon-cal-reset'] = () => { Monitor.cal = { ...CAL_DEFECTO }; guardarCalibracion(); };
function guardarCalibracion() {
  try { localStorage.setItem('campuscare_calibracion', JSON.stringify(Monitor.cal)); } catch { /* sin almacenamiento */ }
  const cal = $('#monCal');
  if (cal) cal.innerHTML = calibracionHTML();
  if (Monitor.crudo) nuevaLectura(convertir(Monitor.crudo), 'arduino');
  toast('Calibración guardada', 'Se aplica a las siguientes lecturas.', 'info');
}
document.addEventListener('input', e => {
  const k = e.target.dataset?.demo;
  if (k && Monitor.modo === 'demo') nuevaLectura({ ...Monitor.lectura, [k]: Number(e.target.value) }, 'demo');
  if (e.target.matches('[data-umbral]')) {
    Monitor.cal.umbralFlama = Number(e.target.value);
    $('#umbralTxt').textContent = e.target.value;
    try { localStorage.setItem('campuscare_calibracion', JSON.stringify(Monitor.cal)); } catch { /* sin almacenamiento */ }
  }
});

/* Al cerrar sesión se suelta el Arduino */
const _cerrarSesionMon = cerrarSesion;
cerrarSesion = function (expirada = false) {
  if (Monitor.modo === 'arduino') desconectarArduino(false);
  Monitor.modo = 'ninguno';
  Monitor.eventos = null;
  _cerrarSesionMon(expirada);
};
