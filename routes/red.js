/* =========================================================
   /api/red — Auditoría de red Wi-Fi (aportación de Carlos)
   ========================================================= */
'use strict';
const express = require('express');
const red = require('../src/red');
const { notificar } = require('../src/tickets');
const { emitir } = require('../src/eventos');

const router = express.Router();

/* POST /api/red/auditorias — guarda una medición (y la escala a ticket si se pide) */
router.post('/auditorias', (req, res) => {
  const r = red.registrar(req.usuario, req.body, notificar);
  emitir('auditoria-red');
  if (r.folio) emitir('ticket-creado');
  res.status(r.repetida ? 200 : 201).json(r);
});

/* GET /api/red/auditorias — historial de mediciones */
router.get('/auditorias', (req, res) => {
  res.json({ mediciones: red.listar(req.usuario), resumen: req.usuario.rol === 'admin' ? red.resumen() : [] });
});

module.exports = router;
