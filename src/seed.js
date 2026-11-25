/* =========================================================
   Datos iniciales (catálogo, usuarios de demostración y
   tickets de ejemplo para que el dashboard tenga información)
   ========================================================= */
'use strict';
const bcrypt = require('bcryptjs');
const { conexion, transaccion, fecha } = require('./db');
const bitacora = require('./bitacora');
const red = require('./red');

const PASSWORD_DEMO = 'Campus2026';
const HORA = 3600000;

const USUARIOS = [
  ['alumno@institucion.edu.mx',   'María Fernanda López', 'solicitante',   'img/avatar-alumno.jpg'],
  ['docente@institucion.edu.mx',  'Dr. Jorge Ramírez',    'solicitante',   'img/avatar-docente.jpg'],
  ['tecnico@institucion.edu.mx',  'Ing. Carlos Méndez',   'mantenimiento', 'img/avatar-tecnico.jpg'],
  ['tecnico2@institucion.edu.mx', 'Luis Hernández',       'mantenimiento', null],
  ['tecnico3@institucion.edu.mx', 'Ana Torres',           'mantenimiento', null],
  ['admin@institucion.edu.mx',    'Lic. Patricia Gómez',  'admin',         'img/avatar-admin.jpg']
];

const EDIFICIOS = [
  ['A', 'Edificio A · Rectoría', 'img/edificio-a.jpg', [
    ['PB', 'Planta baja', ['Recepción', 'Servicios Escolares', 'Sanitarios PB', 'Pasillo principal']],
    ['N1', 'Nivel 1',     ['Sala de juntas', 'Oficinas de Dirección', 'Sanitarios N1']],
    ['N2', 'Nivel 2',     ['Auditorio', 'Sala de consejo']]
  ]],
  ['B', 'Edificio B · Ingeniería', 'img/edificio-b.jpg', [
    ['PB', 'Planta baja', ['Aula B-101', 'Aula B-102', 'Aula B-103', 'Sanitarios PB']],
    ['N1', 'Nivel 1',     ['Aula B-201', 'Aula B-202', 'Lab. de Electrónica']],
    ['N2', 'Nivel 2',     ['Aula B-301', 'Lab. de Redes', 'Sala de maestros']]
  ]],
  ['C', 'Edificio C · Biblioteca', 'img/edificio-c.jpg', [
    ['PB', 'Planta baja', ['Acervo general', 'Área de préstamo', 'Sanitarios PB']],
    ['N1', 'Nivel 1',     ['Cubículos de estudio', 'Sala de cómputo', 'Hemeroteca']]
  ]],
  ['D', 'Edificio D · Laboratorios', 'img/edificio-d.jpg', [
    ['PB', 'Planta baja', ['Lab. de Química', 'Lab. de Física', 'Almacén']],
    ['N1', 'Nivel 1',     ['Lab. de Cómputo 1', 'Lab. de Cómputo 2', 'Site de TI']],
    ['N2', 'Nivel 2',     ['Lab. de Biología', 'Cafetería']]
  ]]
];

const CATEGORIAS = [
  ['Eléctrica',   'Luminarias, contactos, tableros',  'zap',      'img/cat-electrica.jpg'],
  ['Mobiliario',  'Sillas, mesas, pizarrones',        'chair',    'img/cat-mobiliario.jpg'],
  ['Red/TI',      'Internet, proyectores, equipos',   'wifi',     'img/cat-red.jpg'],
  ['Plomería',    'Fugas, sanitarios, lavabos',       'drop',     'img/cat-plomeria.jpg'],
  ['Estructural', 'Muros, techos, pisos, puertas',    'building', 'img/cat-estructural.jpg']
];

const SEVERIDADES = [
  ['Baja',    72, 'No impide usar el espacio.', 2],
  ['Media',   24, 'Afecta parcialmente las actividades.', 1],
  ['Crítica',  4, 'Riesgo para personas o suspende clases.', 0]
];

