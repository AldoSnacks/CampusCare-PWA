/* =========================================================
   Reporte visual con orden de trabajo
   Aportación de Roger Alexis Atenco Guerrero
   ---------------------------------------------------------
   Quien reporta señala la falla dibujando sobre la foto
   (flecha, círculo, lápiz y nota de hasta 40 caracteres) en
   rojo, ámbar o blanco, con deshacer y limpiar. La aplicación
   genera una orden de trabajo (imagen PNG de 1000 px) con
   folio, ubicación, fecha, categoría, severidad, descripción
   y la evidencia anotada. Al enviarla al sistema se guarda
   como ticket normal (origen "reporte_visual"), recibe folio,
   entra al flujo de estados y aparece en el mapa de calor.
   ========================================================= */
'use strict';

const VIS_COLORES = { rojo: '#e5372b', ambar: '#f2b84b', blanco: '#ffffff' };
const VIS_SEVERIDAD = { 'Crítica': '#dc2626', 'Media': '#d97706', 'Baja': '#059669' };
const VIS_EJEMPLO = 'img/aula-ejemplo.jpg';
const VIS_FUENTE = "'Plus Jakarta Sans', system-ui, sans-serif";

const Visual = {
  imagen: null,
  trazos: [],
  borrador: null,
  herramienta: 'flecha',
  color: VIS_COLORES.rojo,
  nota: '',
  datos: { edificio: '', nivel: '', espacio: '', activo: '', categoria: '', severidad: '', descripcion: '' },
  orden: null,      // datos de la última orden generada
  ultimoFolio: null
};

/* ---------- Dibujo sobre la foto ---------- */
const lienzo = () => $('#lienzoVisual');
const grosor = c => Math.max(3, c.width / 170);

function dibujarTrazo(ctx, c, t) {
  ctx.save();
  ctx.strokeStyle = t.color; ctx.fillStyle = t.color;
  ctx.lineWidth = grosor(c); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (t.tipo === 'lapiz') {
    ctx.beginPath(); t.puntos.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  } else if (t.tipo === 'flecha') {
    const [x1, y1] = t.desde, [x2, y2] = t.hasta, a = Math.atan2(y2 - y1, x2 - x1), h = grosor(c) * 5;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - h * Math.cos(a - 0.45), y2 - h * Math.sin(a - 0.45));
    ctx.lineTo(x2 - h * Math.cos(a + 0.45), y2 - h * Math.sin(a + 0.45));
    ctx.closePath(); ctx.fill();
  } else if (t.tipo === 'circulo') {
    const cx = (t.desde[0] + t.hasta[0]) / 2, cy = (t.desde[1] + t.hasta[1]) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(t.hasta[0] - t.desde[0]) / 2 || 1, Math.abs(t.hasta[1] - t.desde[1]) / 2 || 1, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (t.tipo === 'texto') {
    const tam = Math.max(16, c.width / 38);
    ctx.font = `700 ${tam}px ${VIS_FUENTE}`; ctx.textBaseline = 'middle';
    const w = ctx.measureText(t.texto).width, pad = tam * 0.45, alto = tam * 1.6;
    const x = Math.min(Math.max(t.x, 4), c.width - w - pad * 2 - 4), y = Math.min(Math.max(t.y, alto / 2 + 4), c.height - alto / 2 - 4);
    ctx.fillStyle = 'rgba(2, 44, 34, .88)'; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y - alto / 2, w + pad * 2, alto, 8); else ctx.rect(x, y - alto / 2, w + pad * 2, alto);
    ctx.fill();
    ctx.strokeStyle = t.color; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = t.color; ctx.fillText(t.texto, x + pad, y);
  }
  ctx.restore();
}

