# CampusCare · Aplicación Web Progresiva (PWA)

Sistema para reportar y dar seguimiento a incidencias de infraestructura universitaria.
Funciona en la computadora y en el celular, se puede **instalar**, trabaja **sin conexión** y envía **notificaciones push**.

**Aplicación publicada:** <https://campuscare-r0v8.onrender.com> · Vista del servidor: <https://campuscare-r0v8.onrender.com/estado>

| Capa | Tecnología |
|---|---|
| Frontend (vistas del cliente) | HTML, CSS y JavaScript (carpeta `public/`) |
| Vistas del servidor (SSR) | Express genera `/estado` y `/reporte/:folio` (`src/vistas.js`) |
| Backend | Node.js 22 + Express (API REST) |
| Base de datos remota | SQLite (`database/campuscare.db`) |
| Datos locales y offline | IndexedDB (borrador, sesión, cola de envío) + Cache Storage del service worker |
| PWA | `manifest.webmanifest`, `sw.js`, `offline.html`, iconos en `public/icons/` |
| Notificaciones | Web Push con llaves VAPID (`web-push`) + notificaciones del sistema |
| Elementos físicos | Cámara (`getUserMedia`), GPS (`Geolocation`), vibración (`Vibration API`) |
| Seguridad | JWT (sesión de 8 h) y contraseñas cifradas con bcrypt |
| Tiempo real | Server-Sent Events (avisos instantáneos entre usuarios) |

## Proyecto integrado del equipo

Las cuatro propuestas del equipo funcionan dentro de esta misma aplicación, con el mismo diseño y la misma base de datos:

| Integrante | Módulo | Dónde está |
|---|---|---|
| Aldo Misael Leal Palafox | Mapa de calor y analítica (base de la app) | Vista *Métricas y analítica*, `/estado`, `src/vistas.js` |
| Roger Alexis Atenco Guerrero | Reporte visual: anotar la foto (flecha, círculo, lápiz y nota) y generar la orden de trabajo | Vista *Reporte visual*, `public/equipo/reporte-visual.js` |
| Carlos Manuel Ojeda Hernández | Auditoría de red Wi-Fi con semáforo de aptitud académica y modo zona muerta (escala a ticket Red/TI) | Vista *Auditoría de red Wi-Fi*, `public/equipo/auditoria-red.js`, `src/red.js`, `routes/red.js`, tabla `auditorias_red` |
| Adrián Olmedo Arango | CampusCare sin conexión: inicio de sesión sin red (PBKDF2), copia por usuario y cola de cambios con folio provisional | Vista *Modo sin conexión*, `public/equipo/sin-conexion.js`, `public/sw.js` |

Además:

- **Página de bienvenida** (`/` o `/bienvenida`): portada con contexto general, usuarios finales, módulos del equipo, alertas y QR de registro.
- **Registro por enlace o QR** (`/registro?codigo=...`): quien entra desde su teléfono recibe el rol de la invitación y la interfaz completa de ese rol. Vista *Invitar por enlace o QR*; tabla `invitaciones`. Enlaces de demostración: `EXPO-2026` (administrador) y `ALUM-2026` (alumno/docente).
- **Historial de registros**: triggers de SQLite (`src/bitacora.js`) anotan en la tabla `bitacora` cada alta, edición y borrado, con el antes y el después, la persona y el módulo desde el que se hizo.
- **Alertas críticas** en la web y en el teléfono para reportes de severidad Crítica y zonas muertas de Wi-Fi.
- En el teléfono, el botón **Más** de la barra inferior abre todas las secciones del rol.

## Características PWA

| Requisito de la actividad | Dónde está |
|---|---|
| Vistas generadas del lado del **cliente** | `public/app.js` dibuja Inicio, Reportar, Mis reportes, Dashboard, Métricas… |
| Vistas generadas del lado del **servidor** | `GET /estado` (mapa de calor y resumen) y `GET /reporte/:folio` (seguimiento público) |
| Datos **locales** | `public/pwa.js` → IndexedDB `campuscare-local`: `borradores`, `pendientes`, `sesion` |
| Datos **remotos** | API REST `/api/*` sobre SQLite |
| Datos **offline** | `public/sw.js`: app shell precargado, API "red primero" con copia en caché, cola de reportes con Background Sync |
| **Notificaciones** | `src/push.js`, `routes/push.js`, eventos `push` y `notificationclick` en `sw.js` |
| **Elementos físicos** del dispositivo | Cámara, GPS y vibración en `public/pwa.js` |

## 1. Requisitos

**Node.js 22 LTS o más reciente** (recomendado: la versión LTS actual).
Descárgalo de <https://nodejs.org>, instálalo con "Siguiente, Siguiente" y **reinicia VS Code**.

