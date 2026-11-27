"""Browser test for one-click 'Rule out all results' (desktop + Android-size mobile). Usage: python3 tests/ruleall_smoke.py <url>"""
import asyncio, sys
from playwright.async_api import async_playwright
URL = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8000/').split('#')[0]
OUT = '/workspace/arcic'
fails = []
def check(c, msg):
    print(('OK   ' if c else 'FAIL ') + msg)
    if not c: fails.append(msg)
async def num(pg, sel): return int((await pg.inner_text(sel)).replace(',', ''))
HID = 'window.__land.hidden.toJSON()'

async def run(pg, mobile, tag):
    dialogs = []
    async def on_dialog(d):
        if d.type == 'prompt': await d.accept('Other tab')
        else: dialogs.append(d.message); await d.accept()
    pg.on('dialog', lambda d: asyncio.ensure_future(on_dialog(d)))
    act = (lambda loc: loc.tap()) if mobile else (lambda loc: loc.click())
    await pg.goto(URL); await pg.wait_for_selector('body[data-land-ready="1"]', timeout=60000)
    total = await num(pg, '#lcShown')
    check(await pg.is_visible('#lbRuleAll') and await num(pg, '#lbRuleAllN') == total, f'{tag}: button shows full count with no filters ({total})')
    # a second tab with its own ruled-out parcel
    await act(pg.locator('#sNew')); await pg.wait_for_timeout(500)
    await act(pg.locator('#plist .pi .main').first); await pg.wait_for_timeout(300)
    other = await pg.evaluate(HID)
    await act(pg.locator('#stabList .stab').first); await pg.wait_for_timeout(500)
    # one manual rule-out in tab 1 that isn't a Yaggie parcel
    await act(pg.locator('#plist .pi .main').first); await pg.wait_for_timeout(300)
    manual = await pg.evaluate(HID)
    await pg.locator('#fName').fill('Yaggie'); await pg.wait_for_timeout(600)
    n = await num(pg, '#lcShown'); listed = await pg.locator('#plist .pi').count()
    label = ' '.join((await pg.inner_text('#lbRuleAll')).split())
    check(n == 259 and label == 'Rule out all 259' and listed < 259, f'{tag}: Yaggie -> "{label}" while the list shows only {listed} (map view)')
    await pg.evaluate("window.scrollTo(0,0); document.querySelector('#filtersBox').open = false; document.querySelector('#toast').hidden = true; 0"); await pg.wait_for_timeout(1500)
    await pg.screenshot(path=f'{OUT}/ruleall-{tag}-before.png')
    await act(pg.locator('#lbRuleAll')); await pg.wait_for_timeout(600)
    h = await pg.evaluate(HID)
    check(not dialogs, f'{tag}: no confirmation dialog')
    check(len(h) == len(manual) + 259 and h[:len(manual)] == manual and await num(pg, '#lcShown') == 0, f'{tag}: one click ruled out all 259 (tab list now {len(h)})')
    check(not await pg.is_visible('#lbRuleAll'), f'{tag}: button hidden with no results left')
    check(await pg.is_visible('#toast') and 'Ruled out 259' in await pg.inner_text('#toast') and await pg.is_visible('#toastUndo'), f'{tag}: toast with Undo')
    await pg.wait_for_timeout(300)
    await pg.screenshot(path=f'{OUT}/ruleall-{tag}-after.png')
    await act(pg.locator('#toastUndo')); await pg.wait_for_timeout(500)
    check(await pg.evaluate(HID) == manual and await num(pg, '#lcShown') == 259 and await num(pg, '#lbRuleAllN') == 259, f'{tag}: toast Undo restores exactly that batch (manual one stays)')
    # again, then the toolbar Undo also undoes the whole batch; persistence across reload
    await act(pg.locator('#lbRuleAll')); await pg.wait_for_timeout(500)
    await pg.reload(); await pg.wait_for_selector('body[data-land-ready="1"]', timeout=60000)
    check(len(await pg.evaluate(HID)) == len(manual) + 259 and await num(pg, '#lcShown') == 0, f'{tag}: bulk rule-out persists after reload')
    await pg.locator('#fName').fill(''); await pg.wait_for_timeout(400)
    await act(pg.locator('#stabList .stab').nth(1)); await pg.wait_for_timeout(500)
    check(await pg.evaluate(HID) == other, f'{tag}: other tab ruled-out list untouched')
    await act(pg.locator('#stabList .stab').first); await pg.wait_for_timeout(500)
    await act(pg.locator('#lbRestore')); await pg.wait_for_timeout(300)
    await pg.locator('#fName').fill('Yaggie'); await pg.wait_for_timeout(400)
    await act(pg.locator('#lbRuleAll')); await pg.wait_for_timeout(400)
    await act(pg.locator('#lbUndo')); await pg.wait_for_timeout(400)
    check(await pg.evaluate(HID) == [] and await num(pg, '#lcShown') == 259, f'{tag}: toolbar Undo restores the whole batch')
    await pg.locator('#fName').fill('zzzz-nobody'); await pg.wait_for_timeout(400)
    check(not await pg.is_visible('#lbRuleAll'), f'{tag}: button hidden when search has no results')
    sw = await pg.evaluate('document.documentElement.scrollWidth'); vw = await pg.evaluate('window.innerWidth')
    check(sw <= vw, f'{tag}: no horizontal overflow ({sw}/{vw})')

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        errs = []
        d = await (await b.new_context(viewport={'width': 1440, 'height': 900})).new_page()
        d.on('pageerror', lambda e: errs.append(str(e)))
        await run(d, False, 'desktop')
        m = await b.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36')
        mp = await m.new_page(); mp.on('pageerror', lambda e: errs.append(str(e)))
        await run(mp, True, 'mobile')
        check(not errs, f'no JS errors {errs[:3]}')
        await b.close()
    print('FAILURES:', fails if fails else 'none')
    sys.exit(1 if fails else 0)
asyncio.run(main())