function redibujar() {
  const c = lienzo();
  if (!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (!Visual.imagen) {
    const g = ctx.createLinearGradient(0, 0, c.width, c.height);
    g.addColorStop(0, '#022c22'); g.addColorStop(1, '#047857');
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#d1fae5'; ctx.font = `700 30px ${VIS_FUENTE}`;
    ctx.fillText('Toma o sube una foto, o usa la de ejemplo', c.width / 2, c.height / 2 - 10);
    ctx.fillStyle = '#6ee7b7'; ctx.font = `500 22px ${VIS_FUENTE}`;
    ctx.fillText('Después señala la falla dibujando sobre ella', c.width / 2, c.height / 2 + 30);
    ctx.textAlign = 'start';
  } else {
    ctx.drawImage(Visual.imagen, 0, 0, c.width, c.height);
  }
  Visual.trazos.forEach(t => dibujarTrazo(ctx, c, t));
  if (Visual.borrador) dibujarTrazo(ctx, c, Visual.borrador);
  const sinTrazos = !Visual.trazos.length;
  $$('[data-action="vis-deshacer"], [data-action="vis-limpiar"]').forEach(b => { b.disabled = sinTrazos; });
  const n = $('#visConteo');
  if (n) n.textContent = Visual.trazos.length ? `${Visual.trazos.length} marca${Visual.trazos.length === 1 ? '' : 's'}` : 'Sin marcas';
}

function ajustarLienzo() {
  const c = lienzo();
  if (!c) return;
  if (Visual.imagen) {
    const w = Math.min(Visual.imagen.naturalWidth, 1000);
    c.width = w;
    c.height = Math.round(w * (Visual.imagen.naturalHeight / Visual.imagen.naturalWidth));
  } else { c.width = 1000; c.height = 560; }
  redibujar();
}

function estadoVisual(texto, error = false) {
  const el = $('#visEstado');
  if (!el) return;
  el.textContent = texto;
  el.classList.toggle('is-error', error);
}

function cargarImagen(src) {
  const img = new Image();
  img.onload = () => {
    Visual.imagen = img; Visual.trazos = []; Visual.borrador = null;
    invalidarOrden();
    ajustarLienzo();
    estadoVisual('Foto cargada. Elige una herramienta y señala la falla.');
  };
  img.onerror = () => estadoVisual('No se pudo abrir esa imagen.', true);
  img.src = src;
}

function posicion(e) {
  const c = lienzo(), r = c.getBoundingClientRect();
  return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)];
}

function conectarLienzo() {
  const c = lienzo();
  if (!c || c.dataset.listo) return;
  c.dataset.listo = '1';
  c.addEventListener('pointerdown', e => {
    if (!Visual.imagen) { estadoVisual('Primero toma o sube una foto, o usa la de ejemplo.', true); return; }
    const p = posicion(e);
    if (Visual.herramienta === 'texto') {
      const texto = ($('#visNota')?.value || '').trim();
      if (!texto) { estadoVisual('Escribe el texto de la nota y vuelve a tocar la foto.', true); $('#visNota')?.focus(); return; }
      Visual.trazos.push({ tipo: 'texto', texto, x: p[0], y: p[1], color: Visual.color });
      invalidarOrden(); estadoVisual(''); redibujar();
      return;
    }
    c.setPointerCapture(e.pointerId);
    Visual.borrador = Visual.herramienta === 'lapiz'
      ? { tipo: 'lapiz', color: Visual.color, puntos: [p] }
      : { tipo: Visual.herramienta, color: Visual.color, desde: p, hasta: p };
    estadoVisual('');
  });
  c.addEventListener('pointermove', e => {
    if (!Visual.borrador) return;
    const p = posicion(e);
    if (Visual.borrador.tipo === 'lapiz') Visual.borrador.puntos.push(p); else Visual.borrador.hasta = p;
    redibujar();
  });
  const terminar = () => {
    const b = Visual.borrador;
    if (!b) return;
    const valido = b.tipo === 'lapiz' ? b.puntos.length > 3 : Math.hypot(b.hasta[0] - b.desde[0], b.hasta[1] - b.desde[1]) > 8;
    if (valido) { Visual.trazos.push(b); invalidarOrden(); }
    Visual.borrador = null;
    redibujar();
  };
  c.addEventListener('pointerup', terminar);
  c.addEventListener('pointercancel', () => { Visual.borrador = null; redibujar(); });
}