Para comprobar la versión, abre una terminal y escribe:

```
node -v
```

Debe mostrar `v22...` o un número mayor.

> SQLite viene incluido dentro de Node.js 22+. No hay que instalar MySQL, XAMPP ni ningún servidor de base de datos.

## 2. Cómo ejecutarlo (Windows + VS Code)

1. Clona el repositorio (`git clone …`) o descarga el `.zip` desde GitHub y abre la carpeta en VS Code (**Archivo → Abrir carpeta**).
2. Abre una terminal: **Terminal → Nuevo terminal**.
3. Instala las dependencias (solo la primera vez):
   ```
   npm install
   ```
4. Inicia el servidor:
   ```
   npm start
   ```
5. Abre en el navegador **http://localhost:3000**.

Para detener el servidor, presiona `Ctrl + C` en la terminal.

**Importante:** ya no se usa Live Server. La página la entrega el propio servidor en el puerto 3000.

**Desde tu celular:** conéctalo a la misma red Wi-Fi que la computadora y abre la dirección que aparece en la terminal: `En tu celular: http://192.168.x.x:3000`.

> La instalación, el service worker y las notificaciones push solo funcionan en `localhost` o con **HTTPS**. En el celular úsalos con la dirección publicada en Render (sección 8); con `http://192.168…` la app funciona, pero sin las funciones PWA.

### Si aparece "la ejecución de scripts está deshabilitada"

Esto lo provoca PowerShell en Windows. Tienes dos opciones:

- En la terminal de VS Code, cambia el tipo de terminal a **Command Prompt** (flecha junto al **+**) y vuelve a ejecutar los comandos.
- O ejecuta una sola vez este comando y vuelve a intentarlo:
  ```
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ```

### Otros problemas comunes

| Mensaje | Solución |
|---|---|
| `Tu versión de Node.js no incluye SQLite` | Instala Node.js 22 LTS o más reciente. |
| `El puerto 3000 ya está en uso` | Ya hay otra terminal con el servidor abierto: ciérrala. |
| `No hay conexión con el servidor` (en la página) | El servidor está apagado: ejecuta `npm start`. |
| `La base de datos está ocupada` | Tienes cambios sin guardar en DB Browser: presiona "Escribir cambios". |

## 3. Cuentas de demostración

Contraseña de todas: **`Campus2026`**

| Rol | Correo |
|---|---|
| Alumno / Docente | alumno@institucion.edu.mx · docente@institucion.edu.mx |
| Personal de Mantenimiento | tecnico@institucion.edu.mx · tecnico2@ · tecnico3@ |
| Administrador | admin@institucion.edu.mx |

También puedes crear cuentas nuevas con **"Crear cuenta"** en la bienvenida o con un enlace de invitación (`/registro?codigo=EXPO-2026` da rol de administrador). En el registro y el inicio de sesión basta con escribir el usuario: el dominio `@institucion.edu.mx` se completa solo.

---

## 4. La base de datos

El archivo es `database/campuscare.db`. Se crea solo la primera vez que inicias el servidor, con las tablas de `database/schema.sql` y datos de ejemplo.

| Tabla | Qué guarda | Formulario que la llena |
|---|---|---|
| `usuarios` | Cuentas, rol y contraseña cifrada | Crear cuenta · Usuarios (admin) |
| `edificios` | Edificios del campus | Catálogo del campus |
| `niveles` | Pisos de cada edificio | Catálogo del campus |
| `espacios` | Aulas, laboratorios y áreas | Catálogo del campus |
| `categorias` | Tipos de falla | Catálogo del campus |
| `severidades` | Baja / Media / Crítica y su SLA en horas | Catálogo → Severidades y SLA |
| `tickets` | Incidencias reportadas | Reportar incidencia |
| `resoluciones` | Evidencia del técnico (foto, notas, materiales) | Registrar solución |
| `historial_estados` | Cada cambio de estado (trazabilidad) | Asignar · Iniciar · Resolver · Cerrar · Rechazar |
| `notificaciones` | Avisos para cada usuario | Se generan solas en cada cambio |
| `accesos` | Bitácora de inicios de sesión (exitosos y fallidos) | Iniciar sesión · Crear cuenta |
| `vista_reporte_tickets` | **Vista** que une todo en un reporte legible | (solo lectura) |

Además, la base de datos incluye:

- **Llaves foráneas.** Por ejemplo, no se puede borrar un espacio que tiene tickets (`RESTRICT`). En cambio, al borrar un ticket se borran también su historial, su evidencia y sus notificaciones (`CASCADE`).
- **Reglas `CHECK`.** Solo acepta correos `@institucion.edu.mx`, los tres roles válidos y los seis estados válidos.
- **Trigger `tickets_folio`.** Genera el folio `CC-1001`, `CC-1002`, etc. automáticamente.
- **Índices** para acelerar las búsquedas.

