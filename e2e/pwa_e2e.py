"""
Pruebas de extremo a extremo de las características PWA de CampusCare.
Requisitos:  pip install playwright  y  python -m playwright install chromium
Uso:         (con el servidor encendido)  python e2e/pwa_e2e.py http://localhost:3000
Genera:      e2e/resultados.json  y capturas en e2e/capturas/
La cámara se simula con un video (e2e/camara.y4m) y el GPS con coordenadas fijas.
"""
import asyncio, json, sys, os, time
from pathlib import Path
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
AQUI = Path(__file__).parent
CAPT = AQUI / 'capturas'
CAPT.mkdir(exist_ok=True)
VIDEO = AQUI / 'camara.y4m'
UTP = {'latitude': 19.0614, 'longitude': -98.3089, 'accuracy': 15}  # coordenadas de prueba
resultados = []


def registrar(pid, criterio, descripcion, ok, detalle='', estado=None):
    estado = estado or ('Aprobada' if ok else 'Fallida')
    resultados.append({'id': pid, 'criterio': criterio, 'prueba': descripcion, 'resultado': estado, 'detalle': detalle})
    print(f"{estado:<12} {pid} {descripcion} :: {detalle}")


async def entrar(pg, correo):
    await pg.goto(BASE + '/')
    await pg.wait_for_selector('#loginEmail')
    await pg.fill('#loginEmail', correo)
    await pg.fill('#loginPass', 'Campus2026')
    await pg.click('#loginForm button[type=submit]')
    await pg.wait_for_selector('#app:not([hidden])')
    await pg.wait_for_timeout(1200)


async def sin_avisos(pg):
    """Quita los avisos emergentes antes de una captura para que no tapen la pantalla."""
    await pg.evaluate("document.querySelector('#toasts') && (document.querySelector('#toasts').innerHTML = '')")


async def llenar_reporte(pg, descripcion):
    await pg.evaluate("navegar('reportar')")
    await pg.wait_for_selector('[name=edificio]')
    await pg.select_option('[name=edificio]', 'B'); await pg.wait_for_timeout(150)
    await pg.select_option('[name=nivel]', 'PB'); await pg.wait_for_timeout(150)
    await pg.select_option('[name=espacio]', 'Aula B-102'); await pg.wait_for_timeout(150)
    activos = await pg.evaluate("[...document.querySelector('[name=activo]').options].map(o=>o.value).filter(Boolean)")
    await pg.select_option('[name=activo]', activos[0])
    await pg.click('label.cat-card:has-text("Red/TI")')
    await pg.click('label.sev-card:has-text("Media")')
    await pg.fill('textarea[name=descripcion]', descripcion)