/* ---------- Vista ---------- */
function ubicacionVisualHTML() {
  const d = Visual.datos;
  const ed = edificio(d.edificio);
  const niv = ed?.niveles.find(n => n.id === d.nivel);
  return `
    ${selectCampo('edificio', 'Edificio', 'building', CATALOGO.map(e => [e.id, e.nombre]), d.edificio)}
    ${selectCampo('nivel', 'Nivel', 'layers', ed ? ed.niveles.map(n => [n.id, n.nombre]) : [], d.nivel, !ed)}
    ${selectCampo('espacio', 'Espacio / Aula', 'door', niv ? niv.espacios.map(x => [x, x]) : [], d.espacio, !niv)}
    ${selectCampo('activo', 'Activo afectado', 'box', d.espacio ? activosPara(d.espacio).map(x => [x, x]) : [], d.activo, !d.espacio)}`;
}

RENDER['reporte-visual'] = () => {
  const d = Visual.datos;
  const herramienta = (h, ic, txt) => `<button type="button" class="vis-tool ${Visual.herramienta === h ? 'is-on' : ''}" data-action="vis-herramienta" data-h="${h}" aria-pressed="${Visual.herramienta === h}">${icon(ic)}<span>${txt}</span></button>`;
  const color = (k, txt) => `<button type="button" class="vis-color ${Visual.color === VIS_COLORES[k] ? 'is-on' : ''}" data-action="vis-color" data-c="${k}" style="--c:${VIS_COLORES[k]}" aria-label="Color ${txt}" title="${txt}"></button>`;
  return `
  <div class="visual-layout">
    <section class="card visual-card">
      <div class="step-head"><span class="step-n">1</span><div><h3>Señala la falla sobre la foto</h3><p class="muted small">Dibuja con el dedo o el ratón. La foto anotada se guarda como evidencia del reporte.</p></div></div>
      <div class="vis-barra">
        <div class="vis-grupo" role="toolbar" aria-label="Herramientas">
          ${herramienta('flecha', 'arrowUpRight', 'Flecha')}${herramienta('circulo', 'circle', 'Círculo')}${herramienta('lapiz', 'pencil', 'Lápiz')}${herramienta('texto', 'note', 'Nota')}
        </div>
        <div class="vis-grupo" aria-label="Colores">${color('rojo', 'Rojo')}${color('ambar', 'Ámbar')}${color('blanco', 'Blanco')}</div>
        <div class="vis-grupo">
          <button type="button" class="vis-tool" data-action="vis-deshacer">${icon('undo')}<span>Deshacer</span></button>
          <button type="button" class="vis-tool" data-action="vis-limpiar">${icon('trash')}<span>Limpiar</span></button>
        </div>
      </div>
      <label class="field vis-nota" ${Visual.herramienta === 'texto' ? '' : 'hidden'}><span>Texto de la nota (toca la foto para colocarla)</span>
        <input type="text" id="visNota" maxlength="40" placeholder="Ej. Proyector sin imagen" value="${esc(Visual.nota)}"></label>
      <div class="vis-lienzo"><canvas id="lienzoVisual" width="1000" height="560" aria-label="Foto para anotar"></canvas><span class="vis-conteo" id="visConteo">Sin marcas</span></div>
      <div class="btn-row">
        <label class="btn btn-primary"><input type="file" accept="image/*" capture="environment" data-vis-foto hidden>${icon('camera')} Tomar o subir foto</label>
        <button type="button" class="btn btn-ghost" data-action="vis-ejemplo">${icon('image')} Usar foto de ejemplo</button>
      </div>
      <p class="small vis-estado" id="visEstado" aria-live="polite"></p>
    </section>

    <form class="card form-card vis-form" data-form="visual" novalidate>
      <div class="form-step">
        <div class="step-head"><span class="step-n">2</span><div><h3>Ubicación</h3><p class="muted small">Del catálogo del campus (así entra al mapa de calor).</p></div></div>
        <div class="field-grid vis-ubic">${ubicacionVisualHTML()}</div>
      </div>
      <div class="form-step">
        <div class="step-head"><span class="step-n">3</span><div><h3>Categoría y severidad</h3></div></div>
        ${selectCampo('categoria', 'Categoría', 'layers', Object.keys(CATEGORIAS).map(k => [k, k]), d.categoria)}
        <div class="chip-filters vis-sev">${Object.entries(SEVERIDADES).map(([k, v]) => `
          <label class="fchip ${d.severidad === k ? 'is-on' : ''}"><input type="radio" name="severidad" value="${k}" ${d.severidad === k ? 'checked' : ''} hidden>${k} · ${v.sla} h</label>`).join('')}</div>
      </div>
      <div class="form-step">
        <div class="step-head"><span class="step-n">4</span><div><h3>Descripción</h3></div></div>
        <label class="field"><textarea name="descripcion" rows="3" maxlength="500" placeholder="Qué ocurre y desde cuándo.">${esc(d.descripcion)}</textarea></label>
      </div>
      <div class="alert alert-error" hidden></div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-action="vis-generar">${icon('image')} Generar orden (borrador)</button>
        <button type="submit" class="btn btn-primary btn-lg">${icon('send')} Enviar al sistema</button>
      </div>
    </form>

    <section class="card vis-orden" id="visOrden" hidden>
      <div class="card-head"><h3>Orden de trabajo</h3>
        <div class="btn-row"><span class="small muted" id="visOrdenNota"></span>
          <a class="btn btn-ghost btn-sm" id="visDescargar" download="orden-de-trabajo.png">${icon('download')} Descargar PNG</a>
          <button type="button" class="btn btn-ghost btn-sm" data-action="vis-ver-ticket" id="visVerTicket" hidden>${icon('eye')} Ver ticket</button>
        </div>
      </div>
      <canvas id="ordenCanvas" class="orden-canvas"></canvas>
    </section>
  </div>`;
};

