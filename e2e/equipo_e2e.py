"""
Pruebas de extremo a extremo de la integración del equipo.
Uso:  (con el servidor encendido)  python e2e/equipo_e2e.py http://localhost:3000
Genera e2e/resultados_equipo.json y capturas en e2e/capturas/equipo-*.png
"""
import asyncio, json, sys, re
from pathlib import Path
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
AQUI = Path(__file__).parent
CAPT = AQUI / 'capturas'
CAPT.mkdir(exist_ok=True)
resultados = []
MOVIL = {'viewport': {'width': 390, 'height': 844}, 'is_mobile': True, 'has_touch': True, 'device_scale_factor': 2}


def registrar(pid, modulo, prueba, ok, detalle=''):
    estado = 'Aprobada' if ok else 'Fallida'
    resultados.append({'id': pid, 'modulo': modulo, 'prueba': prueba, 'resultado': estado, 'detalle': detalle})
    print(f'{estado:<9} {pid} [{modulo}] {prueba} :: {detalle}')


async def limpiar(pg):
    await pg.evaluate("document.querySelector('#toasts').innerHTML=''")


async def entrar(pg, correo):
    await pg.goto(BASE + '/entrar')
    await pg.wait_for_selector('#loginEmail', state='visible')
    await pg.fill('#loginEmail', correo)
    await pg.fill('#loginPass', 'Campus2026')
    await pg.click('#loginForm button[type=submit]')
    await pg.wait_for_selector('#app:not([hidden])')
    await pg.wait_for_timeout(1200)