async def main():
    async with async_playwright() as p:
        args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
        if VIDEO.exists():
            args.append(f'--use-file-for-fake-video-capture={VIDEO}')
        # Con ventana visible: el modo sin ventana de Chromium no permite notificaciones del sistema
        nav = await p.chromium.launch(args=args, headless=os.environ.get('HEADLESS') == '1')
        permisos = ['geolocation', 'camera', 'notifications', 'clipboard-read', 'clipboard-write']
        movil = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)

        # ---------------- Instalación, manifest y service worker ----------------
        ctx = await nav.new_context(viewport={'width': 1280, 'height': 860}, geolocation=UTP, permissions=permisos)
        pg = await ctx.new_page()
        cdp = await ctx.new_cdp_session(pg)
        await pg.goto(BASE + '/'); await pg.wait_for_timeout(1500)
        man = await cdp.send('Page.getAppManifest')
        errores_man = man.get('errors', [])
        inst = await cdp.send('Page.getInstallabilityErrors')
        # "in-incognito" solo indica que la prueba usa un perfil temporal (incógnito); no es un problema de la app
        errores_inst = [e['errorId'] for e in inst['installabilityErrors'] if e['errorId'] != 'in-incognito']
        registrar('E01', 'Instalación / Manifest', 'El navegador reconoce el manifest y la app es instalable',
                  not errores_man and not errores_inst,
                  f"errores de manifest: {len(errores_man)}; errores de instalación de la app: {len(errores_inst)} {errores_inst}")
        sw = await pg.evaluate("navigator.serviceWorker.ready.then(r => ({activo: !!r.active, scope: r.scope}))")
        cachés = await pg.evaluate("caches.keys()")
        shell = await pg.evaluate("caches.open('campuscare-app-v3.0.0').then(c => c.keys()).then(k => k.length)")
        registrar('E02', 'Service Worker / Caché', 'El service worker se registra y precarga el app shell',
                  sw['activo'] and shell >= 13, f"scope {sw['scope']}; cachés: {', '.join(cachés)}; archivos del app shell: {shell}")

        # ---------------- Vistas del cliente y del servidor ----------------
        sin_js = await nav.new_context(java_script_enabled=False, viewport={'width': 1100, 'height': 900})
        pj = await sin_js.new_page()
        await pj.goto(BASE + '/estado')
        celdas = await pj.locator('table.hm td').count()
        await pj.screenshot(path=str(CAPT / '01_ssr_estado_sin_js.png'), full_page=True)
        await pj.goto(BASE + '/')
        vista_cliente = len((await pj.locator('#view').inner_html()).strip())
        registrar('E03', 'Vistas del servidor', 'La página /estado se genera en el servidor (funciona sin JavaScript)',
                  celdas > 20, f"{celdas} celdas del mapa de calor recibidas como HTML con JavaScript desactivado")
        registrar('E04', 'Vistas del cliente', 'Las vistas de la app se generan en el navegador (sin JavaScript quedan vacías)',
                  vista_cliente == 0, f"contenido de #view sin JavaScript: {vista_cliente} caracteres")
        await sin_js.close()

        # ---------------- Datos remotos, cámara, GPS y vibración ----------------
        # Registro de las llamadas a la API de vibración (se conserva entre recargas)
        await pg.add_init_script("""const _v = navigator.vibrate?.bind(navigator);
          navigator.vibrate = p => { const l = JSON.parse(localStorage.getItem('__vib') || '[]'); l.push(p);
            localStorage.setItem('__vib', JSON.stringify(l)); return _v ? _v(p) : true; };""")
        await entrar(pg, 'alumno@institucion.edu.mx')
        tickets = await pg.evaluate("DB.tickets.length")
        registrar('E05', 'Datos remotos', 'Los reportes se cargan desde la API REST y la base SQLite', tickets > 0, f"{tickets} reportes recibidos de /api/tickets")
        await sin_avisos(pg)
        await pg.screenshot(path=str(CAPT / '02_cliente_inicio.png'))
        await llenar_reporte(pg, 'El proyector del aula B-102 no proyecta imagen; prueba con cámara y GPS.')
        await pg.click('[data-action=camara]')
        await pg.wait_for_function("document.querySelector('#camVideo')?.videoWidth > 0", timeout=10000)
        await pg.wait_for_timeout(600)
        await pg.screenshot(path=str(CAPT / '03_camara_en_vivo.png'))
        await pg.click('#camShot'); await pg.wait_for_timeout(300)
        foto = await pg.evaluate("state.reporte.foto")
        registrar('E06', 'Elementos físicos: cámara', 'Se toma la foto de evidencia con la cámara (getUserMedia)',
                  foto.startswith('data:image/jpeg'), f"imagen JPEG capturada de {len(foto) // 1024} KB")
        await pg.click('[data-action=gps]'); await pg.wait_for_selector('.gps-ok')
        gps = await pg.evaluate("state.reporte.gps")
        registrar('E07', 'Elementos físicos: GPS', 'Se adjuntan las coordenadas del dispositivo (Geolocation API)',
                  abs(gps['lat'] - UTP['latitude']) < 1e-6, f"lat {gps['lat']}, lng {gps['lng']}, precisión {gps['precision']} m")
        await pg.locator('#gpsStep').scroll_into_view_if_needed()
        await sin_avisos(pg)
        await pg.screenshot(path=str(CAPT / '04_reporte_foto_gps.png'))

        # ---------------- Datos locales: borrador en IndexedDB ----------------
        await pg.wait_for_timeout(700)
        await pg.reload(); await pg.wait_for_selector('#app:not([hidden])'); await pg.wait_for_timeout(800)
        await pg.evaluate("navegar('reportar')"); await pg.wait_for_timeout(500)
        recuperado = await pg.evaluate("({desc: state.reporte.descripcion, foto: !!state.reporte.foto, gps: !!state.reporte.gps})")
        aviso = await pg.locator('.draft-note').count()
        registrar('E08', 'Datos locales', 'El borrador del reporte se guarda en IndexedDB y se recupera al recargar',
                  recuperado['foto'] and recuperado['gps'] and aviso == 1, f"descripción, foto y GPS recuperados: {recuperado}")
        await sin_avisos(pg)
        await pg.screenshot(path=str(CAPT / '05_borrador_recuperado.png'))

        # ---------------- Datos offline: cola y sincronización ----------------
        await ctx.set_offline(True); await pg.wait_for_timeout(300)
        await pg.click('[data-form=reporte] button[type=submit]'); await pg.wait_for_timeout(900)
        pendientes = await pg.evaluate("LocalDB.todos('pendientes').then(r => r.length)")
        await pg.screenshot(path=str(CAPT / '06_offline_pendiente.png'))
        registrar('E09', 'Datos offline', 'Sin internet el reporte se guarda en la cola local (IndexedDB)', pendientes == 1, f"{pendientes} reporte(s) en la cola")
        desde_cache = await pg.evaluate("fetch('/api/tickets', {headers: {Authorization: 'Bearer ' + Auth.token()}}).then(r => r.headers.get('X-Desde-Cache'))")
        registrar('E10', 'Funcionamiento sin conexión', 'Sin internet la API responde con la última copia guardada por el service worker',
                  desde_cache == 'service-worker', f"cabecera X-Desde-Cache: {desde_cache}")
        await pg.reload(); await pg.wait_for_timeout(1500)
        abre = await pg.evaluate("!document.querySelector('#app').hidden || !document.querySelector('#login').hidden")
        registrar('E11', 'Funcionamiento sin conexión', 'La aplicación vuelve a abrir sin internet desde la caché', abre, 'recarga completa en modo avión')
        await pg.screenshot(path=str(CAPT / '07_offline_recarga.png'))
        antes = await pg.evaluate("DB.tickets.length")
        await ctx.set_offline(False)
        for _ in range(40):  # hasta 20 s para que el service worker envíe la cola
            await pg.wait_for_timeout(500)
            cola = await pg.evaluate("LocalDB.todos('pendientes').then(r => r.length)")
            despues = await pg.evaluate("DB.tickets.length")
            if cola == 0 and despues == antes + 1:
                break
        await pg.wait_for_timeout(800)
        registrar('E12', 'Actualización de datos', 'Al volver la conexión la cola se envía sola al servidor', despues == antes + 1, f"reportes antes: {antes}, después: {despues}")
        await pg.screenshot(path=str(CAPT / '08_reenvio_automatico.png'))
        vib = await pg.evaluate("JSON.parse(localStorage.getItem('__vib') || '[]')")
        registrar('E13', 'Elementos físicos: vibración', 'La app hace vibrar el dispositivo al capturar, ubicar y enviar', len(vib) >= 3, f"patrones enviados: {vib}")

        # ---------------- Sesión persistente ----------------
        p2 = await ctx.new_page()
        await p2.goto(BASE + '/'); await p2.wait_for_timeout(2500)
        sesion = await p2.evaluate("!document.querySelector('#app').hidden && !!Auth.sesion()")
        registrar('E14', 'Persistencia de sesión', 'Al abrir la app de nuevo la sesión se recupera desde IndexedDB', sesion, 'pestaña nueva sin sessionStorage')
        await p2.close()

        # ---------------- Tiempo real y notificaciones ----------------
        admin_ctx = await nav.new_context(viewport={'width': 1280, 'height': 860})
        pa = await admin_ctx.new_page()
        await entrar(pa, 'admin@institucion.edu.mx')
        folio = await pg.evaluate("DB.tickets.filter(t => t.estado === 'Abierto' && t.solicitante.email === Auth.sesion().email).sort((a,b) => b.createdAt - a.createdAt)[0].id")
        await pa.evaluate(f"api('/tickets/{folio}/transicion', {{method: 'POST', body: {{estado: 'Asignado', tecnico: 'tecnico@institucion.edu.mx'}}}})")
        await pg.wait_for_function(f"DB.ticket('{folio}')?.estado === 'Asignado'", timeout=10000)
        registrar('E15', 'Actualización de datos', 'Un cambio hecho por otro usuario aparece sin recargar (Server-Sent Events)', True, f"{folio} pasó a Asignado en la pantalla del alumno")
        await pg.wait_for_timeout(800)
        avisos = await pg.evaluate("navigator.serviceWorker.ready.then(r => r.getNotifications()).then(n => n.map(x => x.title))")
        registrar('E16', 'Notificaciones', 'El cambio de estado se muestra como notificación del sistema', any(folio in a for a in avisos), f"notificaciones visibles: {avisos[:3]}")
        await pg.evaluate("navegar('notificaciones')"); await pg.wait_for_timeout(500)
        intento = await pg.evaluate("""(async () => { try { const r = await navigator.serviceWorker.ready;
            const {clave} = await api('/push/clave');
            const s = await r.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64aBytes(clave)});
            await api('/push/suscripcion', {method: 'POST', body: s.toJSON()}); return 'suscrito: ' + new URL(s.endpoint).host; }
            catch (e) { return 'sin servicio push en este navegador de pruebas: ' + e.message; } })()""")
        if intento.startswith('suscrito'):
            registrar('E17', 'Notificaciones push', 'Suscripción Web Push con la llave VAPID del servidor', True, intento)
        else:
            registrar('E17', 'Notificaciones push', 'Suscripción Web Push con la llave VAPID del servidor', False, intento, estado='Manual')
        await pg.screenshot(path=str(CAPT / '09_notificaciones.png'))
        await admin_ctx.close()

        # ---------------- Compartir ----------------
        await pg.evaluate(f"abrirDetalle('{folio}')"); await pg.wait_for_timeout(400)
        await sin_avisos(pg)
        await pg.screenshot(path=str(CAPT / '10_detalle_compartir.png'))
        await pg.click('[data-action=compartir]'); await pg.wait_for_timeout(400)
        copiado = await pg.evaluate("navigator.clipboard.readText()")
        registrar('E18', 'Integración con el dispositivo', 'Compartir el seguimiento (Web Share o portapapeles)', copiado.endswith(f'/reporte/{folio}'), copiado)
        await ctx.close()

        # ---------------- Diseño responsivo (celular) ----------------
        mc = await nav.new_context(**movil, geolocation=UTP, permissions=permisos)
        pm = await mc.new_page()
        await pm.goto(BASE + '/'); await pm.wait_for_timeout(1200)
        await pm.screenshot(path=str(CAPT / '11_movil_login.png'))
        await entrar(pm, 'alumno@institucion.edu.mx')
        ancho = await pm.evaluate("document.documentElement.scrollWidth")
        barra = await pm.is_visible('#bottomNav')
        registrar('E19', 'Diseño responsivo', 'En 390 px de ancho se usa la barra inferior y no hay desplazamiento horizontal', barra and ancho <= 390, f"ancho del documento: {ancho}px; barra inferior visible: {barra}")
        await sin_avisos(pm)
        await pm.screenshot(path=str(CAPT / '12_movil_inicio.png'))
        await pm.evaluate("navegar('reportar')"); await pm.wait_for_timeout(500)
        await sin_avisos(pm)
        await pm.screenshot(path=str(CAPT / '13_movil_reportar.png'))
        await mc.set_offline(True); await pm.wait_for_timeout(400)
        await pm.evaluate("navegar('mis-tickets')"); await pm.wait_for_timeout(500)
        await pm.screenshot(path=str(CAPT / '14_movil_offline.png'))
        await mc.set_offline(False)
        await pm.goto(BASE + '/estado'); await pm.wait_for_timeout(800)
        await pm.screenshot(path=str(CAPT / '15_movil_ssr_estado.png'), full_page=True)
        await pm.goto(BASE + f'/reporte/{folio}'); await pm.wait_for_timeout(600)
        await pm.screenshot(path=str(CAPT / '16_movil_ssr_reporte.png'), full_page=True)
        await mc.close()

        # ---------------- Mapa de calor generado en el cliente (administrador) ----------------
        ac = await nav.new_context(viewport={'width': 1280, 'height': 860})
        pa = await ac.new_page()
        await entrar(pa, 'admin@institucion.edu.mx')
        await pa.evaluate("navegar('metricas')"); await pa.wait_for_timeout(600)
        await pa.locator('.heatmap-wrap').scroll_into_view_if_needed()
        await sin_avisos(pa)
        await pa.screenshot(path=str(CAPT / '17_cliente_mapa_calor.png'))
        await ac.close()
        await nav.close()

    (AQUI / 'resultados.json').write_text(json.dumps({'fecha': time.strftime('%Y-%m-%d %H:%M'), 'base': BASE, 'resultados': resultados}, ensure_ascii=False, indent=2), encoding='utf-8')
    aprobadas = sum(r['resultado'] == 'Aprobada' for r in resultados)
    print(f"\n{aprobadas} de {len(resultados)} pruebas aprobadas")

asyncio.run(main())