const SOLUCION = {
  'Eléctrica':   ['Se sustituyó el componente dañado, se revisó el circuito y se midió la tensión (127 V).', 'Contacto dúplex, cinta aislante, cable THW cal. 12'],
  'Red/TI':      ['Se reconfiguró el equipo y se probó la conectividad en todos los puntos.', 'Cable UTP Cat 6, conectores RJ45'],
  'Plomería':    ['Se cambió el empaque y se verificó que no existieran fugas.', 'Empaques, cinta teflón, llave de paso 1/2"'],
  'Mobiliario':  ['Se reparó la estructura y se ajustó la tornillería.', 'Tornillería, respaldo de repuesto'],
  'Estructural': ['Se reemplazó la pieza dañada y se selló el perímetro.', 'Cerradura de seguridad, sellador acrílico']
};

// [edificio, nivel, espacio, activo, categoría, severidad, descripción, estado final, horas atrás, horas de resolución, técnico]
const TICKETS = [
  ['B', 'PB', 'Aula B-101', 'Proyector', 'Red/TI', 'Media', 'El proyector no enciende y la lámpara parpadea.', 'Cerrado', 320, 9, 0],
  ['B', 'N1', 'Lab. de Electrónica', 'Contactos / apagadores', 'Eléctrica', 'Crítica', 'Contacto con chispa y olor a quemado en la mesa 4.', 'Cerrado', 290, 3, 1],
  ['C', 'PB', 'Sanitarios PB', 'Lavabo / llave', 'Plomería', 'Media', 'Fuga constante en la llave del lavabo central.', 'Cerrado', 260, 20, 2],
  ['D', 'N1', 'Lab. de Cómputo 1', 'Nodo de red', 'Red/TI', 'Media', 'Sin conexión a internet en la fila 3 de equipos.', 'Cerrado', 240, 30, 0],
  ['A', 'PB', 'Pasillo principal', 'Luminarias', 'Eléctrica', 'Baja', 'Dos lámparas fundidas cerca de la entrada.', 'Cerrado', 220, 40, 1],
  ['B', 'N2', 'Aula B-301', 'Pupitres / sillas', 'Mobiliario', 'Baja', 'Cinco pupitres con el respaldo roto.', 'Cerrado', 200, 60, 2],
  ['D', 'PB', 'Lab. de Química', 'Lavabo / llave', 'Plomería', 'Crítica', 'Fuga de agua bajo la tarja de lavado de material.', 'Cerrado', 180, 6, 1],
  ['B', 'PB', 'Aula B-102', 'Aire acondicionado', 'Eléctrica', 'Media', 'El aire acondicionado gotea y hace ruido.', 'Resuelto', 150, 18, 0],
  ['C', 'N1', 'Sala de cómputo', 'Equipo de cómputo', 'Red/TI', 'Baja', 'Tres equipos no inician sesión con la cuenta institucional.', 'Resuelto', 120, 26, 0],
  ['A', 'N2', 'Auditorio', 'Muros / techo', 'Estructural', 'Media', 'Mancha de humedad y desprendimiento de pintura en el plafón.', 'Rechazado', 110, null, null],
  ['B', 'N1', 'Aula B-201', 'Ventanas', 'Estructural', 'Media', 'Ventana con el vidrio estrellado.', 'En Proceso', 30, null, 2],
  ['D', 'N1', 'Site de TI', 'Aire acondicionado', 'Eléctrica', 'Crítica', 'El clima del site se apagó; la temperatura va en aumento.', 'En Proceso', 6, null, 1],
  ['B', 'PB', 'Sanitarios PB', 'WC / mingitorio', 'Plomería', 'Media', 'WC tapado en el sanitario de hombres.', 'Asignado', 10, null, 0],
  ['C', 'PB', 'Acervo general', 'Luminarias', 'Eléctrica', 'Baja', 'Luz intermitente en el pasillo 5 del acervo.', 'Asignado', 40, null, 1],
  ['D', 'N2', 'Cafetería', 'Mobiliario', 'Mobiliario', 'Baja', 'Mesa coja en el área de comensales.', 'Abierto', 20, null, null],
  ['B', 'N2', 'Lab. de Redes', 'Access point Wi-Fi', 'Red/TI', 'Crítica', 'Wi-Fi caído durante un examen práctico.', 'Abierto', 2, null, null],
  ['A', 'N1', 'Sala de juntas', 'Pantalla / TV', 'Red/TI', 'Media', 'La pantalla no detecta la entrada HDMI.', 'Abierto', 30, null, null],
  ['B', 'PB', 'Aula B-103', 'Puerta / cerradura', 'Estructural', 'Media', 'La cerradura no cierra; el aula queda abierta.', 'Cerrado', 96, 12, 2],
  ['D', 'PB', 'Lab. de Física', 'Contactos / apagadores', 'Eléctrica', 'Media', 'Apagador suelto con cables expuestos.', 'Cerrado', 72, 8, 1],
  ['B', 'N1', 'Aula B-202', 'Proyector', 'Red/TI', 'Baja', 'El control remoto del proyector no funciona.', 'Cerrado', 50, 20, 0]
];

