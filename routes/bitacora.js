/* =========================================================
   /api/bitacora — historial de cambios en la base de datos
   (qué se agregó, editó o borró, quién y desde qué módulo)
   ========================================================= */
'use strict';
const express = require('express');
const { conexion, aMs } = require('../src/db');
const { MODULOS } = require('../src/bitacora');

const router = express.Router();
const TABLAS = {
  tickets: 'Reportes', usuarios: 'Usuarios', resoluciones: 'Soluciones', auditorias_red: 'Auditorías de red',
  invitaciones: 'Enlaces de registro', edificios: 'Edificios', niveles: 'Niveles', espacios: 'Espacios',
  categorias: 'Categorías', severidades: 'Severidades'
};
const OPERACIONES = { INSERT: 'Agregado', UPDATE: 'Editado', DELETE: 'Borrado' };

/* GET /api/bitacora?operacion=&tabla=&modulo=&buscar=&pagina=  — el admin ve todo; los demás, sus propios cambios */
router.get('/', (req, res) => {
  const db = conexion();
  const where = [], params = [];
  if (req.usuario.rol !== 'admin') { where.push('b.usuario_id = ?'); params.push(req.usuario.id); }
  if (OPERACIONES[req.query.operacion]) { where.push('b.operacion = ?'); params.push(req.query.operacion); }
  if (TABLAS[req.query.tabla]) { where.push('b.tabla = ?'); params.push(req.query.tabla); }
  if (MODULOS[req.query.modulo]) { where.push('b.modulo = ?'); params.push(req.query.modulo); }
  const buscar = String(req.query.buscar || '').trim();
  if (buscar) {
    where.push("(b.resumen LIKE ? OR b.registro_id LIKE ? OR b.usuario_nombre LIKE ? OR IFNULL(b.cambios, '') LIKE ?)");
    params.push(...Array(4).fill(`%${buscar}%`));
  }
  const filtro = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const porPagina = 40;
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM bitacora b ${filtro}`).get(...params).n;
  const filas = db.prepare(`SELECT b.* FROM bitacora b ${filtro} ORDER BY b.fecha DESC, b.id DESC LIMIT ? OFFSET ?`)
    .all(...params, porPagina, (pagina - 1) * porPagina);
  const conteo = db.prepare(`SELECT b.operacion, COUNT(*) AS n FROM bitacora b ${filtro} GROUP BY b.operacion`).all(...params);
  const porModulo = db.prepare(`SELECT b.modulo, COUNT(*) AS n FROM bitacora b ${filtro} GROUP BY b.modulo ORDER BY n DESC`).all(...params);

  const json = t => { try { return t ? JSON.parse(t) : null; } catch { return null; } };
  res.json({
    total, pagina, porPagina,
    resumen: Object.fromEntries(Object.keys(OPERACIONES).map(o => [o, conteo.find(c => c.operacion === o)?.n || 0])),
    modulos: porModulo.map(m => ({ clave: m.modulo, nombre: MODULOS[m.modulo] || m.modulo, n: m.n })),
    catalogos: { tablas: TABLAS, operaciones: OPERACIONES, modulos: MODULOS },
    registros: filas.map(b => ({
      id: b.id, at: aMs(b.fecha), tabla: b.tabla, tablaNombre: TABLAS[b.tabla] || b.tabla,
      operacion: b.operacion, operacionNombre: OPERACIONES[b.operacion], registro: b.registro_id,
      resumen: b.resumen, cambios: b.cambios, antes: json(b.antes), despues: json(b.despues),
      usuario: b.usuario_nombre || 'Sistema', usuarioId: b.usuario_id,
      modulo: b.modulo, moduloNombre: MODULOS[b.modulo] || b.modulo
    }))
  });
});

module.exports = router;