Las fotografías se guardan como archivos en la carpeta `uploads/`. En la base de datos solo se guarda su ruta.

### Cómo mostrar la base de datos a tu docente

**Opción A: dentro de la aplicación.** Entra como Administrador y abre **Base de datos**. Ahí puedes:

- Ver cada tabla con sus registros, buscar y cambiar de página.
- **Agregar, editar y eliminar** registros de cualquier tabla. Las reglas de la base se respetan, así que si un borrado no está permitido verás el aviso de la llave foránea.
- Ver la **estructura** de cada tabla (columnas, llave primaria, llaves foráneas y el `CREATE TABLE`).
- Usar la **Consola SQL** para ejecutar `SELECT`, con consultas de ejemplo listas.
- **Descargar un respaldo** `.db` y **restablecer** los datos de demostración.

**Opción B: con DB Browser for SQLite** (gratis: <https://sqlitebrowser.org>).

1. Abre `database/campuscare.db`.
2. En la pestaña **Hojas de datos** puedes ver y borrar registros.
3. Después de modificar algo, presiona **Escribir cambios** (`Ctrl + S`).
4. En la aplicación, presiona **Actualizar** para ver el cambio.

**Opción C: en VS Code.** Instala la extensión **SQLite Viewer** y da clic en `campuscare.db`.

### Guion sugerido para la exposición

1. Entra como alumno y **crea una cuenta nueva** → muéstrala en la tabla `usuarios` y en `accesos`.
2. **Reporta una incidencia** con foto → aparece en `tickets` (con folio automático), en `historial_estados` y en `notificaciones`.
3. Entra como administrador en otra pestaña y **asigna un técnico** → nueva fila en `historial_estados` y el alumno recibe el aviso al instante.
4. Entra como técnico, **inicia y resuelve** con foto → fila nueva en `resoluciones`.
5. Abre la vista `vista_reporte_tickets` para ver el reporte completo con el cumplimiento del SLA.
6. **Borra** registros:
   - Una notificación, desde la campana → Avisos.
   - Un reporte en estado Abierto, con el botón "Cancelar reporte".
   - Un usuario, desde Usuarios: se borran en cascada sus tickets.
7. Intenta borrar un edificio o una categoría con tickets → la base de datos lo impide (llave foránea).
8. Prueba una consulta en la Consola SQL, por ejemplo **Tickets por estado**.

Para volver a los datos originales usa **Restablecer datos de demostración** en el panel. También puedes detener el servidor y ejecutar:

```
npm run reset-db
```

---

## 5. API REST

Todas las rutas (menos las de autenticación y el resumen público) requieren el encabezado `Authorization: Bearer <token>`.

| Método | Ruta | Descripción | Rol |
|---|---|---|---|
| POST | `/api/auth/login` | Iniciar sesión | Público |
| POST | `/api/auth/registro` | Crear cuenta | Público |
| GET | `/api/auth/yo` | Datos de la sesión | Todos |
| GET | `/api/catalogo` | Edificios, niveles, espacios, categorías, severidades | Todos |
| GET | `/api/tickets` | Tickets (según el rol) | Todos |
| POST | `/api/tickets` | Levantar incidencia | Alumno / Docente, Admin |
| POST | `/api/tickets/:folio/transicion` | Cambiar estado | Según el estado |
| DELETE | `/api/tickets/:folio` | Cancelar o eliminar ticket | Dueño (si está Abierto), Admin |
| GET | `/api/notificaciones` | Mis notificaciones | Todos |
| PATCH | `/api/notificaciones/:id/leida` | Marcar como leída | Todos |
| DELETE | `/api/notificaciones/:id` | Borrar notificación | Todos |
| GET / POST / PUT / DELETE | `/api/usuarios` | Administrar cuentas | Admin |
| POST / PUT / DELETE | `/api/catalogo/edificios`, `niveles`, `espacios`, `categorias` | Administrar catálogo | Admin |
| PUT | `/api/catalogo/severidades/:nombre` | Cambiar SLA | Admin |
| GET | `/api/admin/tablas` | Tablas y número de registros | Admin |
| GET / POST / PUT / DELETE | `/api/admin/tablas/:tabla[/:id]` | CRUD de cualquier tabla | Admin |
| POST | `/api/admin/consulta` | Consola SQL (solo SELECT) | Admin |
| GET | `/api/admin/respaldo` | Descargar el archivo .db | Admin |
| POST | `/api/admin/reset` | Restablecer datos de demostración | Admin |
| GET | `/api/eventos` | Canal de tiempo real (SSE) | Todos |
| GET | `/api/publico/mapa-calor?periodo=7\|30\|todo` | Mapa de calor agregado en el servidor (JSON) | Público |
| GET | `/api/push/clave` | Llave pública VAPID | Público |
| POST / DELETE | `/api/push/suscripcion` | Guardar o quitar la suscripción push del dispositivo | Todos |
| POST | `/api/push/prueba` | Enviar una notificación push de prueba | Todos |
| GET | `/estado` | **Vista SSR**: estado del campus y mapa de calor | Público |
| GET | `/reporte/:folio` | **Vista SSR**: seguimiento público de un reporte | Público |

## 6. Estructura del proyecto

```
CampusCare-PWA/
├── server.js              Servidor Express (punto de entrada)
├── package.json           Dependencias y comandos npm
├── render.yaml            Despliegue en Render
├── database/schema.sql    Tablas, llaves, trigger e índices (la base .db se crea sola)
├── src/
│   ├── db.js              Conexión a SQLite y migraciones
│   ├── seed.js            Datos de demostración
│   ├── auth.js            JWT y permisos por rol
│   ├── tickets.js         Máquina de estados, GPS y envío idempotente
│   ├── vistas.js          Vistas generadas en el servidor (SSR) y mapa de calor
│   ├── push.js            Notificaciones push (VAPID)
│   ├── fotos.js           Guardado de fotografías
│   ├── bitacora.js        Triggers del historial de cambios (agregado, editado, borrado)
│   ├── red.js             Auditoría Wi-Fi: semáforo y escalamiento a Red/TI
│   ├── qr.js              Códigos QR en SVG (src/vendor/QRCode, licencia MIT)
│   └── eventos.js         Tiempo real (Server-Sent Events)
├── routes/                Rutas de la API (auth, tickets, catálogo, usuarios, notificaciones, admin, push, red, invitaciones, bitácora)
├── public/
│   ├── index.html         Interfaz (vistas del cliente)
│   ├── app.js, admin.js   Lógica de la aplicación
│   ├── pwa.js, pwa.css    Funciones PWA: IndexedDB, offline, push, cámara, GPS, vibración
│   ├── equipo/            Módulos del equipo: integracion, sin-conexion, reporte-visual, auditoria-red, historial, bienvenida y equipo.css
│   ├── sw.js              Service worker
│   ├── manifest.webmanifest, offline.html, ssr.css
│   ├── icons/             Iconos de instalación
│   └── screenshots/       Capturas para la ventana de instalación
├── test/api.test.js       Pruebas del servidor
└── e2e/pwa_e2e.py         Pruebas de la PWA en el navegador
```

## 7. Pruebas

```
npm test                         # 30 pruebas del servidor (node:test)
python e2e/pwa_e2e.py http://localhost:3000      # 19 pruebas de la PWA en Chromium (requiere: pip install playwright)
python e2e/equipo_e2e.py http://localhost:3000   # 13 pruebas de los módulos del equipo
```

Las pruebas E2E abren Chromium, simulan la cámara con `e2e/camara.y4m` y el GPS con coordenadas fijas, y guardan capturas en `e2e/capturas/` y el resultado en `e2e/resultados.json`.

## 8. Publicar en internet (Render, gratis)

1. Sube este proyecto a GitHub.
2. En <https://render.com> entra con tu cuenta de GitHub → **New → Blueprint** → elige el repositorio. Render lee `render.yaml`.
3. Al terminar, Render te da una dirección `https://campuscare-xxxx.onrender.com`. Esa es la URL de la PWA (HTTPS, necesario para instalarla y para las notificaciones push).

Notas del plan gratuito: el servidor se duerme tras 15 minutos sin uso (la primera visita tarda ~50 s) y la base SQLite vuelve a los datos de demostración cuando se reinicia.

Variables de entorno opcionales: `JWT_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `DB_PATH`, `PORT`.
Si no se definen las llaves VAPID, el servidor las genera y las guarda en `database/vapid.json`.

## 9. Requerimientos cubiertos

- **RF-01** Inicio de sesión solo con `@institucion.edu.mx`, token JWT firmado por el servidor y tres roles validados en cada petición.
- **RF-02** Incidencia con ubicación jerárquica desde el catálogo de la base, foto, categoría, severidad y descripción.
- **RF-03** Máquina de estados en el servidor, con su historial en `historial_estados`.
- **RF-04** El servidor rechaza "Resuelto" si falta la foto, las notas o los materiales.
- **RF-05** Notificaciones guardadas en la base y entregadas al instante por SSE, más avisos push del navegador.
- **RF-06** Dashboard con filtros y exportación a CSV.
- **RF-07** MTTR, porcentaje de SLA y mapa de calor calculados con los datos reales.
