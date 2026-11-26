"""
Pruebas del monitoreo físico (Arduino) sin hardware: se simula el puerto
serie del navegador (Web Serial) y se le "escriben" líneas como las del Arduino.
Uso: python e2e/sensores_e2e.py http://localhost:3000
"""
import asyncio, json, sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
CAPT = Path(__file__).parent / 'capturas'
CAPT.mkdir(exist_ok=True)
resultados = []

SERIAL_FALSO = """
(() => {
  let ctrl;
  const enviados = [];
  const puerto = {
    readable: null, writable: null,
    async open() {
      this.readable = new ReadableStream({ start(c) { ctrl = c; } });
      this.writable = new WritableStream({ write(ch) { enviados.push(new TextDecoder().decode(ch)); } });
    },
    async close() {}
  };
  const serial = new EventTarget();
  serial.requestPort = async () => puerto;
  Object.defineProperty(navigator, 'serial', { value: serial, configurable: true });
  window.__arduino = {
    linea(obj) { ctrl.enqueue(new TextEncoder().encode(JSON.stringify(obj) + '\\n')); },
    enviados
  };
})();
"""

def registrar(pid, prueba, ok, detalle=''):
    resultados.append({'id': pid, 'prueba': prueba, 'resultado': 'Aprobada' if ok else 'Fallida', 'detalle': detalle})
    print(f"{'Aprobada' if ok else 'Fallida':<9} {pid} {prueba} :: {detalle}")

async def entrar(pg, correo):
    await pg.goto(BASE + '/entrar')
    await pg.wait_for_selector('#loginEmail', state='visible')
    await pg.fill('#loginEmail', correo); await pg.fill('#loginPass', 'Campus2026')
    await pg.click('#loginForm button[type=submit]')
    await pg.wait_for_selector('#app:not([hidden])'); await pg.wait_for_timeout(1200)

