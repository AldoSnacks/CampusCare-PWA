/* =========================================================
   /api/push — suscripciones a notificaciones push (PWA)
   ========================================================= */
'use strict';
const express = require('express');
const push = require('../src/push');

const router = express.Router();

/* POST /api/push/suscripcion — guarda la suscripción del navegador */
router.post('/suscripcion', (req, res) => {
  push.guardarSuscripcion(req.usuario.id, req.body, req.headers['user-agent']);
  res.status(201).json({ ok: true });
});

/* DELETE /api/push/suscripcion — la elimina (al cerrar sesión o desactivar) */
router.delete('/suscripcion', (req, res) => {
  res.json({ eliminadas: push.borrarSuscripcion(req.usuario.id, req.body?.endpoint) });
});

/* POST /api/push/prueba — envía una notificación de prueba a los dispositivos del usuario */
router.post('/prueba', async (req, res, next) => {
  try {
    const r = await push.enviarAUsuario(req.usuario.id, {
      title: 'CampusCare · Prueba', body: `Hola, ${req.usuario.nombre}. Las notificaciones push funcionan en este dispositivo.`, url: '/#notificaciones'
    });
    res.json(r);
  } catch (e) { next(e); }
});

module.exports = router;