// Reportes generados por los módulos del equipo
// [..., técnico, origen, foto, correo del solicitante]
const TICKETS_EQUIPO = [
  ['B', 'PB', 'Aula B-102', 'Proyector', 'Red/TI', 'Media', 'Reporte visual: el proyector no muestra imagen aunque enciende (marcado en la foto).', 'Asignado', 26, null, 0, 'reporte_visual', 'img/demo-visual-1.jpg', 'alumno@institucion.edu.mx'],
  ['B', 'N2', 'Aula B-301', 'Luminarias', 'Eléctrica', 'Baja', 'Reporte visual: la luminaria del fondo parpadea todo el tiempo (marcada en amarillo).', 'Abierto', 5, null, null, 'reporte_visual', 'img/demo-visual-2.jpg', 'docente@institucion.edu.mx'],
  ['B', 'PB', 'Aula B-103', 'Pupitres / sillas', 'Mobiliario', 'Baja', 'Reporte visual: butaca de la primera fila con la pata rota (encerrada en rojo).', 'Cerrado', 70, 20, 2, 'reporte_visual', 'img/demo-visual-3.jpg', 'alumno@institucion.edu.mx'],
  ['B', 'N1', 'Aula B-202', 'Ventanas', 'Estructural', 'Media', 'Reporte visual: la ventana izquierda no cierra y entra agua cuando llueve.', 'En Proceso', 15, null, 2, 'reporte_visual', 'img/demo-visual-4.jpg', 'docente@institucion.edu.mx'],
  ['B', 'N2', 'Lab. de Redes', 'Access point Wi-Fi', 'Red/TI', 'Crítica', '[Auditoría Wi-Fi] Latencia 340 ms · jitter 85 ms · pérdida 33% · 0.9 Mbps (wifi). Videollamadas: No viable; Git/Cloud: Crítico; descargas: Muy lento.', 'Asignado', 9, null, 0, 'auditoria_red', 'img/cat-red.jpg', 'alumno@institucion.edu.mx'],
  ['C', 'N1', 'Cubículos de estudio', 'Access point Wi-Fi', 'Red/TI', 'Crítica', '[Zona muerta] Sin conexión a la red institucional en Edif. C · N1 · Cubículos de estudio.', 'Abierto', 3, null, null, 'auditoria_red', 'img/cat-red.jpg', 'docente@institucion.edu.mx'],
  ['D', 'N2', 'Cafetería', 'Lavabo / llave', 'Plomería', 'Media', 'Fuga en la tarja de la cafetería; se reportó sin señal y se envió al recuperar la red.', 'Asignado', 12, null, 1, 'sin_conexion', 'img/cat-plomeria.jpg', 'alumno@institucion.edu.mx']
];

