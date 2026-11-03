// End-to-end check of the built Chrome extension in Chrome for Testing.
// Needs: `npm run build`, a server on :8765 serving this folder, and puppeteer installed.
// Usage: node test/e2e.mjs [path/to/node_modules/puppeteer] [screenshot dir]
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const puppeteer = require(process.argv[2] || 'puppeteer');
const shots = process.argv[3] || here;
const ext = join(here, '..', 'dist', 'chrome');
const BASE = 'http://localhost:8765/test';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--window-size=1100,800'],
  defaultViewport: { width: 1100, height: 800 },
});

try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'), { timeout: 10000 });
  const sw = await swTarget.worker();
  const extId = new URL(swTarget.url()).host;
  check('service worker starts', !!sw, extId);

  const page = await browser.newPage();
  await page.goto(`${BASE}/fixture.html?ext`, { waitUntil: 'load' });
  check('content script idle while off', await page.evaluate(() => !document.documentElement.hasAttribute('data-inkpage')));

  await sw.evaluate(() => chrome.storage.local.set({ sites: { localhost: { enabled: true } } }));
  await sleep(700);
  const s1 = await page.evaluate(() => {
    const cs = (sel) => getComputedStyle(document.querySelector(sel));
    return {
      on: document.documentElement.hasAttribute('data-inkpage'),
      hero: cs('.hero').backgroundColor, heroText: cs('.hero').color,
      menuLayer: document.getElementById('menu').getAttribute('data-ink-layer'),
      topPos: cs('#top').position, gif: document.getElementById('gif').getAttribute('data-ink-gif'),
      shadow: !!document.getElementById('fc').shadowRoot.querySelector('style[data-inkpage]'),
    };
  });
  check('turns on from storage', s1.on);
  check('dark hero → paper', s1.hero === 'rgb(255, 255, 255)' && s1.heroText === 'rgb(0, 0, 0)', `${s1.hero} / ${s1.heroText}`);
  check('dropdown stays opaque', s1.menuLayer === 'pop');
  check('fixed header released', s1.topPos === 'absolute');
  check('GIF frozen', s1.gif === 'frozen');
  check('shadow DOM styled', s1.shadow);

  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://localhost:8765/test/fixture.html*' }))[0].id);
  const badge = await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  check('toolbar badge shows ON', badge === 'ON', badge);

  await page.screenshot({ path: join(shots, 'e2e-page1.png') });
  await page.mouse.click(500, 400);
  const y0 = await page.evaluate(() => scrollY);
  await page.keyboard.press('PageDown');
  await sleep(100);
  const y1 = await page.evaluate(() => scrollY);
  check('PageDown turns one screen', y1 - y0 > 600 && y1 - y0 <= 800, `${y0} → ${y1}`);
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowLeft');
  await sleep(100);
  check('Space then ← returns to page 2', Math.abs((await page.evaluate(() => scrollY)) - y1) < 40);
  await page.screenshot({ path: join(shots, 'e2e-page2.png') });

  // Popup, pointed at the fixture tab.
  const popup = await browser.newPage();
  await popup.setViewport({ width: 340, height: 900 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html?tab=${tabId}`);
  await sleep(300);
  const p1 = await popup.evaluate(() => ({ site: document.getElementById('site').textContent, on: document.getElementById('enabled').checked }));
  check('popup knows the site', p1.site === 'localhost' && p1.on, JSON.stringify(p1));
  await popup.click('.seg[data-key="theme"] button[data-v="night"]');
  await sleep(400);
  const night = await page.evaluate(() => [document.documentElement.getAttribute('data-ink-theme'), getComputedStyle(document.body).backgroundColor]);
  check('popup → night theme applied', night[0] === 'night' && night[1] === 'rgb(0, 0, 0)', night.join(' '));
  await popup.screenshot({ path: join(shots, 'e2e-popup.png'), fullPage: true });
  await page.screenshot({ path: join(shots, 'e2e-night.png') });
  await popup.click('.seg[data-key="theme"] button[data-v="paper"]');

  // Keyboard command path: background → content script toggle.
  await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'toggle' }, { frameId: 0 }), tabId);
  await sleep(400);
  const off = await page.evaluate(() => ({ attr: document.documentElement.hasAttribute('data-inkpage'), left: document.querySelectorAll('[data-ink-layer],[data-ink-unpin],[data-ink-gifstill]').length, top: getComputedStyle(document.getElementById('top')).position }));
  check('toggle command turns it off cleanly', !off.attr && off.left === 0 && off.top === 'fixed', JSON.stringify(off));

  // Inner scroll container. Forget the explicit "off" for localhost so "every site" applies.
  await sw.evaluate(() => chrome.storage.local.set({ sites: {}, everywhere: true }));
  const app = await browser.newPage();
  await app.goto(`${BASE}/app.html?ext`, { waitUntil: 'load' });
  await sleep(500);
  await app.mouse.click(500, 400);
  const before = await app.evaluate(() => document.getElementById('main').scrollTop);
  await app.keyboard.press('PageDown');
  await sleep(100);
  const after = await app.evaluate(() => document.getElementById('main').scrollTop);
  const paneH = await app.evaluate(() => document.getElementById('main').clientHeight);
  check('pages an inner scroll container', after - before > paneH * 0.85 && after - before <= paneH, `${before} → ${after} of ${paneH}`);

  // CSP that forbids inline <style>: the fallback must still colour the page.
  const csp = await browser.newPage();
  await csp.goto(`${BASE}/csp.html`, { waitUntil: 'load' });
  await sleep(800);
  const c = await csp.evaluate(() => ({ bg: getComputedStyle(document.getElementById('box')).backgroundColor, fg: getComputedStyle(document.getElementById('box')).color, inline: document.getElementById('inkpage-style')?.sheet?.cssRules.length ?? null }));
  check('strict CSP page still inked', c.fg === 'rgb(0, 0, 0)' && c.bg === 'rgb(255, 255, 255)', JSON.stringify(c));
  await csp.screenshot({ path: join(shots, 'e2e-csp.png') });

  // Book view: Readability + book.js are injected on demand by the background.
  await sw.evaluate(() => chrome.storage.local.set({ sites: { localhost: { enabled: true, mode: 'book' } }, everywhere: false }));
  const art = await browser.newPage();
  await art.goto(`${BASE}/article.html?ext`, { waitUntil: 'load' });
  await sleep(1200);
  const b1 = await art.evaluate(() => ({
    host: !!document.querySelector('inkpage-book'),
    locked: document.documentElement.hasAttribute('data-ink-book'),
    pageHidden: getComputedStyle(document.querySelector('main')).visibility,
  }));
  check('book view opens on an article', b1.host && b1.locked && b1.pageHidden === 'hidden', JSON.stringify(b1));
  // Compare everything below the clock strip, which changes every minute.
  const shot = async () => art.screenshot({ encoding: 'base64', clip: { x: 0, y: 36, width: 1100, height: 764 } });
  await art.screenshot({ path: join(shots, 'e2e-book1.png') });
  const pageOne = await shot();
  await art.keyboard.press('ArrowRight');
  await art.keyboard.press('ArrowRight');
  await sleep(150);
  const pageThree = await shot();
  await art.screenshot({ path: join(shots, 'e2e-book3.png') });
  check("arrow keys turn book pages", pageOne !== pageThree);
  await sleep(900); // position is saved shortly after a turn
  await art.reload({ waitUntil: 'load' });
  await sleep(1200);
  check('reopens at the remembered page', (await shot()) === pageThree);
  const fontOk = await art.evaluate(() => [...document.fonts].some((f) => f.family === 'InkLiterata' && f.status === 'loaded'));
  check('bundled Literata font loads', fontOk);
  // Kindle-style chrome: tap the top for toolbars, then Aa for the settings sheet.
  await art.mouse.click(550, 30);
  await sleep(200);
  await art.screenshot({ path: join(shots, 'e2e-book-toolbar.png') });
  await art.mouse.click(1100 - 24, 26);
  await sleep(200);
  await art.screenshot({ path: join(shots, 'e2e-book-sheet.png') });
  check('toolbars and Aa sheet open', (await shot()) !== pageThree);
  await art.keyboard.press('Escape'); // closes the toolbars
  await sleep(150);
  check('Esc closes the toolbars first', (await shot()) === pageThree);
  await art.keyboard.press('Escape');
  await sleep(200);
  const esc = await art.evaluate(() => ({ host: !!document.querySelector('inkpage-book'), visible: getComputedStyle(document.querySelector('main')).visibility }));
  check('Esc shows the original page', !esc.host && esc.visible === 'visible', JSON.stringify(esc));

  const artTab = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://localhost:8765/test/article.html*' }))[0].id);
  const pop2 = await browser.newPage();
  await pop2.setViewport({ width: 340, height: 700 });
  await pop2.goto(`chrome-extension://${extId}/popup/popup.html?tab=${artTab}`);
  await sleep(300);
  check('popup shows book settings', await pop2.evaluate(() => document.body.classList.contains('book-mode')));
  await pop2.screenshot({ path: join(shots, 'e2e-popup-book.png'), fullPage: true });

  const plain = await browser.newPage();
  await plain.goto(`${BASE}/csp.html`, { waitUntil: 'load' });
  await sleep(1200);
  check('no article → stays a web page', await plain.evaluate(() => !document.querySelector('inkpage-book') && !!document.querySelector('inkpage-ui')));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
