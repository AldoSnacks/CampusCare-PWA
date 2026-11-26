/* =========================================================
   /api/sensores — Monitoreo físico con Arduino
   ========================================================= */
'use strict';
const express = require('express');
const sensores = require('../src/sensores');
const { notificar } = require('../src/tickets');
const { emitir, difundir } = require('../src/eventos');

const router = express.Router();

/* GET /api/sensores — última lectura, si el Arduino está en línea y los eventos recientes */
router.get('/', (req, res) => {
  res.json({ ...sensores.estadoActual(), eventos: sensores.listarEventos() });
});

/* POST /api/sensores/lectura { luz, fuego, flama, agua, fuente } — la manda el navegador conectado al Arduino */
router.post('/lectura', (req, res) => {
  const r = sensores.registrarLectura(req.usuario, req.body, notificar);
  difundir('sensores', { ultimo: r.ultimo, eventos: r.eventos });
  if (r.eventos.length) emitir(r.eventos.some(e => e.folio) ? 'ticket-creado' : 'sensores');
  res.json(r);
});

module.exports = router;