// Mediciones Wi-Fi: [edificio, nivel, espacio, latencia, jitter, pérdida, Mbps, tipo, sin red, horas atrás, quién, activo del ticket escalado]
const AUDITORIAS = [
  ['B', 'PB', 'Aula B-101', 38, 9, 0, 42.6, 'wifi', 0, 140, 'alumno@institucion.edu.mx'],
  ['A', 'N2', 'Auditorio', 64, 14, 0, 18.4, 'wifi', 0, 120, 'docente@institucion.edu.mx'],
  ['C', 'PB', 'Acervo general', 132, 34, 0, 6.2, 'wifi', 0, 96, 'alumno@institucion.edu.mx'],
  ['D', 'N1', 'Lab. de Cómputo 1', 22, 6, 0, 88.1, 'ethernet', 0, 72, 'tecnico@institucion.edu.mx'],
  ['B', 'N2', 'Lab. de Redes', 340, 85, 33, 0.9, 'wifi', 0, 9, 'alumno@institucion.edu.mx', 'Access point Wi-Fi'],
  ['B', 'N2', 'Lab. de Redes', 210, 52, 0, 3.1, 'wifi', 0, 30, 'docente@institucion.edu.mx'],
  ['C', 'N1', 'Cubículos de estudio', 0, 0, 100, 0, 'sin conexión', 1, 3, 'docente@institucion.edu.mx', 'Access point Wi-Fi'],
  ['D', 'N2', 'Cafetería', 175, 44, 0, 2.4, '4g', 0, 12, 'alumno@institucion.edu.mx'],
  ['A', 'PB', 'Servicios Escolares', 48, 11, 0, 25.3, 'wifi', 0, 20, 'admin@institucion.edu.mx']
];

function mensajeEstado(estado, tecnicoNombre, motivo) {
  return ({
    'Asignado':   `Tu reporte fue asignado a ${tecnicoNombre}.`,
    'En Proceso': 'El personal de mantenimiento inició los trabajos.',
    'Resuelto':   'Tu reporte fue resuelto. Revisa la evidencia del trabajo.',
    'Rechazado':  `Tu reporte fue rechazado: ${motivo || ''}`,
    'Cerrado':    'El ticket fue validado y cerrado.'
  })[estado];
}

