/* =========================================================
   Historial de registros (bitácora de la base de datos)
   ---------------------------------------------------------
   Cada INSERT, UPDATE o DELETE en las tablas principales lo
   anota un trigger de SQLite en la tabla "bitacora": qué se
   agregó, editó o borró, el antes y el después, quién lo hizo
   y desde qué módulo (formulario, reporte visual, auditoría
   Wi-Fi, cola sin conexión, mapa de calor, administración…).
   El administrador ve todo; los demás, sus propios cambios.
   ========================================================= */
'use strict';

const Bitacora = {
  filtros: { operacion: '', tabla: '', modulo: '', buscar: '' },
  pagina: 1,
  datos: null,
  registros: [],
  cargando: false
};
const OP_CLASE = { INSERT: 'op-alta', UPDATE: 'op-edicion', DELETE: 'op-baja' };
const OP_ICONO = { INSERT: 'plus', UPDATE: 'edit', DELETE: 'trash' };

RENDER.historial = s => {
  const d = Bitacora.datos;
  const r = d?.resumen || { INSERT: 0, UPDATE: 0, DELETE: 0 };
  const total = r.INSERT + r.UPDATE + r.DELETE;
  const f = Bitacora.filtros;
  const kpi = (op, titulo, n, ic, i) => `
    <button class="kpi kpi-${i} ${f.operacion === op ? 'is-sel' : ''}" data-action="bit-op" data-op="${op}">
      <span class="kpi-top">${titulo}<span class="kpi-ic">${icon(ic)}</span></span><strong>${n}</strong><small>${op ? 'Filtrar' : 'Ver todo'}</small>
    </button>`;
  const opciones = (obj, valor, todos) => `<option value="">${todos}</option>${Object.entries(obj || {}).map(([k, v]) => `<option value="${k}" ${valor === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}`;
  return `
  <div class="alert alert-info">${icon('database')}<div><strong>${s.role === 'admin' ? 'Bitácora completa de la base de datos.' : 'Tus movimientos en la base de datos.'}</strong>
    Cada vez que se agrega, edita o borra un registro, un trigger de SQLite lo anota con la fecha, la persona y el módulo desde el que se hizo, incluidos los módulos del equipo.</div></div>
  <section class="kpi-grid">
    ${kpi('', 'Movimientos', total, 'history', 0)}
    ${kpi('INSERT', 'Agregados', r.INSERT, 'plus', 1)}
    ${kpi('UPDATE', 'Editados', r.UPDATE, 'edit', 2)}
    ${kpi('DELETE', 'Borrados', r.DELETE, 'trash', 3)}
  </section>
  ${d?.modulos?.length ? `<section class="card">
    <div class="card-head"><h3>Movimientos por módulo</h3><span class="muted small">Toca uno para filtrar</span></div>
    <div class="chip-filters">${d.modulos.map(m => `<button class="fchip ${f.modulo === m.clave ? 'is-on' : ''}" data-action="bit-modulo" data-m="${esc(m.clave)}">${esc(m.nombre)}<b>${m.n}</b></button>`).join('')}</div>
  </section>` : ''}
  <section class="card">
    <div class="filters bit-filtros">
      <label class="field"><span>Buscar</span><div class="input-icon"><span>${icon('search')}</span><input type="search" data-bit="buscar" value="${esc(f.buscar)}" placeholder="Folio, nombre, campo…"></div></label>
      <label class="field"><span>Tabla</span><select data-bit="tabla">${opciones(d?.catalogos?.tablas, f.tabla, 'Todas las tablas')}</select></label>
      <label class="field"><span>Módulo</span><select data-bit="modulo">${opciones(d?.catalogos?.modulos, f.modulo, 'Todos los módulos')}</select></label>
      <label class="field"><span>Operación</span><select data-bit="operacion">${opciones(d?.catalogos?.operaciones, f.operacion, 'Todas')}</select></label>
    </div>
    <div class="card-head bit-head"><h3>Registros</h3><div class="btn-row"><span class="muted small" id="bitTotal">${d ? `${d.total} movimiento${d.total === 1 ? '' : 's'}` : ''}</span>
      <button class="btn btn-ghost btn-sm" data-action="bit-limpiar">${icon('refresh')} Limpiar filtros</button></div></div>
    <ol class="bit-lista" id="bitLista">${d ? Bitacora.registros.map(itemBitacora).join('') || vacio('Sin movimientos', 'No hay cambios con estos filtros.', 'history') : `<p class="muted small">Cargando bitácora…</p>`}</ol>
    ${d && Bitacora.registros.length < d.total ? `<div class="center"><button class="btn btn-ghost" data-action="bit-mas">${icon('arrow')} Cargar más</button></div>` : ''}
  </section>`;
};

function itemBitacora(b) {
  return `<li class="bit-item ${OP_CLASE[b.operacion]}">
    <span class="bit-ic">${icon(OP_ICONO[b.operacion])}</span>
    <div class="bit-cuerpo">
      <div class="bit-top"><span class="bit-op">${esc(b.operacionNombre)}</span><span class="bit-tabla">${esc(b.tablaNombre)}</span>${b.registro ? `<span class="folio">${esc(b.registro)}</span>` : ''}<span class="bit-mod">${esc(b.moduloNombre)}</span></div>
      <strong>${esc(b.resumen || '')}</strong>
      ${b.cambios ? `<p class="bit-cambios">${esc(b.cambios)}</p>` : ''}
      <small>${icon('user')} ${esc(b.usuario)} · ${fmtFecha(b.at)} · ${hace(b.at)}</small>
    </div>
    <button class="btn btn-ghost btn-sm" data-action="bit-detalle" data-id="${b.id}">${icon('eye')} Detalle</button>
  </li>`;
}

async function cargarBitacora(agregar = false) {
  if (Bitacora.cargando) return;
  Bitacora.cargando = true;
  const f = Bitacora.filtros;
  const q = new URLSearchParams({ pagina: Bitacora.pagina });
  for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
  try {
    const d = await api(`/bitacora?${q}`);
    Bitacora.datos = d;
    Bitacora.registros = agregar ? [...Bitacora.registros, ...d.registros] : d.registros;
  } catch (e) {
    Bitacora.datos ??= { total: 0, resumen: { INSERT: 0, UPDATE: 0, DELETE: 0 }, modulos: [], catalogos: {}, registros: [] };
    toast('No se pudo cargar la bitácora', e.message, 'error');
  } finally { Bitacora.cargando = false; }
  if (state.vista === 'historial') {
    const foco = document.activeElement?.dataset?.bit;
    _renderVistaHistorial();
    if (foco) { const el = $(`[data-bit="${foco}"]`); el?.focus(); if (el?.setSelectionRange && el.type === 'search') el.setSelectionRange(el.value.length, el.value.length); }
  }
}
const _renderVistaHistorial = () => {
  const s = Auth.sesion();
  if (!s) return;
  $('#view').innerHTML = RENDER.historial(s);
  sellarAutor();
};
POST_RENDER.historial = () => { Bitacora.pagina = 1; cargarBitacora(); };

function aplicarFiltro(clave, valor) {
  Bitacora.filtros[clave] = valor;
  Bitacora.pagina = 1;
  cargarBitacora();
}
ACCIONES['bit-op'] = (id, el) => aplicarFiltro('operacion', Bitacora.filtros.operacion === el.dataset.op ? '' : el.dataset.op);
ACCIONES['bit-modulo'] = (id, el) => aplicarFiltro('modulo', Bitacora.filtros.modulo === el.dataset.m ? '' : el.dataset.m);
ACCIONES['bit-limpiar'] = () => { Bitacora.filtros = { operacion: '', tabla: '', modulo: '', buscar: '' }; Bitacora.pagina = 1; cargarBitacora(); };
ACCIONES['bit-mas'] = () => { Bitacora.pagina++; cargarBitacora(true); };
document.addEventListener('change', e => {
  const k = e.target.dataset?.bit;
  if (k && k !== 'buscar') aplicarFiltro(k, e.target.value);
});
let temporizadorBitacora;
document.addEventListener('input', e => {
  if (e.target.dataset?.bit !== 'buscar') return;
  clearTimeout(temporizadorBitacora);
  temporizadorBitacora = setTimeout(() => aplicarFiltro('buscar', e.target.value.trim()), 350);
});

/* Detalle: antes y después de cada campo */
ACCIONES['bit-detalle'] = id => {
  const b = Bitacora.registros.find(x => String(x.id) === String(id));
  if (!b) return;
  const campos = [...new Set([...Object.keys(b.antes || {}), ...Object.keys(b.despues || {})])];
  const valor = v => (v === null || v === undefined ? '<span class="muted">—</span>' : esc(String(v).length > 140 ? `${String(v).slice(0, 140)}…` : v));
  abrirModal(`
    <div class="modal-pad">
      <div class="modal-head"><span class="stat-ic bit-${OP_CLASE[b.operacion]}">${icon(OP_ICONO[b.operacion])}</span>
        <div><h3>${esc(b.operacionNombre)} · ${esc(b.tablaNombre)} ${b.registro ? esc(b.registro) : ''}</h3><p class="muted small">${esc(b.usuario)} · ${esc(b.moduloNombre)} · ${fmtFecha(b.at)}</p></div></div>
      <p><strong>${esc(b.resumen || '')}</strong></p>
      ${b.cambios ? `<div class="alert alert-info">${icon('edit')}<div>${esc(b.cambios)}</div></div>` : ''}
      <div class="table-wrap"><table class="table bit-detalle-tabla">
        <thead><tr><th>Campo</th>${b.antes ? '<th>Antes</th>' : ''}${b.despues ? '<th>Después</th>' : ''}</tr></thead>
        <tbody>${campos.map(c => {
          const cambio = b.antes && b.despues && JSON.stringify(b.antes[c]) !== JSON.stringify(b.despues[c]);
          return `<tr class="${cambio ? 'is-cambio' : ''}"><td data-label="Campo"><b>${esc(c)}</b></td>${b.antes ? `<td data-label="Antes">${valor(b.antes[c])}</td>` : ''}${b.despues ? `<td data-label="Después">${valor(b.despues[c])}</td>` : ''}</tr>`;
        }).join('')}</tbody></table></div>
      <p class="tiny muted">Registro ${b.id} de la tabla <code>bitacora</code>. Las contraseñas nunca se copian a la bitácora; solo se anota que cambiaron.</p>
      <div class="modal-actions">${b.tabla === 'tickets' && DB.ticket(b.registro) ? `<button class="btn btn-ghost" data-action="ver" data-id="${esc(b.registro)}">${icon('eye')} Ver ticket</button>` : ''}<button class="btn btn-primary" data-close>Cerrar</button></div>
    </div>`, true);
};

/* Al llegar cambios en tiempo real, renderVista vuelve a dibujar la vista y POST_RENDER recarga la bitácora */
