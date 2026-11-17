/* =========================================================
   /api/tickets — incidencias (RF-02, RF-03, RF-04)
   ========================================================= */
'use strict';
const express = require('express');
const tickets = require('../src/tickets');
const { requiereRol } = require('../src/auth');
const { emitir } = require('../src/eventos');

const router = express.Router();

/* GET /api/tickets — lista según el rol */
router.get('/', (req, res) => {
  res.json(tickets.listar(req.usuario));
});

/* POST /api/tickets — levantar incidencia */
router.post('/', requiereRol('solicitante', 'admin'), (req, res) => {
  const folio = tickets.crear(req.usuario, req.body);
  emitir('ticket-creado');
  res.status(201).json({ folio });
});

/* POST /api/tickets/:folio/transicion — cambiar de estado */
router.post('/:folio/transicion', (req, res) => {
  tickets.transicion(req.usuario, req.params.folio, req.body);
  emitir('ticket-actualizado');
  res.json({ ok: true });
});

/* DELETE /api/tickets/:folio — cancelar (solicitante) o eliminar (admin) */
router.delete('/:folio', (req, res) => {
  tickets.eliminar(req.usuario, req.params.folio);
  emitir('ticket-eliminado');
  res.json({ ok: true });
});

module.exports = router;