POST_RENDER['reporte-visual'] = () => {
  conectarLienzo();
  ajustarLienzo();
  if (Visual.orden) construirOrden(Visual.orden);
};

/* ---------- Controles ---------- */
ACCIONES['vis-herramienta'] = (id, el) => {
  Visual.herramienta = el.dataset.h;
  $$('[data-action="vis-herramienta"]').forEach(b => { b.classList.toggle('is-on', b === el); b.setAttribute('aria-pressed', String(b === el)); });
  $('.vis-nota').hidden = Visual.herramienta !== 'texto';
  lienzo().style.cursor = Visual.herramienta === 'texto' ? 'text' : 'crosshair';
  if (Visual.herramienta === 'texto') $('#visNota').focus();
};
ACCIONES['vis-color'] = (id, el) => {
  Visual.color = VIS_COLORES[el.dataset.c];
  $$('[data-action="vis-color"]').forEach(b => b.classList.toggle('is-on', b === el));
};
ACCIONES['vis-deshacer'] = () => { Visual.trazos.pop(); invalidarOrden(); redibujar(); };
ACCIONES['vis-limpiar'] = () => { Visual.trazos = []; invalidarOrden(); redibujar(); };
ACCIONES['vis-ejemplo'] = () => cargarImagen(VIS_EJEMPLO);
ACCIONES['vis-ver-ticket'] = () => { if (Visual.ultimoFolio) abrirDetalle(Visual.ultimoFolio); };

document.addEventListener('input', e => {
  if (e.target.id === 'visNota') Visual.nota = e.target.value;
  if (e.target.name === 'descripcion' && e.target.closest('[data-form="visual"]')) { Visual.datos.descripcion = e.target.value; invalidarOrden(); }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.matches('[data-vis-foto]')) {
    const f = el.files[0];
    if (f) cargarImagen(URL.createObjectURL(f));
    return;
  }
  if (!el.closest('[data-form="visual"]')) return;
  const d = Visual.datos;
  if (el.name === 'edificio') { d.edificio = el.value; d.nivel = d.espacio = d.activo = ''; }
  else if (el.name === 'nivel') { d.nivel = el.value; d.espacio = d.activo = ''; }
  else if (el.name === 'espacio') { d.espacio = el.value; d.activo = ''; }
  else if (el.name === 'activo') d.activo = el.value;
  else if (el.name === 'categoria') d.categoria = el.value;
  else if (el.name === 'severidad') {
    d.severidad = el.value;
    $$('.vis-sev .fchip').forEach(l => l.classList.toggle('is-on', l.querySelector('input').checked));
  }
  invalidarOrden();
  if (['edificio', 'nivel', 'espacio'].includes(el.name)) {
    $('.vis-ubic').innerHTML = ubicacionVisualHTML();
    const siguiente = { edificio: 'nivel', nivel: 'espacio', espacio: 'activo' }[el.name];
    $(`.vis-ubic [name="${siguiente}"]`)?.focus();
  }
});