async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch()
        errores = []
        ctx = await nav.new_context(viewport={'width': 1366, 'height': 900})
        await ctx.add_init_script(SERIAL_FALSO)
        pg = await ctx.new_page(); pg.on('pageerror', lambda e: errores.append(str(e)))
        await entrar(pg, 'admin@institucion.edu.mx')

        # Otro dispositivo (alumno, teléfono) mirando en vivo
        ctx2 = await nav.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        tel = await ctx2.new_page(); tel.on('pageerror', lambda e: errores.append(str(e)))
        await entrar(tel, 'alumno@institucion.edu.mx')
        await tel.evaluate("navegar('sensores')"); await tel.wait_for_timeout(800)

        await pg.evaluate("navegar('sensores')"); await pg.wait_for_timeout(600)
        await pg.click('[data-action="mon-conectar"]'); await pg.wait_for_timeout(400)
        conectado = await pg.evaluate("Monitor.modo")
        normal = {'luz': 120, 'oscuro': 0, 'flama': 0, 'flamaRaw': 1015, 'agua': 560, 'alarma': 1}
        for _ in range(6):
            await pg.evaluate(f"__arduino.linea({json.dumps(normal)})"); await pg.wait_for_timeout(250)
        lec = await pg.evaluate("Monitor.lectura")
        registrar('S01', 'Conecta el Arduino por Web Serial y convierte las lecturas', conectado == 'arduino' and lec['luz'] > 90 and 50 <= lec['agua'] <= 60 and not lec['fuego'], json.dumps(lec))

        # Encendedor cerca durante 2 s
        fuego = {**normal, 'flama': 1, 'flamaRaw': 280}
        for _ in range(9):
            await pg.evaluate(f"__arduino.linea({json.dumps(fuego)})"); await pg.wait_for_timeout(250)
        await pg.wait_for_timeout(1500)
        en_fuego = await pg.evaluate("document.querySelector('#esc-flama').classList.contains('en-fuego')")
        ev = await pg.evaluate("(Monitor.eventos||[]).find(e => e.estado === 'fuego')")
        await pg.evaluate("document.querySelector('#toasts').innerHTML=''")
        await pg.screenshot(path=str(CAPT / 'sensores-01-fuego-escritorio.png'), full_page=True)
        registrar('S02', 'La flama sostenida anima el fuego y crea evento con reporte', en_fuego and bool(ev) and bool(ev.get('folio')), json.dumps(ev))
        alerta_tel = await tel.evaluate("!!document.querySelector('#alertaCritica:not([hidden])')")
        fuego_tel = await tel.evaluate("document.querySelector('#esc-flama')?.classList.contains('en-fuego')")
        await tel.evaluate("document.querySelector('#toasts').innerHTML=''")
        await tel.screenshot(path=str(CAPT / 'sensores-02-telefono-en-vivo.png'))
        registrar('S03', 'El teléfono ve el fuego en vivo y recibe la alerta', bool(fuego_tel) and alerta_tel)

        # Apagar la luz y vaciar la cisterna
        oscuro = {**normal, 'luz': 990, 'oscuro': 1, 'agua': 60}
        for _ in range(9):
            await pg.evaluate(f"__arduino.linea({json.dumps(oscuro)})"); await pg.wait_for_timeout(250)
        await pg.wait_for_timeout(1500)
        est = await pg.evaluate("[estadosLocales(Monitor.lectura), (Monitor.eventos||[]).slice(0,4).map(e=>e.sensor+':'+e.estado)]")
        registrar('S04', 'Luz apagada y cisterna baja generan sus eventos', est[0]['luz'] == 'apagada' and est[0]['agua'] == 'bajo' and 'luz:apagada' in est[1] and 'agua:bajo' in est[1], json.dumps(est))
        await pg.evaluate("document.querySelector('#toasts').innerHTML=''")
        await pg.screenshot(path=str(CAPT / 'sensores-03-luz-cisterna.png'), full_page=True)

        # Comandos de regreso al Arduino
        await pg.click('[data-action="mon-alarma"]'); await pg.click('[data-action="mon-probar"]'); await pg.wait_for_timeout(300)
        enviados = await pg.evaluate("__arduino.enviados.join('')")
        registrar('S05', 'La página manda comandos al Arduino (silenciar y probar)', enviados == 'ST', enviados)

        # Modo demostración (sin Arduino) en otra sesión
        await pg.click('[data-action="mon-desconectar"]'); await pg.wait_for_timeout(300)
        await pg.click('[data-action="mon-demo"]'); await pg.wait_for_timeout(300)
        await pg.fill('[data-demo="agua"]', '95'); await pg.dispatch_event('[data-demo="agua"]', 'input')
        await pg.wait_for_timeout(2500)
        demo = await pg.evaluate("(Monitor.eventos||[]).find(e => e.estado === 'desbordamiento' && e.fuente === 'demo')")
        await pg.evaluate("document.querySelector('#toasts').innerHTML=''")
        await pg.screenshot(path=str(CAPT / 'sensores-04-demostracion.png'), full_page=True)
        registrar('S06', 'El modo demostración funciona sin Arduino', bool(demo), json.dumps(demo))

        await adm_bitacora(pg)
        registrar('S07', 'Sin errores de JavaScript', not errores, '; '.join(errores[:3]))
        await nav.close()
    (Path(__file__).parent / 'resultados_sensores.json').write_text(json.dumps(resultados, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"\n{sum(r['resultado'] == 'Aprobada' for r in resultados)} de {len(resultados)} pruebas aprobadas")

async def adm_bitacora(pg):
    r = await pg.evaluate("api('/bitacora?tabla=sensores_eventos').then(d => [d.total, d.registros[0]?.moduloNombre])")
    registrar('S08', 'Los eventos de los sensores quedan en el historial de registros', r[0] >= 4 and r[1] == 'Monitoreo físico (Arduino)', json.dumps(r, ensure_ascii=False))

asyncio.run(main())