async def ubicar(pg, form, ed='B', niv='PB', esp='Aula B-102', activo=True):
    sel = f'[data-form="{form}"]'
    await pg.select_option(f'{sel} [name=edificio]', ed); await pg.wait_for_timeout(120)
    await pg.select_option(f'{sel} [name=nivel]', niv); await pg.wait_for_timeout(120)
    await pg.select_option(f'{sel} [name=espacio]', esp); await pg.wait_for_timeout(120)
    if activo:
        ops = await pg.evaluate(f"[...document.querySelector('{sel} [name=activo]').options].map(o=>o.value).filter(Boolean)")
        await pg.select_option(f'{sel} [name=activo]', ops[1])


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch()

        # ---------- Bienvenida y registro por enlace desde el teléfono ----------
        ctx = await nav.new_context(**MOVIL)
        pg = await ctx.new_page()
        errores = []
        pg.on('pageerror', lambda e: errores.append(str(e)))
        await pg.goto(BASE + '/')
        await pg.wait_for_timeout(1200)
        visible = await pg.is_visible('#bienvenida')
        secciones = await pg.evaluate("['bv-contexto','bv-usuarios','bv-modulos','bv-alertas','bv-registro'].every(id => document.getElementById(id))")
        qr = await pg.evaluate("document.querySelector('#bvQR').naturalWidth > 0")
        registrar('E01', 'Bienvenida', 'La portada muestra contexto, usuarios finales, módulos, alertas y QR de registro', visible and secciones and qr)
        await pg.screenshot(path=str(CAPT / 'equipo-01-bienvenida-movil.png'), full_page=True)

        await pg.goto(BASE + '/registro?codigo=EXPO-2026')
        await pg.wait_for_selector('#registroForm', state='visible')
        await pg.wait_for_timeout(600)
        aviso = await pg.inner_text('#regInvitacion')
        await pg.fill('#regNombre', 'Invitado Exposición')
        await pg.fill('#regEmail', 'invitado.expo')  # el dominio se completa solo
        await pg.fill('#regPass', 'Expo2026')
        await pg.fill('#regPass2', 'Expo2026')
        await pg.screenshot(path=str(CAPT / 'equipo-02-registro-enlace.png'))
        await pg.click('#registroForm button[type=submit]')
        await pg.wait_for_selector('#app:not([hidden])')
        await pg.wait_for_timeout(1200)
        rol = await pg.inner_text('#sideRole')
        registrar('E02', 'Registro por enlace', 'El enlace EXPO-2026 registra desde el teléfono con rol de administrador', 'Administrador' in aviso and rol == 'Administrador', f'rol: {rol}')

        await pg.click('[data-mas]')
        await pg.wait_for_timeout(400)
        tiles = await pg.evaluate("document.querySelectorAll('.mas-tile').length")
        await pg.screenshot(path=str(CAPT / 'equipo-03-menu-mas.png'))
        await pg.click('.mas-tile[data-view="usuarios"]')
        await pg.wait_for_timeout(800)
        registrar('E03', 'Interfaz móvil', 'El menú "Más" da acceso a todas las secciones del rol desde el teléfono', tiles >= 12 and await pg.evaluate("state.vista") == 'usuarios', f'{tiles} secciones')

        # Crear un usuario desde el teléfono (lo mismo que en la computadora)
        creado = await pg.evaluate("""async () => {
          await api('/usuarios', { method: 'POST', body: { nombre: 'Alumno Creado Móvil', correo: 'creado.movil@institucion.edu.mx', rol: 'solicitante', password: 'Movil2026' } });
          return (await api('/usuarios')).some(u => u.correo === 'creado.movil@institucion.edu.mx');
        }""")
        registrar('E04', 'Interfaz móvil', 'Quien entró por el enlace puede crear usuarios', creado)

        # ---------- Reporte visual (Roger) ----------
        await pg.evaluate("navegar('reporte-visual')")
        await pg.wait_for_timeout(500)
        await pg.click('[data-action="vis-ejemplo"]')
        await pg.wait_for_timeout(800)
        caja = await pg.locator('#lienzoVisual').bounding_box()
        await pg.mouse.move(caja['x'] + 60, caja['y'] + 150)
        await pg.mouse.down(); await pg.mouse.move(caja['x'] + 200, caja['y'] + 60, steps=8); await pg.mouse.up()
        await pg.click('[data-action="vis-herramienta"][data-h="circulo"]')
        await pg.mouse.move(caja['x'] + 180, caja['y'] + 30)
        await pg.mouse.down(); await pg.mouse.move(caja['x'] + 260, caja['y'] + 80, steps=8); await pg.mouse.up()
        marcas = await pg.evaluate("Visual.trazos.length")
        await ubicar(pg, 'visual', 'B', 'N1', 'Aula B-201')
        await pg.select_option('[data-form="visual"] [name=categoria]', 'Red/TI')
        await pg.click('.vis-sev label:has-text("Media")')
        await pg.fill('[data-form="visual"] textarea[name=descripcion]', 'El proyector enciende pero no proyecta imagen; marcado en la foto.')
        await pg.click('[data-action="vis-generar"]')
        await pg.wait_for_timeout(700)
        borrador = await pg.is_visible('#visOrden')
        await pg.click('[data-form="visual"] button[type=submit]')
        await pg.wait_for_timeout(2000)
        folio_visual = await pg.evaluate("Visual.ultimoFolio")
        origen = await pg.evaluate(f"DB.ticket('{folio_visual}')?.origen")
        await limpiar(pg)
        await pg.screenshot(path=str(CAPT / 'equipo-04-reporte-visual.png'), full_page=True)
        registrar('E05', 'Reporte visual', 'Se dibuja sobre la foto, se genera la orden y se envía con folio real', marcas == 2 and borrador and bool(folio_visual) and origen == 'reporte_visual', f'{folio_visual} · {origen}')
        await ctx.close()

        # ---------- Auditoría Wi-Fi (Carlos) y sin conexión (Adrián) en escritorio ----------
        ctx = await nav.new_context(viewport={'width': 1366, 'height': 860})
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: errores.append(str(e)))
        await entrar(pg, 'alumno@institucion.edu.mx')
        await pg.evaluate("navegar('red')")
        await pg.wait_for_timeout(400)
        await pg.click('[data-action="red-medir"]')
        await pg.wait_for_selector('.red-semaforo', timeout=15000)
        r = await pg.evaluate("Red.resultado")
        await pg.click('[data-form="red"] button[data-escalar="0"]')
        await pg.wait_for_timeout(1200)
        registrar('E06', 'Auditoría Wi-Fi', 'Mide latencia, jitter y velocidad y guarda la medición', not r['offline'] and r['velocidad_mbps'] > 0, f"{r['latencia_ms']} ms · {r['velocidad_mbps']} Mbps · {r['aptitud']['videollamadas']['etiqueta']}")

        # Zona muerta sin conexión → cola → ticket Red/TI al volver la red
        await pg.evaluate("navegar('sin-conexion')")
        await pg.wait_for_timeout(400)
        await pg.click('[data-action="simular-offline"]')
        await pg.wait_for_timeout(600)
        await pg.evaluate("navegar('red')")
        await pg.wait_for_timeout(500)
        await pg.click('[data-action="red-medir"]')
        await pg.wait_for_selector('.zona-muerta', timeout=8000)
        await limpiar(pg)
        await pg.screenshot(path=str(CAPT / 'equipo-05-zona-muerta.png'), full_page=True)
        await ubicar(pg, 'red', 'C', 'PB', 'Acervo general', activo=False)
        await pg.click('[data-form="red"] button[data-escalar="1"]')
        await pg.wait_for_timeout(1000)
        en_cola_red = await pg.evaluate("PWA.pendientes.filter(p => p.tipo === 'auditoria').length")

        # Reporte con formulario sin conexión (folio provisional)
        await pg.evaluate("navegar('reportar')")
        await pg.wait_for_selector('[data-form="reporte"] [name=edificio]')
        await ubicar(pg, 'reporte', 'D', 'N1', 'Lab. de Cómputo 2')
        await pg.click('label.cat-card:has-text("Eléctrica")')
        await pg.click('label.sev-card:has-text("Media")')
        await pg.fill('[data-form="reporte"] textarea[name=descripcion]', 'Contacto sin energía en la mesa 3 (reportado sin conexión).')
        await pg.evaluate("state.reporte.foto = document.createElement('canvas').toDataURL('image/png')")
        await pg.click('[data-form="reporte"] button[type=submit]')
        await pg.wait_for_timeout(1200)
        local = await pg.evaluate("DB.tickets.find(t => t.local)?.id")
        # Edición de un reporte existente sin conexión
        abierto = await pg.evaluate("DB.tickets.find(t => !t.local && t.estado === 'Abierto' && t.solicitante.email === Auth.sesion().email)?.id")
        if abierto:
            await pg.evaluate(f"Tickets.editar('{abierto}', {{ severidad: 'Baja' }})")
        await pg.wait_for_timeout(500)
        cola = await pg.evaluate("PWA.pendientes.map(p => p.tipo || 'crear')")
        await pg.evaluate("navegar('sin-conexion')")
        await pg.wait_for_timeout(600)
        await limpiar(pg)
        await pg.screenshot(path=str(CAPT / 'equipo-06-cola-sin-conexion.png'), full_page=True)
        registrar('E07', 'Sin conexión', 'Sin red: auditoría, reporte nuevo (folio LOCAL) y edición quedan en la cola', en_cola_red == 1 and bool(local and local.startswith('LOCAL-')) and len(cola) >= 3, f'{local} · cola {cola}')

        # Volver a conectar: la cola se envía en orden
        await pg.click('[data-action="simular-offline"]')
        for _ in range(20):
            await pg.wait_for_timeout(700)
            if await pg.evaluate("(async () => (await LocalDB.todos('pendientes')).length)()") == 0:
                break
        await pg.wait_for_timeout(1500)
        quedan = await pg.evaluate("(async () => (await LocalDB.todos('pendientes')).length)()")
        tickets = await pg.evaluate("api('/tickets').then(T => T.map(t => ({ id: t.id, origen: t.origen, categoria: t.categoria, sev: t.severidad, desc: t.descripcion })))")
        red_ticket = next((t for t in tickets if t['origen'] == 'auditoria_red' and 'Zona muerta' in t['desc'] and 'Acervo' in t['desc']), None)
        sin_con = next((t for t in tickets if t['origen'] == 'sin_conexion' and 'mesa 3' in t['desc']), None)
        editado = next((t for t in tickets if t['id'] == abierto), None)
        registrar('E08', 'Sin conexión', 'Al volver la red la cola se sincroniza y recibe folios reales', quedan == 0 and red_ticket is not None and sin_con is not None and (not abierto or editado['sev'] == 'Baja'),
                  f"red: {red_ticket and red_ticket['id']} ({red_ticket and red_ticket['sev']}) · reporte: {sin_con and sin_con['id']}")
        registrar('E09', 'Auditoría Wi-Fi', 'La zona muerta se escaló a Red/TI con severidad Crítica', bool(red_ticket) and red_ticket['categoria'] == 'Red/TI' and red_ticket['sev'] == 'Crítica')

        # Inicio de sesión sin conexión (PBKDF2)
        await pg.evaluate("cerrarSesion()")
        await pg.goto(BASE + '/entrar')
        await pg.wait_for_selector('#loginEmail', state='visible')
        await pg.evaluate("cambiarSimulacion(true)")
        await pg.wait_for_timeout(300)
        await pg.fill('#loginEmail', 'alumno@institucion.edu.mx')
        await pg.fill('#loginPass', 'Incorrecta1')
        await pg.click('#loginForm button[type=submit]')
        await pg.wait_for_timeout(2500)
        rechazo = await pg.inner_text('#loginForm .alert-error')
        await pg.fill('#loginPass', 'Campus2026')
        await pg.click('#loginForm button[type=submit]')
        await pg.wait_for_selector('#app:not([hidden])', timeout=15000)
        await pg.wait_for_timeout(1500)
        n = await pg.evaluate("DB.tickets.length")
        await limpiar(pg)
        await pg.screenshot(path=str(CAPT / 'equipo-07-login-sin-conexion.png'))
        registrar('E10', 'Sin conexión', 'Entra sin internet con la contraseña verificada por PBKDF2 y ve sus datos guardados', 'incorrecta' in rechazo.lower() and n > 0, f'{n} reportes desde la copia local')
        await pg.evaluate("cambiarSimulacion(false)")
        await pg.wait_for_timeout(800)

        # ---------- Bitácora (admin) y alerta crítica ----------
        ctx2 = await nav.new_context(viewport={'width': 1366, 'height': 860})
        adm = await ctx2.new_page()
        adm.on('pageerror', lambda e: errores.append(str(e)))
        await entrar(adm, 'admin@institucion.edu.mx')
        await adm.evaluate("navegar('historial')")
        await adm.wait_for_timeout(1500)
        modulos = await adm.evaluate("Bitacora.datos.modulos.map(m => m.clave)")
        ops = await adm.evaluate("Bitacora.datos.resumen")
        registrar('E11', 'Historial de registros', 'La bitácora muestra altas, ediciones y bajas por módulo del equipo',
                  all(m in modulos for m in ['reporte-visual', 'auditoria-red', 'sin-conexion', 'enlace']) and ops['INSERT'] > 0 and ops['UPDATE'] > 0, f'{ops} · módulos {modulos}')
        await adm.click('[data-action="bit-modulo"][data-m="sin-conexion"]')
        await adm.wait_for_timeout(1000)
        await adm.click('.bit-item [data-action="bit-detalle"] >> nth=0')
        await adm.wait_for_timeout(400)
        await adm.screenshot(path=str(CAPT / 'equipo-08-bitacora-detalle.png'))
        await adm.evaluate("cerrarModal()")

        # El alumno levanta un reporte Crítico → al admin le llega una alerta crítica
        await pg.evaluate("""Tickets.crear({ edificio: 'A', nivel: 'PB', espacio: 'Recepción', activo: 'Contactos / apagadores', categoria: 'Eléctrica', severidad: 'Crítica',
          descripcion: 'Chispas en el contacto de la recepción, riesgo eléctrico.', foto: document.createElement('canvas').toDataURL('image/png') })""")
        try:
            await adm.wait_for_selector('#alertaCritica:not([hidden])', timeout=8000)
            alerta = await adm.inner_text('#alertaCritica')
        except Exception:
            alerta = ''
        await adm.screenshot(path=str(CAPT / 'equipo-09-alerta-critica.png'))
        registrar('E12', 'Alertas', 'Un reporte Crítico llega al administrador como alerta crítica en tiempo real', 'Alerta crítica' in alerta, alerta.split('\n')[0] if alerta else 'sin alerta')

        registrar('E13', 'General', 'Sin errores de JavaScript en las páginas', not errores, '; '.join(errores[:3]))
        await nav.close()

    (AQUI / 'resultados_equipo.json').write_text(json.dumps(resultados, ensure_ascii=False, indent=2), encoding='utf-8')
    ok = sum(r['resultado'] == 'Aprobada' for r in resultados)
    print(f'\n{ok} de {len(resultados)} pruebas aprobadas')

asyncio.run(main())