/* ---------- Orden de trabajo ---------- */
function invalidarOrden() {
  if (!Visual.orden || Visual.orden.folio !== 'BORRADOR') return;
  const nota = $('#visOrdenNota');
  if (nota) nota.textContent = 'Hiciste cambios: vuelve a generar la orden.';
}

function validarVisual(estricto = true) {
  const d = Visual.datos;
  if (!Visual.imagen) return 'Primero toma o sube una foto, o usa la de ejemplo.';
  if (!d.edificio || !d.nivel || !d.espacio) return 'Selecciona el edificio, nivel y espacio.';
  if (!d.activo) return 'Selecciona el activo afectado.';
  if (!d.categoria || !d.severidad) return 'Elige la categoría y la severidad.';
  if (estricto && d.descripcion.trim().length < 10) return 'Describe la falla con al menos 10 caracteres.';
  return '';
}

function partirTexto(ctx, texto, ancho) {
  const lineas = [];
  let actual = '';
  String(texto).split(/\s+/).forEach(p => {
    const prueba = actual ? `${actual} ${p}` : p;
    if (ctx.measureText(prueba).width <= ancho) actual = prueba;
    else { if (actual) lineas.push(actual); actual = p; }
  });
  if (actual) lineas.push(actual);
  return lineas;
}

async function construirOrden(o) {
  const destino = $('#ordenCanvas');
  const fuente = lienzo();
  if (!destino || !fuente) return;
  try { await document.fonts?.load(`700 20px ${VIS_FUENTE}`); } catch { /* sin API de fuentes */ }
  const W = 1000, M = 40, c = destino.getContext('2d');
  c.font = `400 22px ${VIS_FUENTE}`;
  const lineas = partirTexto(c, o.descripcion, W - M * 2).slice(0, 8);
  const imgW = W - M * 2, imgH = Math.round(imgW * (fuente.height / fuente.width));
  const infoH = 250 + lineas.length * 32;
  destino.width = W; destino.height = 110 + infoH + imgH + 80;

  c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, destino.height);
  const g = c.createLinearGradient(0, 0, W, 110);
  g.addColorStop(0, '#022c22'); g.addColorStop(1, '#047857');
  c.fillStyle = g; c.fillRect(0, 0, W, 110);
  c.fillStyle = '#a7f3d0'; c.font = `800 32px ${VIS_FUENTE}`; c.fillText('CampusCare', M, 54);
  c.fillStyle = '#ecfdf5'; c.font = `500 19px ${VIS_FUENTE}`; c.fillText('Orden de trabajo con evidencia anotada', M, 86);
  c.textAlign = 'right'; c.fillStyle = '#ffffff'; c.font = `800 30px ${VIS_FUENTE}`; c.fillText(o.folio, W - M, 62);
  c.font = `500 16px ${VIS_FUENTE}`; c.fillStyle = '#6ee7b7'; c.fillText(o.folio === 'BORRADOR' ? 'Sin enviar' : o.pendiente ? 'Pendiente de envío' : 'Registrada en el sistema', W - M, 88);
  c.textAlign = 'start';

  let y = 150;
  const etiqueta = (t, x, yy) => { c.fillStyle = '#3d524a'; c.font = `700 15px ${VIS_FUENTE}`; c.fillText(t.toUpperCase(), x, yy); };
  const valor = (t, x, yy) => { c.fillStyle = '#0f1f1a'; c.font = `600 22px ${VIS_FUENTE}`; c.fillText(t, x, yy); };
  etiqueta('Ubicación', M, y); valor(o.ubicacion.slice(0, 46), M, y + 30);
  etiqueta('Fecha', 660, y); valor(o.fecha, 660, y + 30);
  y += 80;
  etiqueta('Categoría · Activo', M, y); valor(`${o.categoria} · ${o.activo}`.slice(0, 34), M, y + 30);
  etiqueta('Severidad', 660, y);
  c.fillStyle = VIS_SEVERIDAD[o.severidad] || '#3d524a'; c.beginPath();
  if (c.roundRect) c.roundRect(660, y + 8, 160, 36, 18); else c.rect(660, y + 8, 160, 36);
  c.fill();
  c.fillStyle = '#fff'; c.font = `800 18px ${VIS_FUENTE}`; c.textAlign = 'center'; c.fillText(o.severidad, 740, y + 33); c.textAlign = 'start';
  y += 80;
  etiqueta('Descripción de la falla', M, y);
  c.fillStyle = '#0f1f1a'; c.font = `400 22px ${VIS_FUENTE}`;
  lineas.forEach((l, i) => c.fillText(l, M, y + 32 + i * 32));
  y = 110 + infoH;
  c.drawImage(fuente, M, y, imgW, imgH);
  c.strokeStyle = '#a7f3d0'; c.lineWidth = 3; c.strokeRect(M, y, imgW, imgH);
  c.fillStyle = '#6b7f77'; c.font = `500 15px ${VIS_FUENTE}`;
  c.fillText(`Evidencia anotada por ${o.autor} · Generado con CampusCare (módulo de reporte visual)`, M, y + imgH + 40);

  const enlace = $('#visDescargar');
  enlace.href = destino.toDataURL('image/png');
  enlace.download = `orden-${o.folio}.png`;
  $('#visOrden').hidden = false;
  $('#visOrdenNota').textContent = o.folio === 'BORRADOR' ? 'Borrador: envíalo para recibir tu folio.' : '';
  $('#visVerTicket').hidden = !Visual.ultimoFolio || o.folio === 'BORRADOR';
}

