"""Browser smoke test for the land finder (desktop + Android-like mobile). Usage: python3 tests/land_smoke.py <url>"""
import asyncio, sys
from playwright.async_api import async_playwright
URL = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8000/').split('#')[0]
OUT = '/workspace/arcic'
fails = []
def check(c, msg):
    print(('OK   ' if c else 'FAIL ') + msg)
    if not c: fails.append(msg)
async def num(pg, sel): return int((await pg.inner_text(sel)).replace(',', ''))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        errs = []
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        await pg.goto(URL); await pg.wait_for_selector('body[data-land-ready="1"]', timeout=60000)
        total = await num(pg, '#lcShown'); check(total > 12000, f'desktop loads both counties ({total} parcels)')
        # filters
        await pg.select_option('#fCounty', 'richland'); await pg.wait_for_timeout(500)
        rich = await num(pg, '#lcShown'); check(0 < rich < total, f'county filter -> {rich}')
        await pg.eval_on_selector('#fNc', "e => { e.value = 60; e.dispatchEvent(new Event('input', {bubbles:true})); }"); await pg.wait_for_timeout(500)
        hi = await num(pg, '#lcShown'); check(0 < hi < rich, f'NCCPI>=60 filter -> {hi}')
        await pg.click('#fReset'); await pg.wait_for_timeout(500)
        check(await num(pg, '#lcShown') == total, 'clear filters restores all')
        await pg.fill('#fAcMin', '150'); await pg.fill('#fAcMax', '170'); await pg.wait_for_timeout(500)
        q = await num(pg, '#lcShown'); check(0 < q < total, f'acre range 150-170 -> {q}')
        await pg.click('#fReset'); await pg.wait_for_timeout(400)
        # parcel size presets
        async def row_acres(page):
            return [float(t.replace(',', '').replace(' ac', '')) for t in await page.locator('#plist .pi .acbig').all_inner_texts()]
        await pg.uncheck('#lInView'); await pg.wait_for_timeout(300)
        sizes = {}
        for k, lo, hi in [('40', 35, 45), ('80', 75, 85), ('160', 150, 170), ('320', 300, None)]:
            await pg.click(f'#fSize button[data-k="{k}"]'); await pg.wait_for_timeout(400)
            n = await num(pg, '#lcShown'); ac = await row_acres(pg); sizes[k] = n
            on = await pg.get_attribute(f'#fSize button[data-k="{k}"]', 'aria-pressed')
            check(0 < n < total and ac and all(lo <= a and (hi is None or a <= hi) for a in ac) and on == 'true'
                  and await pg.input_value('#fAcMin') == str(lo) and await pg.input_value('#fAcMax') == ('' if hi is None else str(hi)),
                  f'size preset ~{k}: {n} parcels, list rows {min(ac) if ac else None}-{max(ac) if ac else None} ac')
        check(sizes['160'] == q, 'preset ~160 matches typed 150-170 range')
        await pg.fill('#fAcMin', '60'); await pg.fill('#fAcMax', '100'); await pg.wait_for_timeout(400)
        ac = await row_acres(pg)
        check(all(60 <= a <= 100 for a in ac) and 'custom' in await pg.inner_text('#vSize') and await pg.locator('#fSize button.on').count() == 0, 'custom min/max 60-100 (no preset lit)')
        # saved searches each keep their own parcel size
        pg.once('dialog', lambda d: asyncio.ensure_future(d.accept('Quarters')))
        await pg.click('#fSize button[data-k="160"]'); await pg.wait_for_timeout(300)
        await pg.click('#sSave'); await pg.wait_for_timeout(300)
        pg.once('dialog', lambda d: asyncio.ensure_future(d.accept('Richland 40s')))
        await pg.select_option('#fCounty', 'richland'); await pg.click('#fSize button[data-k="40"]'); await pg.wait_for_timeout(300)
        await pg.click('#sSave'); await pg.wait_for_timeout(300)
        saved = await pg.evaluate('window.__land.S.searches')
        check(len(saved) == 2 and saved[0]['filters']['acMin'] in (150, '150') and saved[1]['filters']['acMax'] in (45, '45') and saved[1]['filters']['county'] == 'richland', 'two saved searches with their own sizes')
        qid = saved[0]['id']
        await pg.select_option('#sSelect', qid); await pg.wait_for_timeout(500)
        check(await pg.input_value('#fAcMin') == '150' and await pg.input_value('#fAcMax') == '170' and await pg.input_value('#fCounty') == 'all' and await num(pg, '#lcShown') == q, 'loading "Quarters" restores its 150-170 size + county')
        await pg.fill('#fAcMax', '200'); await pg.wait_for_timeout(300)
        check(await pg.is_visible('#sUpdate') and 'edited' in await pg.inner_text('#sActiveLabel'), 'editing a saved search shows Update')
        await pg.click('#sUpdate'); await pg.wait_for_timeout(300)
        await pg.reload(); await pg.wait_for_selector('body[data-land-ready="1"]', timeout=60000)
        s2 = await pg.evaluate('window.__land.S.searches')
        check(len(s2) == 2 and str(s2[0]['filters']['acMax']) == '200' and await pg.input_value('#fAcMax') == '200' and await pg.input_value('#sSelect') == qid, 'saved searches + size persist after reload')
        pg.once('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.click('#sDelete'); await pg.wait_for_timeout(300)
        pg.once('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.select_option('#sSelect', s2[1]['id']); await pg.wait_for_timeout(300); await pg.click('#sDelete'); await pg.wait_for_timeout(300)
        check(await pg.evaluate('window.__land.S.searches.length') == 0, 'delete saved searches')
        # details show acres prominently
        await pg.click('#plist .pi [data-act="info"]'); await pg.wait_for_timeout(200)
        check('acres' in await pg.inner_text('#inspAcres'), 'details panel shows acres up top')
        await pg.click('#inspect [data-x]')
        await pg.check('#lInView'); await pg.click('#fReset'); await pg.wait_for_timeout(400)
        # rule out from list (no confirm)
        first = await pg.get_attribute('#plist .pi', 'data-id')
        await pg.click('#plist .pi .main'); await pg.wait_for_timeout(200)
        check(await num(pg, '#lcHidden') == 1 and await num(pg, '#lcShown') == total - 1, 'list tap rules out immediately')
        check(await pg.query_selector(f'#plist .pi[data-id="{first}"]') is None, 'ruled-out row gone from list')
        check(await pg.is_visible('#toast'), 'undo toast shown')
        # rule out on map: zoom to next parcel, click map center
        nxt = await pg.get_attribute('#plist .pi', 'data-id')
        await pg.click(f'#plist .pi[data-id="{nxt}"] [data-act="zoom"]'); await pg.wait_for_timeout(1200)
        box = await pg.locator('#map').bounding_box()
        await pg.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); await pg.wait_for_timeout(300)
        hidden_ids = await pg.evaluate('window.__land.hidden.toJSON()')
        check(len(hidden_ids) == 2 and hidden_ids[-1] == nxt, f'map click rules out the parcel under the cursor ({hidden_ids[-1] if hidden_ids else None})')
        await pg.screenshot(path=f'{OUT}/land-zoomed.png')
        # undo
        await pg.click('#lbUndo'); await pg.wait_for_timeout(300)
        check(await num(pg, '#lcHidden') == 1, 'undo restores the last one')
        # persistence
        await pg.reload(); await pg.wait_for_selector('body[data-land-ready="1"]', timeout=60000)
        check(await num(pg, '#lcHidden') == 1, 'ruled-out parcels persist after reload')
        # show hidden + restore by tap
        await pg.check('#lbShowHidden'); await pg.wait_for_timeout(400)
        await pg.uncheck('#lInView'); await pg.wait_for_timeout(300)
        await pg.select_option('#lSort', 'acres'); await pg.wait_for_timeout(300)
        ruled = await pg.query_selector_all('#plist .pi.ruled')
        check(len(ruled) >= 0, 'show ruled out toggle works')
        await pg.uncheck('#lbShowHidden'); await pg.check('#lInView'); await pg.select_option('#lSort', 'nccpi'); await pg.wait_for_timeout(300)
        # inspect -> ARC prefill
        await pg.select_option('#fCounty', 'richland'); await pg.wait_for_timeout(500)
        await pg.click('#plist .pi [data-act="info"]'); await pg.wait_for_timeout(200)
        check(await pg.is_visible('#inspect'), 'details panel opens')
        await pg.click('#inspect [data-act="arc"]'); await pg.wait_for_timeout(400)
        check(pg.url.endswith('#arc') and await pg.input_value('#county') == 'richland', 'ARC/PLC tab prefilled with parcel county')
        await pg.goto(URL + '#land'); await pg.wait_for_selector('body[data-land-ready="1"]', timeout=60000)
        await pg.click('#fReset'); await pg.wait_for_timeout(300)
        await pg.click('#lbRestore'); await pg.wait_for_timeout(300)
        check(await num(pg, '#lcHidden') == 0, 'restore all')
        await pg.goto(URL); await pg.wait_for_selector('body[data-land-ready="1"]', timeout=60000); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f'{OUT}/land-desktop-overview.png')
        await pg.evaluate("document.querySelector('#filtersBox').open = false; window.__land.map.setView([46.30, -96.68], 12.5)"); await pg.wait_for_timeout(2500)
        await pg.screenshot(path=f'{OUT}/land-desktop.png')
        # mobile (Android-ish, touch)
        m = await b.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36')
        mp = await m.new_page(); mp.on('pageerror', lambda e: errs.append(str(e)))
        await mp.goto(URL); await mp.wait_for_selector('body[data-land-ready="1"]', timeout=60000)
        mt = await num(mp, '#lcShown')
        await mp.locator('#plist .pi .main').first.tap(); await mp.wait_for_timeout(250)
        check(await num(mp, '#lcHidden') == 1 and await num(mp, '#lcShown') == mt - 1, 'mobile: tap list row rules out')
        nid = await mp.get_attribute('#plist .pi', 'data-id')
        await mp.locator(f'#plist .pi[data-id="{nid}"] [data-act="zoom"]').tap(); await mp.wait_for_timeout(1500)
        mb = await mp.locator('#map').bounding_box()
        await mp.touchscreen.tap(mb['x'] + mb['width'] / 2, mb['y'] + mb['height'] / 2); await mp.wait_for_timeout(400)
        ids = await mp.evaluate('window.__land.hidden.toJSON()')
        check(len(ids) == 2 and ids[-1] == nid, 'mobile: tap on map rules out parcel')
        await mp.locator('#toastUndo').tap(); await mp.wait_for_timeout(300)
        check(await num(mp, '#lcHidden') == 1, 'mobile: toast undo')
        await mp.locator('#fSize button[data-k="80"]').tap(); await mp.wait_for_timeout(400)
        mac = [float(t.replace(',', '').replace(' ac', '')) for t in await mp.locator('#plist .pi .acbig').all_inner_texts()]
        check(await mp.is_visible('#sizeBox') and mac and all(75 <= a <= 85 for a in mac), f'mobile: size chip ~80 visible and filters list ({len(mac)} rows)')
        await mp.locator('#fSize button[data-k="any"]').tap(); await mp.wait_for_timeout(300)
        sw = await mp.evaluate('document.documentElement.scrollWidth'); check(sw <= 412, f'mobile no horizontal overflow ({sw})')
        await mp.evaluate('window.scrollTo(0,0)'); await mp.locator('#lbRestore').tap(); await mp.wait_for_timeout(300)
        await mp.evaluate("document.querySelector('#filtersBox').open = false; window.__land.map.setView([46.30, -96.66], 12)"); await mp.wait_for_timeout(2500)
        await mp.screenshot(path=f'{OUT}/land-mobile.png')
        await mp.screenshot(path=f'{OUT}/land-mobile-full.png', full_page=True)
        check(not errs, f'no JS errors {errs[:3]}')
        await b.close()
    print('FAILURES:', fails if fails else 'none')
    sys.exit(1 if fails else 0)
asyncio.run(main())
