/* =========================================================
   Auditoría de red Wi-Fi · Semáforo de aptitud académica
   y modo "zona muerta"
   Aportación de Carlos Manuel Ojeda Hernández
   ---------------------------------------------------------
   Motor sin dependencias (network-audit.js original):
     · 3 pings HEAD sin caché → latencia promedio, jitter
       (máx − mín) y pérdida (fallos / 3)
     · descarga de un bloque de prueba → Mbps reales
     · tipo de conexión con navigator.connection
   Semáforo: videollamadas, Git/SSH/Cloud y descarga de SDKs.
   Si la red está degradada (latencia > 200 ms, < 2 Mbps o
   pérdida) o no hay señal (zona muerta), se escala a un
   ticket de Red/TI con la telemetría adjunta. Sin conexión
   la medición entra a la cola y se envía al volver la red.
   ========================================================= */
'use strict';

const Red = {
  midiendo: false,
  resultado: null,
  ubic: { edificio: '', nivel: '', espacio: '' },
  historial: null,
  resumen: []
};

/* ---------- Motor de medición ---------- */
function evaluarAptitud({ latencia_ms: lat, jitter_ms: jit, perdida_pct: per, velocidad_mbps: vel }) {
  let videollamadas = { nivel: 'optimo', etiqueta: 'Apto' };
  if (per > 0 || lat > 250 || jit > 60 || vel < 1.5) videollamadas = { nivel: 'critico', etiqueta: 'No viable' };
  else if (lat > 120 || jit > 30 || vel < 4) videollamadas = { nivel: 'inestable', etiqueta: 'Inestable' };
  let git = { nivel: 'optimo', etiqueta: 'Fluido' };
  if (per > 0 || lat > 300 || vel < 0.8) git = { nivel: 'critico', etiqueta: 'Crítico' };
  else if (lat > 150 || jit > 40) git = { nivel: 'inestable', etiqueta: 'Lento' };
  let descargas = { nivel: 'optimo', etiqueta: 'Óptimo' };
  if (vel < 2) descargas = { nivel: 'critico', etiqueta: 'Muy lento' };
  else if (vel < 10) descargas = { nivel: 'inestable', etiqueta: 'Limitado' };
  return { videollamadas, git, descargas };
}
function resultadoSinRed() {
  const sinRed = { nivel: 'critico', etiqueta: 'Sin red' };
  return {
    offline: true, latencia_ms: 0, jitter_ms: 0, perdida_pct: 100, velocidad_mbps: 0, tipo_conexion: 'sin conexión',
    esDegradada: true, aptitud: { videollamadas: sinRed, git: sinRed, descargas: sinRed }, medido_en: new Date().toISOString()
  };
}
async function medirRed() {
  if (!navigator.onLine) return resultadoSinRed();
  const conexion = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const tipo_conexion = conexion?.effectiveType || conexion?.type || 'wifi';
  const pings = [];
  let fallos = 0;
  for (let i = 0; i < 3; i++) {
    const inicio = performance.now();
    try {
      const r = await fetch(`${API_ORIGEN}/api/red/ping?nocache=ping_${Date.now()}_${i}`, { method: 'HEAD', cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP');
      pings.push(performance.now() - inicio);
    } catch { fallos++; }
  }
  if (!pings.length) return resultadoSinRed();
  const latencia_ms = Math.round(promedio(pings));
  const jitter_ms = pings.length > 1 ? Math.round(Math.max(...pings) - Math.min(...pings)) : 0;
  const perdida_pct = Math.round(fallos / 3 * 100);
  let velocidad_mbps = 0;
  try {
    const inicio = performance.now();
    const r = await fetch(`${API_ORIGEN}/api/red/prueba?nocache=dl_${Date.now()}`, { cache: 'no-store' });
    const blob = await r.blob();
    const seg = Math.max((performance.now() - inicio) / 1000, 0.001);
    velocidad_mbps = Number(((blob.size * 8) / (seg * 1024 * 1024)).toFixed(2));
  } catch { velocidad_mbps = 0; }
  const m = { latencia_ms, jitter_ms, perdida_pct, velocidad_mbps };
  return {
    offline: false, ...m, tipo_conexion, aptitud: evaluarAptitud(m),
    esDegradada: latencia_ms > 200 || velocidad_mbps < 2 || perdida_pct > 0, medido_en: new Date().toISOString()
  };
}

/* ---------- Vista ---------- */
const NIVEL_TXT = { optimo: 'Verde', inestable: 'Ámbar', critico: 'Rojo' };
const semaforo = a => `<span class="semaforo sem-${a.nivel}" title="${NIVEL_TXT[a.nivel]}"><i></i>${esc(a.etiqueta)}</span>`;

function ubicacionRedHTML() {
  const u = Red.ubic;
  const ed = edificio(u.edificio);
  const niv = ed?.niveles.find(n => n.id === u.nivel);
  return `
    ${selectCampo('edificio', 'Edificio', 'building', CATALOGO.map(e => [e.id, e.nombre]), u.edificio)}
    ${selectCampo('nivel', 'Nivel', 'layers', ed ? ed.niveles.map(n => [n.id, n.nombre]) : [], u.nivel, !ed)}
    ${selectCampo('espacio', 'Espacio / Aula', 'door', niv ? niv.espacios.map(x => [x, x]) : [], u.espacio, !niv)}`;
}

function resultadoHTML() {
  const r = Red.resultado;
  if (Red.midiendo) return `<div class="red-midiendo"><span class="red-onda"></span><strong>Midiendo la red…</strong><p class="small muted">3 pings sin caché y una descarga de prueba de 256 KB.</p></div>`;
  if (!r) return vacio('Aún no hay medición', 'Colócate en el aula, laboratorio o pasillo que quieras evaluar y pulsa "Iniciar diagnóstico".', 'gauge');
  const metrica = (t, v, u) => `<div class="red-metrica"><small>${t}</small><strong>${v}<span>${u}</span></strong></div>`;
  return `
    ${r.offline ? `<div class="zona-muerta">${icon('wifiOff')}<div><strong>Zona muerta detectada</strong><p class="small">No hay conexión en este punto. Puedes reportarla: se guardará en el dispositivo y se enviará a Red/TI cuando vuelva la señal.</p></div></div>` : ''}
    <div class="red-metricas">
      ${metrica('Latencia (ping)', r.offline ? '—' : r.latencia_ms, ' ms')}
      ${metrica('Jitter', r.offline ? '—' : r.jitter_ms, ' ms')}
      ${metrica('Velocidad', r.offline ? '—' : r.velocidad_mbps, ' Mbps')}
      ${metrica('Pérdida', r.perdida_pct, ' %')}
    </div>
    <p class="tiny muted">Conexión: <b>${esc(r.tipo_conexion)}</b> · ${fmtFecha(new Date(r.medido_en).getTime())}</p>
    <div class="red-semaforo">
      <h4>Semáforo de aptitud académica</h4>
      <div class="sem-fila"><span>${icon('users')} Videollamadas y clases en línea</span>${semaforo(r.aptitud.videollamadas)}</div>
      <div class="sem-fila"><span>${icon('terminal')} Git, SSH y entornos en la nube</span>${semaforo(r.aptitud.git)}</div>
      <div class="sem-fila"><span>${icon('download')} Descarga de SDKs y paquetes</span>${semaforo(r.aptitud.descargas)}</div>
    </div>
    <form class="red-guardar ${r.esDegradada ? 'is-mala' : ''}" data-form="red" novalidate>
      <h4>${r.esDegradada ? `${icon('alert')} ${r.offline ? 'Reportar zona muerta a Red/TI' : 'Red degradada: escala el problema a Red/TI'}` : `${icon('checkCircle')} La red está en buen estado`}</h4>
      <p class="small muted">${r.esDegradada ? 'Se genera un ticket de la categoría Red/TI con la telemetría adjunta. Aparecerá en el mapa de calor del edificio.' : 'Guarda la medición para el historial de cobertura del campus.'}</p>
      <div class="field-grid red-ubic">${ubicacionRedHTML()}</div>
      <div class="alert alert-error" hidden></div>
      <div class="btn-row">
        ${r.esDegradada ? `<button type="submit" class="btn btn-primary" data-escalar="1">${icon('send')} Generar ticket Red/TI</button>` : ''}
        <button type="submit" class="btn ${r.esDegradada ? 'btn-ghost' : 'btn-primary'}" data-escalar="0">${icon('database')} Guardar solo la medición</button>
      </div>
    </form>`;
}

function historialRedHTML(s) {
  const pendientes = PWA.pendientes.filter(p => p.tipo === 'auditoria');
  if (!Red.historial) return `<p class="muted small">Cargando historial…</p>`;
  const filas = [
    ...pendientes.map(p => ({ pendiente: true, at: p.creado, ubicacion: p.datos.ubicacion || 'Ubicación por definir', sinConexion: !!p.datos.sin_conexion, latencia: p.datos.latencia_ms, velocidad: p.datos.velocidad_mbps, aptitud: p.aptitud, usuario: s.name })),
    ...Red.historial
  ];
  if (!filas.length) return vacio('Sin mediciones todavía', 'Tus diagnósticos guardados aparecerán aquí.', 'wifi');
  return `<div class="table-wrap"><table class="table red-tabla">
    <thead><tr><th>Fecha</th><th>Ubicación</th><th>Latencia</th><th>Velocidad</th><th>Videollamadas</th><th>Git / Cloud</th><th>Descargas</th><th>Ticket</th>${s.role === 'admin' ? '<th>Midió</th>' : ''}</tr></thead>
    <tbody>${filas.map(m => `<tr class="${m.pendiente ? 'is-pend' : ''}">
      <td data-label="Fecha">${fmtFecha(m.at)}${m.pendiente ? ' <span class="origen origen-local">Pendiente</span>' : ''}</td>
      <td data-label="Ubicación"><div>${esc(m.ubicacion)}</div></td>
      <td data-label="Latencia">${m.sinConexion ? '<b class="sem-txt-critico">Zona muerta</b>' : `${m.latencia ?? '—'} ms`}</td>
      <td data-label="Velocidad">${m.sinConexion ? '—' : `${m.velocidad ?? '—'} Mbps`}</td>
      <td data-label="Videollamadas">${m.aptitud ? semaforo(m.aptitud.videollamadas) : '—'}</td>
      <td data-label="Git / Cloud">${m.aptitud ? semaforo(m.aptitud.git) : '—'}</td>
      <td data-label="Descargas">${m.aptitud ? semaforo(m.aptitud.descargas) : '—'}</td>
      <td data-label="Ticket">${m.folio ? `<button class="link" data-action="ver-red-ticket" data-id="${esc(m.folio)}">${esc(m.folio)}</button>` : '—'}</td>
      ${s.role === 'admin' ? `<td data-label="Midió">${esc(m.usuario || '')}</td>` : ''}
    </tr>`).join('')}</tbody></table></div>`;
}

function resumenRedHTML() {
  if (!Red.resumen.length) return '';
  return `<section class="card">
    <div class="card-head"><h3>Cobertura por edificio</h3><span class="muted small">Promedios de todas las mediciones</span></div>
    <div class="red-edificios">${Red.resumen.map(r => `
      <article class="red-edificio ${r.zonas_muertas ? 'tiene-muertas' : ''}">
        <strong>Edificio ${esc(r.edificio)}</strong>
        <span>${r.mediciones} medición${r.mediciones === 1 ? '' : 'es'}</span>
        <span>${r.latencia ?? '—'} ms · ${r.velocidad ?? '—'} Mbps</span>
        <span class="${r.degradadas ? 'sem-txt-inestable' : ''}">${r.degradadas} degradada${r.degradadas === 1 ? '' : 's'}</span>
        ${r.zonas_muertas ? `<span class="sem-txt-critico">${r.zonas_muertas} zona${r.zonas_muertas === 1 ? '' : 's'} muerta${r.zonas_muertas === 1 ? '' : 's'}</span>` : ''}
      </article>`).join('')}</div>
  </section>`;
}

RENDER.red = s => `
  <section class="hero-banner hero-sm" style="--bg:url('img/cat-red.jpg')">
    <div class="hero-banner-content">
      <span class="pill pill-glass">${icon('wifi')} Auditoría de red Wi-Fi</span>
      <h2>¿La red de este lugar sirve para tu clase?</h2>
      <p>Mide la conexión donde estás y tradúcela a un semáforo: videollamadas, Git y la nube, y descarga de paquetes.</p>
      <div class="btn-row"><button class="btn btn-light" data-action="red-medir" ${Red.midiendo ? 'disabled' : ''}>${icon('gauge')} ${Red.resultado ? 'Repetir diagnóstico' : 'Iniciar diagnóstico'}</button></div>
    </div>
  </section>
  <div class="grid-2 red-grid">
    <section class="card" id="redResultado">${resultadoHTML()}</section>
    <section class="card red-info">
      <div class="card-head"><h3>Cómo se mide</h3><span class="muted small">Sin librerías externas</span></div>
      <ol class="sc-pasos">
        <li><span class="step-n">1</span><div><strong>Latencia, jitter y pérdida</strong><p class="small muted">Tres pings HEAD al servidor sin caché: promedio, diferencia entre el más lento y el más rápido, y cuántos fallaron.</p></div></li>
        <li><span class="step-n">2</span><div><strong>Velocidad real</strong><p class="small muted">Descarga un bloque de 256 KB y calcula los Mbps con su tamaño exacto.</p></div></li>
        <li><span class="step-n">3</span><div><strong>Semáforo académico</strong><p class="small muted">Verde, ámbar o rojo según lo que necesita cada actividad. El servidor vuelve a calcularlo al guardar.</p></div></li>
        <li><span class="step-n">4</span><div><strong>Zona muerta</strong><p class="small muted">Sin señal, el reporte se guarda en el teléfono y se envía solo cuando vuelve la conexión.</p></div></li>
      </ol>
    </section>
  </div>
  ${s.role === 'admin' ? resumenRedHTML() : ''}
  <section class="card">
    <div class="card-head"><h3>${s.role === 'admin' ? 'Historial de mediciones del campus' : 'Mis mediciones'}</h3><button class="btn btn-ghost btn-sm" data-action="red-recargar">${icon('refresh')} Actualizar</button></div>
    <div id="redHistorial">${historialRedHTML(s)}</div>
  </section>`;

async function cargarHistorialRed() {
  try {
    const r = await api('/red/auditorias');
    Red.historial = r.mediciones;
    Red.resumen = r.resumen;
  } catch { Red.historial ??= []; }
  const s = Auth.sesion();
  if (state.vista === 'red' && s) {
    const caja = $('#redHistorial');
    if (caja) caja.innerHTML = historialRedHTML(s);
    if (s.role === 'admin' && Red.resumen.length && !$('.red-edificios')) $('.red-grid')?.insertAdjacentHTML('afterend', resumenRedHTML());
  }
}
POST_RENDER.red = () => { cargarHistorialRed(); };

function pintarResultado() {
  const caja = $('#redResultado');
  if (caja) caja.innerHTML = resultadoHTML();
  const boton = $('[data-action="red-medir"]');
  if (boton) { boton.disabled = Red.midiendo; boton.innerHTML = `${icon('gauge')} ${Red.midiendo ? 'Midiendo…' : Red.resultado ? 'Repetir diagnóstico' : 'Iniciar diagnóstico'}`; }
}

ACCIONES['red-medir'] = async () => {
  if (Red.midiendo) return;
  Red.midiendo = true;
  pintarResultado();
  try { Red.resultado = await medirRed(); }
  finally { Red.midiendo = false; }
  pintarResultado();
  if (Red.resultado.esDegradada) vibrar([120, 60, 120]);
};
ACCIONES['red-recargar'] = () => cargarHistorialRed();
ACCIONES['ver-red-ticket'] = id => {
  if (DB.ticket(id)) abrirDetalle(id);
  else window.open(`/reporte/${encodeURIComponent(id)}`, '_blank', 'noopener');
};

document.addEventListener('change', e => {
  const el = e.target;
  if (!el.closest('[data-form="red"]')) return;
  const u = Red.ubic;
  if (el.name === 'edificio') { u.edificio = el.value; u.nivel = u.espacio = ''; }
  else if (el.name === 'nivel') { u.nivel = el.value; u.espacio = ''; }
  else if (el.name === 'espacio') { u.espacio = el.value; return; }
  $('.red-ubic').innerHTML = ubicacionRedHTML();
});

/* Tarjeta de métricas que se adjunta como imagen al ticket de Red/TI */
function tarjetaMetricas(r, ubicacion) {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 506;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 900, 506);
  g.addColorStop(0, '#022c22'); g.addColorStop(1, '#047857');
  x.fillStyle = g; x.fillRect(0, 0, 900, 506);
  const F = "'Plus Jakarta Sans', system-ui, sans-serif";
  x.fillStyle = '#a7f3d0'; x.font = `800 30px ${F}`; x.fillText('CampusCare · Auditoría Wi-Fi', 40, 62);
  x.fillStyle = '#ecfdf5'; x.font = `500 20px ${F}`; x.fillText(ubicacion.slice(0, 60), 40, 96);
  if (r.offline) {
    x.fillStyle = '#fecaca'; x.font = `800 54px ${F}`; x.fillText('ZONA MUERTA', 40, 210);
    x.fillStyle = '#ecfdf5'; x.font = `500 24px ${F}`; x.fillText('Sin conexión a la red institucional en este punto.', 40, 256);
  } else {
    [['Latencia', `${r.latencia_ms} ms`], ['Jitter', `${r.jitter_ms} ms`], ['Velocidad', `${r.velocidad_mbps} Mbps`], ['Pérdida', `${r.perdida_pct} %`]].forEach(([t, v], i) => {
      const px = 40 + i * 210;
      x.fillStyle = 'rgba(255,255,255,.1)'; x.fillRect(px, 130, 190, 110);
      x.fillStyle = '#6ee7b7'; x.font = `600 18px ${F}`; x.fillText(t, px + 16, 162);
      x.fillStyle = '#fff'; x.font = `800 30px ${F}`; x.fillText(v, px + 16, 210);
    });
  }
  const colores = { optimo: '#10b981', inestable: '#f59e0b', critico: '#ef4444' };
  [['Videollamadas', r.aptitud.videollamadas], ['Git / SSH / Cloud', r.aptitud.git], ['Descarga de SDKs', r.aptitud.descargas]].forEach(([t, a], i) => {
    const py = 300 + i * 56;
    x.fillStyle = colores[a.nivel]; x.beginPath(); x.arc(56, py, 14, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#ecfdf5'; x.font = `600 22px ${F}`; x.fillText(t, 84, py + 8);
    x.fillStyle = '#fff'; x.font = `800 22px ${F}`; x.fillText(a.etiqueta, 420, py + 8);
  });
  x.fillStyle = '#6ee7b7'; x.font = `500 16px ${F}`;
  x.fillText(`Conexión: ${r.tipo_conexion} · ${new Date(r.medido_en).toLocaleString('es-MX')}`, 40, 484);
  return c.toDataURL('image/jpeg', 0.85);
}

FORMULARIOS.red = async (form, e) => {
  const r = Red.resultado;
  if (!r) throw new Error('Primero realiza un diagnóstico.');
  const escalar = (e?.submitter || document.activeElement)?.dataset?.escalar === '1';
  const u = Red.ubic;
  if (escalar && (!u.edificio || !u.nivel || !u.espacio)) throw new Error('Selecciona el edificio, nivel y espacio para generar el ticket de Red/TI.');
  const ubicacion = u.espacio ? `Edif. ${u.edificio} · ${u.nivel} · ${u.espacio}` : 'Zona Wi-Fi sin especificar';
  const datos = {
    latencia_ms: r.latencia_ms, jitter_ms: r.jitter_ms, perdida_pct: r.perdida_pct, velocidad_mbps: r.velocidad_mbps,
    tipo_conexion: r.tipo_conexion, sin_conexion: r.offline, medido_en: r.medido_en,
    edificio: u.edificio, nivel: u.nivel, espacio: u.espacio, ubicacion, escalar, clienteId: nuevoId(),
    ...(escalar ? { foto: tarjetaMetricas(r, ubicacion) } : {})
  };
  const encolar = () => encolarOperacion({
    clienteId: datos.clienteId, tipo: 'auditoria', metodo: 'POST', ruta: '/red/auditorias', datos, aptitud: r.aptitud,
    etiqueta: `${r.offline ? 'Zona muerta' : 'Auditoría Wi-Fi'} · ${ubicacion}${escalar ? ' (ticket Red/TI)' : ''}`
  });
  if (!navigator.onLine) {
    await encolar();
    toast(r.offline ? 'Zona muerta guardada en el dispositivo' : 'Medición guardada sin conexión', 'Se enviará automáticamente al recuperar la señal.', 'info');
  } else {
    try {
      const res = await api('/red/auditorias', { method: 'POST', body: datos });
      if (res.folio) {
        toast('Ticket enviado a Red/TI', `Folio ${res.folio} con la telemetría adjunta. Ya aparece en el mapa de calor.`);
        sincronizar().catch(() => {});
      } else toast('Medición guardada', 'Se agregó al historial de cobertura del campus.');
    } catch (err) {
      if (!esErrorDeRed(err)) throw err;
      await encolar();
      toast('Conexión interrumpida', 'La medición quedó en la cola y se enviará sola.', 'info');
    }
  }
  Red.resultado = null;
  pintarResultado();
  cargarHistorialRed();
};