function datosOrden(folio, pendiente = false) {
  const d = Visual.datos;
  return {
    folio, pendiente, ...d,
    ubicacion: `Edif. ${d.edificio} · ${nivelNombre(d.edificio, d.nivel)} · ${d.espacio}`,
    fecha: new Date().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }),
    autor: Auth.sesion()?.name || 'quien reporta'
  };
}

ACCIONES['vis-generar'] = async () => {
  const error = validarVisual(false);
  if (error) { estadoVisual(error, true); toast('Faltan datos', error, 'error'); return; }
  Visual.orden = datosOrden('BORRADOR');
  await construirOrden(Visual.orden);
  estadoVisual('Borrador generado. Revísalo y envíalo al sistema para recibir tu folio.');
  $('#visOrden').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

FORMULARIOS.visual = async () => {
  const error = validarVisual(true);
  if (error) throw new Error(error);
  const d = Visual.datos;
  const foto = lienzo().toDataURL('image/jpeg', 0.85);
  const t = await Tickets.crear({ ...d, descripcion: d.descripcion.trim(), foto, origen: 'reporte_visual' });
  const folio = t.encolado ? (t.folioLocal || 'PENDIENTE') : t.id;
  Visual.ultimoFolio = t.encolado ? null : t.id;
  Visual.orden = datosOrden(folio, !!t.encolado);
  await construirOrden(Visual.orden);
  vibrar(80);
  if (t.encolado) toast('Reporte visual guardado sin conexión', `Folio provisional ${folio}. Se enviará solo al volver el internet.`, 'info');
  else toast('Reporte visual enviado', `Tu folio es ${t.id}. Ya está en el flujo de atención y en el mapa de calor.`);
  // Se deja lista la vista para un reporte nuevo, conservando la orden generada
  Visual.orden = null;
  Visual.imagen = null; Visual.trazos = [];
  Visual.datos = { edificio: '', nivel: '', espacio: '', activo: '', categoria: '', severidad: '', descripcion: '' };
  const orden = $('#ordenCanvas');
  const copia = document.createElement('canvas');
  copia.width = orden.width; copia.height = orden.height;
  copia.getContext('2d').drawImage(orden, 0, 0);
  renderVista();
  // La orden enviada se vuelve a mostrar tal cual (la foto ya se limpió del lienzo)
  const nuevo = $('#ordenCanvas');
  nuevo.width = copia.width; nuevo.height = copia.height;
  nuevo.getContext('2d').drawImage(copia, 0, 0);
  $('#visDescargar').href = copia.toDataURL('image/png');
  $('#visDescargar').download = `orden-${folio}.png`;
  $('#visOrden').hidden = false;
  $('#visOrdenNota').textContent = t.encolado ? 'Pendiente de envío' : 'Registrada en el sistema';
  $('#visVerTicket').hidden = !Visual.ultimoFolio;
  estadoVisual('Puedes iniciar otro reporte visual.');
  $('#visOrden').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
