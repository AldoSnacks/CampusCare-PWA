/* =========================================================
   /api/invitaciones — enlaces y códigos QR para que otra
   persona se registre desde su teléfono con un rol definido
   ========================================================= */
'use strict';
const express = require('express');
const crypto = require('node:crypto');
const { conexion, fecha, aMs } = require('../src/db');
const { ErrorHttp } = require('../src/auth');
const { emitir } = require('../src/eventos');

const router = express.Router();
const ROLES = ['solicitante', 'mantenimiento', 'admin'];
const DIA = 86400000;

function codigoNuevo() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (const b of crypto.randomBytes(8)) c += letras[b % letras.length];
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

const mapear = i => ({
  codigo: i.codigo, rol: i.rol, usos: i.usos, maxUsos: i.max_usos, activa: !!i.activa,
  vigente: !!i.activa && i.usos < i.max_usos && aMs(i.expira_en) > Date.now(),
  expira: aMs(i.expira_en), creada: aMs(i.creada_en), creadaPor: i.creador || null
});

/* GET /api/invitaciones — el admin ve todas; los demás, las que crearon */
router.get('/', (req, res) => {
  const filtro = req.usuario.rol === 'admin' ? '' : 'WHERE i.creada_por = ?';
  const filas = conexion().prepare(`SELECT i.*, u.nombre AS creador FROM invitaciones i LEFT JOIN usuarios u ON u.id = i.creada_por ${filtro} ORDER BY i.id DESC`)
    .all(...(filtro ? [req.usuario.id] : []));
  res.json(filas.map(mapear));
});

/* POST /api/invitaciones  { rol, dias, maxUsos } — solo el admin puede invitar con un rol distinto a solicitante */
router.post('/', (req, res) => {
  const rol = ROLES.includes(req.body.rol) ? req.body.rol : 'solicitante';
  if (rol !== 'solicitante' && req.usuario.rol !== 'admin') throw new ErrorHttp(403, 'Solo la administración puede invitar a personal de mantenimiento o administradores.');
  const dias = Math.min(Math.max(Number(req.body.dias) || 7, 1), 60);
  const maxUsos = Math.min(Math.max(Number(req.body.maxUsos) || 30, 1), 500);
  const codigo = codigoNuevo();
  conexion().prepare('INSERT INTO invitaciones (codigo, rol, creada_por, max_usos, expira_en, creada_en) VALUES (?, ?, ?, ?, ?, ?)')
    .run(codigo, rol, req.usuario.id, maxUsos, fecha(Date.now() + dias * DIA), fecha());
  emitir('invitaciones');
  res.status(201).json({ codigo });
});

/* PATCH /api/invitaciones/:codigo  { activa } */
router.patch('/:codigo', (req, res) => {
  const db = conexion();
  const i = db.prepare('SELECT * FROM invitaciones WHERE codigo = ?').get(req.params.codigo);
  if (!i) throw new ErrorHttp(404, 'La invitación no existe.');
  if (req.usuario.rol !== 'admin' && i.creada_por !== req.usuario.id) throw new ErrorHttp(403, 'Solo puedes cambiar tus propias invitaciones.');
  db.prepare('UPDATE invitaciones SET activa = ? WHERE id = ?').run(req.body.activa ? 1 : 0, i.id);
  emitir('invitaciones');
  res.json({ ok: true });
});

module.exports = router;
