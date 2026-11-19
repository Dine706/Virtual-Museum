"""Single-player game stream. Only the game's canvas and a small input vocabulary leave localhost."""
import asyncio
import base64
import hmac
import json
import os
from pathlib import Path
from aiohttp import web
from playwright.async_api import async_playwright

WIDTH, HEIGHT = 1280, 800
KEYS = dict(ArrowUp='ArrowUp', ArrowDown='ArrowDown', ArrowLeft='ArrowLeft', ArrowRight='ArrowRight',
            KeyW='w', KeyA='a', KeyS='s', KeyD='d', Space='Space', ShiftLeft='Shift', Escape='Escape', KeyE='e')
URL = os.environ['NIMBA_GAME_URL']
TOKEN = os.environ['NIMBA_PLAYER_KEY']
player_lock = asyncio.Lock()

async def play(request):
    origin = request.headers.get('Origin')
    if origin != 'https://' + request.host:
        raise web.HTTPForbidden()
    ws = web.WebSocketResponse(max_msg_size=512, heartbeat=25)
    await ws.prepare(request)
    try:
        auth = await asyncio.wait_for(ws.receive_json(), 8)
        if not isinstance(auth, dict) or not hmac.compare_digest(str(auth.get('key', '')), TOKEN):
            await ws.close(code=1008)
            return ws
        if player_lock.locked():
            await ws.send_str('This preview is already in use.')
            await ws.close()
            return ws
        async with player_lock:
            context = await request.app['browser'].new_context(viewport={'width': WIDTH,'height': HEIGHT},accept_downloads=False)
            try:
                async def restrict_game(route):
                    if route.request.url.startswith(('http://127.0.0.1:8095/', 'blob:', 'data:')):
                        await route.continue_()
                    else:
                        await route.abort()
                await context.route('**/*', restrict_game)
                page = await context.new_page()
                await page.goto(URL,wait_until='domcontentloaded')
                await page.wait_for_selector('[data-i18n="title.walk"]')
                await page.locator('.title-landscape').evaluate('img=>img.decode().catch(()=>{})')
                if 'External Content' in await page.title():
                    await page.get_by_text('Open the page',exact=True).click()
                cdp = await context.new_cdp_session(page)
                pending = None
                async def frame(event):
                    nonlocal pending
                    if ws.closed: return
                    if pending is not None:
                        await cdp.send('Page.screencastFrameAck',{'sessionId':event['sessionId']})
                        return
                    pending=event['sessionId']
                    await ws.send_bytes(base64.b64decode(event['data']))
                cdp.on('Page.screencastFrame',frame)
                await cdp.send('Page.startScreencast',{'format':'jpeg','quality':83,'maxWidth':WIDTH,'maxHeight':HEIGHT,'everyNthFrame':1})
                pressed=set()
                async for message in ws:
                    if message.type != web.WSMsgType.TEXT: break
                    m=json.loads(message.data); kind=m.get('type')
                    if kind=='ack' and pending is not None:
                        await cdp.send('Page.screencastFrameAck',{'sessionId':pending})
                        pending=None
                    elif kind in ('keydown','keyup') and m.get('code') in KEYS:
                        k=KEYS[m['code']]
                        if kind=='keydown' and k not in pressed:
                            pressed.add(k); await page.keyboard.down(k)
                        elif kind=='keyup' and k in pressed:
                            pressed.remove(k); await page.keyboard.up(k)
                    elif kind=='reset':
                        for k in pressed: await page.keyboard.up(k)
                        pressed.clear(); await page.mouse.up()
                    elif kind in ('pointerdown','pointerup','pointermove','pointercancel'):
                        x=max(0,min(WIDTH-1,float(m['x'])*WIDTH)); y=max(0,min(HEIGHT-1,float(m['y'])*HEIGHT))
                        await page.mouse.move(x,y)
                        if kind=='pointerdown': await page.mouse.down()
                        if kind in ('pointerup','pointercancel'): await page.mouse.up()
            finally:
                if context.pages:
                    print('Game session ended:', await context.pages[0].evaluate(
                        "()=>({walking:document.body.classList.contains('walking'),location:location.hash})"), flush=True)
                await context.close()
    except (TimeoutError,ValueError,KeyError,ConnectionError):
        await ws.close()
    return ws

async def runtime(app):
    async with async_playwright() as p:
        app['browser']=await p.chromium.launch(args=['--enable-gpu','--no-sandbox','--ignore-gpu-blocklist','--disable-software-rasterizer','--use-gl=angle','--use-angle=vulkan','--disable-dev-shm-usage'])
        yield
        await app['browser'].close()

async def index(_):
    return web.FileResponse(Path(__file__).with_name('player.html'),headers={'Referrer-Policy':'no-referrer','Cache-Control':'no-store'})
app=web.Application(client_max_size=1024)
app.cleanup_ctx.append(runtime)
app.router.add_get('/',index)
app.router.add_get('/play',play)
web.run_app(app,host='127.0.0.1',port=8094,access_log=None)