function sembrar() {
  const ahora = Date.now();
  const hash = bcrypt.hashSync(PASSWORD_DEMO, 10);

  transaccion(db => {
    // La bitácora registra la carga inicial con fechas en el pasado, como si se hubiera capturado en su momento
    const ctx = (quien, modulo, ms) => bitacora.establecer(db, quien, modulo, fecha(ms));
    ctx({ id: null, nombre: 'Carga inicial del sistema' }, 'semilla', ahora - 400 * HORA);

    // Usuarios
    const insUsuario = db.prepare("INSERT INTO usuarios (correo, nombre, rol, password_hash, avatar, registrado_por, creado_en) VALUES (?, ?, ?, ?, ?, 'semilla', ?)");
    const usuarios = {};
    for (const [correo, nombre, rol, avatar] of USUARIOS) {
      const r = insUsuario.run(correo, nombre, rol, hash, avatar, fecha(ahora - 400 * HORA));
      usuarios[correo] = { id: Number(r.lastInsertRowid), nombre, rol };
    }

    // Catálogo de ubicaciones
    const insEdif = db.prepare('INSERT INTO edificios (id, nombre, imagen) VALUES (?, ?, ?)');
    const insNivel = db.prepare('INSERT INTO niveles (edificio_id, clave, nombre) VALUES (?, ?, ?)');
    const insEspacio = db.prepare('INSERT INTO espacios (nivel_id, nombre) VALUES (?, ?)');
    const espacios = {};
    for (const [id, nombre, imagen, niveles] of EDIFICIOS) {
      insEdif.run(id, nombre, imagen);
      for (const [clave, nomNivel, lista] of niveles) {
        const nivelId = Number(insNivel.run(id, clave, nomNivel).lastInsertRowid);
        for (const esp of lista) espacios[`${id}|${clave}|${esp}`] = Number(insEspacio.run(nivelId, esp).lastInsertRowid);
      }
    }

    // Categorías y severidades
    const categorias = {};
    const insCat = db.prepare('INSERT INTO categorias (nombre, descripcion, icono, imagen) VALUES (?, ?, ?, ?)');
    for (const [nombre, desc, icono, img] of CATEGORIAS) categorias[nombre] = Number(insCat.run(nombre, desc, icono, img).lastInsertRowid);
    const insSev = db.prepare('INSERT INTO severidades (nombre, sla_horas, descripcion, orden) VALUES (?, ?, ?, ?)');
    for (const s of SEVERIDADES) insSev.run(...s);

    // Tickets de ejemplo con su historial completo
    const solicitantes = USUARIOS.filter(u => u[2] === 'solicitante').map(u => usuarios[u[0]]);
    const tecnicos = USUARIOS.filter(u => u[2] === 'mantenimiento').map(u => usuarios[u[0]]);
    const admin = usuarios['admin@institucion.edu.mx'];

    const insTicket = db.prepare(`INSERT INTO tickets
      (solicitante_id, espacio_id, activo, categoria_id, severidad, descripcion, foto, origen, estado, creado_en, actualizado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Abierto', ?, ?)`);
    const insHist = db.prepare('INSERT INTO historial_estados (ticket_id, estado_anterior, estado_nuevo, usuario_id, usuario_nombre, nota, fecha) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insNotif = db.prepare('INSERT INTO notificaciones (usuario_id, ticket_id, titulo, mensaje, leida, creada_en) VALUES (?, ?, ?, ?, ?, ?)');
    const insRes = db.prepare('INSERT INTO resoluciones (ticket_id, tecnico_id, foto, notas, materiales, resuelto_en) VALUES (?, ?, NULL, ?, ?, ?)');
    const updTicket = db.prepare('UPDATE tickets SET estado = ?, tecnico_id = COALESCE(?, tecnico_id), motivo_rechazo = COALESCE(?, motivo_rechazo), actualizado_en = ? WHERE id = ?');
    const leerFolio = db.prepare('SELECT folio FROM tickets WHERE id = ?');

    const NOTA = {
      formulario: 'Incidencia registrada por el solicitante',
      reporte_visual: 'Reporte visual con anotaciones sobre la fotografía',
      sin_conexion: 'Reporte capturado sin conexión y sincronizado al volver la red',
      auditoria_red: 'Ticket generado desde la auditoría de red Wi-Fi'
    };
    const MODULO = { formulario: 'formulario', reporte_visual: 'reporte-visual', sin_conexion: 'sin-conexion', auditoria_red: 'auditoria-red' };
    const ticketsPorClave = {};

    [...TICKETS, ...TICKETS_EQUIPO].forEach((p, i) => {
      const [ed, niv, esp, act, cat, sev, desc, final, hAtras, hRes, tec, origen = 'formulario', foto = null, solicitante = null] = p;
      const creado = ahora - hAtras * HORA;
      const sol = solicitante ? usuarios[solicitante] : solicitantes[i % solicitantes.length];
      const tecnico = tec != null ? tecnicos[tec] : null;
      ctx(sol, MODULO[origen], creado);
      const id = Number(insTicket.run(sol.id, espacios[`${ed}|${niv}|${esp}`], act, categorias[cat], sev, desc, foto, origen, fecha(creado), fecha(creado)).lastInsertRowid);
      const folio = leerFolio.get(id).folio;
      ticketsPorClave[`${ed}|${niv}|${esp}|${act}`] = id;
      insHist.run(id, null, 'Abierto', sol.id, sol.nombre, NOTA[origen], fecha(creado));

      let estado = 'Abierto';
      const paso = (nuevo, at, quien, nota, extra = {}) => {
        ctx(quien, quien.rol === 'admin' ? 'administracion' : 'app', at);
        insHist.run(id, estado, nuevo, quien.id, quien.nombre, nota, fecha(at));
        updTicket.run(nuevo, extra.tecnico ?? null, extra.motivo ?? null, fecha(at), id);
        insNotif.run(sol.id, id, `${folio} · ${nuevo}`, mensajeEstado(nuevo, tecnico?.nombre, extra.motivo), ahora - at > 12 * HORA ? 1 : 0, fecha(at));
        estado = nuevo;
      };

      if (final === 'Rechazado') {
        const motivo = 'Ya existe una orden de obra programada para el plafón del auditorio.';
        paso('Rechazado', creado + 1.5 * HORA, admin, motivo, { motivo });
      } else if (final !== 'Abierto') {
        const lapso = hRes ?? Math.max(hAtras - 0.2, 0.5);
        paso('Asignado', creado + Math.min(0.5, lapso * 0.15) * HORA, admin, `Asignado a ${tecnico.nombre}`, { tecnico: tecnico.id });
        if (['En Proceso', 'Resuelto', 'Cerrado'].includes(final)) paso('En Proceso', creado + lapso * 0.35 * HORA, tecnico, 'Inicio de labores en sitio');
        if (['Resuelto', 'Cerrado'].includes(final)) {
          const at = creado + hRes * HORA;
          ctx(tecnico, 'app', at);
          insRes.run(id, tecnico.id, SOLUCION[cat][0], SOLUCION[cat][1], fecha(at));
          paso('Resuelto', at, tecnico, 'Trabajo concluido con evidencia');
        }
        if (final === 'Cerrado') paso('Cerrado', creado + (hRes + 2) * HORA, admin, 'Validado y cerrado por administración');
      }
    });

    // Auditorías de red Wi-Fi (módulo de Carlos): mediciones con su semáforo y, si están degradadas, su ticket
    const insRed = db.prepare(`INSERT INTO auditorias_red
      (usuario_id, espacio_id, ubicacion, latencia_ms, jitter_ms, perdida_pct, velocidad_mbps, tipo_conexion, sin_conexion,
       apt_videollamadas, apt_git, apt_descargas, degradada, ticket_id, medido_en, creado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const [ed, niv, esp, lat, jit, per, vel, tipo, sinRed, hAtras, quien, ticketDe] of AUDITORIAS) {
      const at = ahora - hAtras * HORA;
      const u = usuarios[quien];
      const apt = red.evaluar({ latencia_ms: lat, jitter_ms: jit, perdida_pct: per, velocidad_mbps: vel, sin_conexion: sinRed });
      const ticketId = ticketDe ? ticketsPorClave[`${ed}|${niv}|${esp}|${ticketDe}`] ?? null : null;
      ctx(u, 'auditoria-red', at - (ticketId ? 60000 : 0));
      const nivel = db.prepare('SELECT clave FROM niveles WHERE id = (SELECT nivel_id FROM espacios WHERE id = ?)').get(espacios[`${ed}|${niv}|${esp}`]);
      insRed.run(u.id, espacios[`${ed}|${niv}|${esp}`], `Edif. ${ed} · ${nivel.clave} · ${esp}`, sinRed ? null : lat, sinRed ? null : jit,
        sinRed ? 100 : per, sinRed ? 0 : vel, sinRed ? 'sin conexión' : tipo, sinRed ? 1 : 0,
        apt.videollamadas.etiqueta, apt.git.etiqueta, apt.descargas.etiqueta, apt.degradada ? 1 : 0, ticketId, fecha(at), fecha(at));
    }

    // Enlace de registro de demostración: el equipo lo comparte en la exposición (el admin lo puede desactivar)
    ctx(admin, 'administracion', ahora - 30 * HORA);
    db.prepare("INSERT INTO invitaciones (codigo, rol, creada_por, usos, max_usos, expira_en, creada_en) VALUES ('EXPO-2026', 'admin', ?, 0, 200, ?, ?)")
      .run(admin.id, fecha(ahora + 60 * 24 * HORA), fecha(ahora - 30 * HORA));
    db.prepare("INSERT INTO invitaciones (codigo, rol, creada_por, usos, max_usos, expira_en, creada_en) VALUES ('ALUM-2026', 'solicitante', ?, 0, 500, ?, ?)")
      .run(admin.id, fecha(ahora + 60 * 24 * HORA), fecha(ahora - 30 * HORA));

    bitacora.establecer(db, { id: null, nombre: 'Sistema' }, 'sistema');
  });
}

/* Siembra solo si la base está vacía */
function sembrarSiVacia() {
  const { n } = conexion().prepare('SELECT COUNT(*) AS n FROM usuarios').get();
  if (n === 0) {
    sembrar();
    return true;
  }
  return false;
}

module.exports = { sembrar, sembrarSiVacia, mensajeEstado, PASSWORD_DEMO };
