import asyncio, re, sys
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/'
OUT = '/workspace/arcic'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 1366, 'height': 900}, device_scale_factor=1, accept_downloads=True)
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        await pg.goto(URL); await pg.wait_for_selector('#slide-5')
        await pg.screenshot(path=f'{OUT}/desktop-wilkin.png', full_page=True)
        await pg.screenshot(path=f'{OUT}/desktop.png')
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.click('#btnCass'); await pg.wait_for_timeout(400)
        txt = await pg.inner_text('#slides')
        for want in ['$33,465', '$41,099', '$7,634', '$677.46', '$326.46', '$90.33', '$58.71', '$752.73', '$26,452', '$14,647', '$1,672', '$909.93', '$818.93', '$453.45', '$621.00', '$338.80', 'about 6% above', 'about 31%', 'ARC-IC pays its max', 'Why ARC-CO wins on this farm']:
            print(('OK  ' if want in txt else 'MISSING ') + want)
        await pg.screenshot(path=f'{OUT}/desktop-cass3.png', full_page=True)
        for i in range(1, 6):
            await (await pg.query_selector(f'#slide-{i}')).screenshot(path=f'{OUT}/slide-{i}.png')
        async with pg.expect_download() as dl:
            await pg.click('[data-png="2"]')
        d = await dl.value; await d.save_as(f'{OUT}/export-slide-2.png'); print('export ok', d.suggested_filename)
        # persistence
        await pg.reload(); await pg.wait_for_selector('#slide-5'); print('persisted cass:', '$33,465' in await pg.inner_text('#slides'))
        m = await b.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2, is_mobile=True, has_touch=True)
        mp = await m.new_page(); mp.on('pageerror', lambda e: errs.append(str(e)))
        await mp.goto(URL); await mp.wait_for_selector('#slide-5')
        await mp.screenshot(path=f'{OUT}/mobile-wilkin.png', full_page=False)
        await mp.screenshot(path=f'{OUT}/mobile-full.png', full_page=True)
        await mp.click('#btnCass'); await mp.wait_for_timeout(300)
        await (await mp.query_selector('#slide-2')).screenshot(path=f'{OUT}/mobile-slide-2.png')
        await (await mp.query_selector('#tiles')).screenshot(path=f'{OUT}/mobile-tiles.png')
        await mp.evaluate("document.querySelector('#crops').scrollIntoView()"); await mp.screenshot(path=f'{OUT}/mobile-crops.png')
        sw = await mp.evaluate('document.documentElement.scrollWidth'); print('mobile scrollWidth', sw)
        print('errors', errs)
        await b.close()
asyncio.run(main())
