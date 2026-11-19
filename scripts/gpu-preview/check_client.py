"""Exercise the public stream in a second Chromium client on the rental."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

output = Path(os.environ['NIMBA_CAPTURE_DIR'])
with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox','--enable-gpu','--ignore-gpu-blocklist',
        '--disable-software-rasterizer','--use-gl=angle','--use-angle=vulkan'])
    reference = browser.new_page(viewport={'width':1280,'height':800})
    reference.goto(os.environ['NIMBA_GAME_URL'])
    reference.wait_for_selector('.title-card.ready')
    reference.locator('.title-landscape').evaluate('img=>img.decode()')
    reference.wait_for_timeout(1500)
    reference.screenshot(path=output/'title.jpg',quality=88)
    button = reference.locator('[data-i18n="title.walk"]').bounding_box()
    reference.close()
    page = browser.new_page(viewport={'width':1280,'height':800})
    page.goto(os.environ['NIMBA_PLAYER_URL']+'/#'+Path(os.environ['NIMBA_KEY_FILE']).read_text().strip())
    page.wait_for_function("document.querySelector('#status').textContent===''",timeout=90000)
    print('Authenticated stream delivered frames',flush=True)
    page.wait_for_timeout(2000)
    page.mouse.click(button['x']+button['width']/2,button['y']+button['height']/2)
    page.wait_for_timeout(8000)
    page.keyboard.down('ArrowUp')
    page.keyboard.down('ArrowRight')
    page.wait_for_timeout(1200)
    page.keyboard.up('ArrowRight')
    page.wait_for_timeout(2600)
    page.keyboard.up('ArrowUp')
    page.screenshot(path=output/'stream.jpg',quality=86)
    print('Captured stream after click, movement and turn',flush=True)
    browser.close()
