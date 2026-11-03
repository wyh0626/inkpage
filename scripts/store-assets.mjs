// Store screenshots (1280×800), promo tile (440×280) and marquee (1400×560), in English
// and Chinese, captured from the real extension in Chrome for Testing.
// Needs: `npm run build`, a server on :8765 serving this folder, puppeteer.
// Usage: node scripts/store-assets.mjs [path/to/puppeteer]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const puppeteer = require(process.argv[2] || 'puppeteer');
const ext = join(root, 'dist', 'chrome');
const out = join(root, 'store');
const BASE = 'http://localhost:8765/test';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const icon = `data:image/png;base64,${readFileSync(join(root, 'src/icons/icon-128.png')).toString('base64')}`;

const COPY = {
  en: {
    article: 'article-en.html',
    before: 'fixture.html', // colourful enough that the change shows
    name: 'InkPage',
    tagline: 'E-ink reading mode for the web',
    shots: [
      ['Any page, calm black on white', 'Menus stay readable, sticky bars step aside, animation stops.', 'Before', 'After'],
      ['Book view, paged like an e-reader', 'Just the article, re-typeset: one spread per screen, never a cut line.'],
      ['Five paper tones', 'White, gray, warm, green and night, with optional paper grain.'],
      ['Your type, remembered per site', 'Fonts, size, spacing and margins: tap the top of the page for menus.'],
    ],
  },
  zh: {
    article: 'article.html',
    before: 'demo-news.html', // the busier Chinese page, so the change shows
    name: '墨页 InkPage',
    tagline: '网页的墨水屏阅读模式',
    shots: [
      ['任意网页，一键白纸黑字', '菜单弹窗不叠字，悬浮栏让位，动画全部停下。', '原网页', '墨页'],
      ['书页模式：像电子书一样翻页', '只留正文，重新排版；一屏一版，永不切半行。'],
      ['五种纸张配色', '白纸、灰白纸、暖纸、护眼绿、夜读，可加纸纹。'],
      ['排版按网站记住', '字体、字号、行距、页边距，点页面顶部即可调整。'],
    ],
  },
};

const FRAME_CSS = `
  *{box-sizing:border-box}body{margin:0;background:#f1efe8;color:#111;font-family:"Iowan Old Style",Georgia,"Songti SC",serif}
  .cap{position:absolute;left:0;right:0;top:46px;text-align:center}
  h1{margin:0;font-size:44px;font-weight:600;letter-spacing:-.01em}
  p{margin:12px 0 0;font:400 19px/1.4 system-ui,-apple-system,"PingFang SC",sans-serif;color:#4a4a46}
  .shot{position:absolute;left:50%;transform:translateX(-50%);border:1px solid #1112;box-shadow:0 18px 50px #0002;background:#fff}
  .pair{position:absolute;left:70px;right:70px;top:178px;display:flex;gap:30px}
  .pair figure{margin:0;flex:1}.pair img{width:100%;display:block;border:1px solid #1112;box-shadow:0 14px 40px #0002}
  figcaption{font:600 15px/1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;margin:0 0 10px;color:#555}
  .row{position:absolute;left:60px;right:60px;top:180px;display:flex;gap:18px}
  .row img{flex:1;min-width:0;width:20%;border:1px solid #1112;box-shadow:0 10px 30px #0002}`;

async function capture(lang) {
  const c = COPY[lang];
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
  const browser = await puppeteer.launch({ // macOS Chrome takes its UI language from AppleLanguages
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--lang=${locale}`, '-AppleLanguages', `(${locale})`],
    env: { ...process.env, LANG: `${locale.replace('-', '_')}.UTF-8`, LANGUAGE: locale },
  });
  const sw = await (await browser.waitForTarget((t) => t.type() === 'service_worker')).worker();
  const extId = new URL(sw.url()).host;
  const set = (site) => sw.evaluate((s) => chrome.storage.local.set({ sites: { localhost: s } }), site);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  const shot = async (opts = {}) => `data:image/png;base64,${await page.screenshot({ encoding: 'base64', ...opts })}`;
  const raw = {};

  await page.setViewport({ width: 900, height: 1000, deviceScaleFactor: 2 }); // taller, so the pair fills the frame
  await set({ enabled: false });
  await page.goto(`${BASE}/${c.before}?ext`, { waitUntil: 'load' }); await sleep(600);
  raw.before = await shot();
  await set({ enabled: true, mode: 'page' });
  await page.goto(`${BASE}/${c.before}?ext`, { waitUntil: 'load' }); await sleep(1200);
  raw.after = await shot();

  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await set({ enabled: true, mode: 'book', bookFont: 'literata' });
  await page.goto(`${BASE}/${c.article}?ext`, { waitUntil: 'load' }); await sleep(1800);
  await page.keyboard.press('ArrowRight'); await sleep(300);
  raw.book = await shot();

  raw.themes = [];
  await page.setViewport({ width: 400, height: 900, deviceScaleFactor: 2 }); // phone-like, fills the row
  for (const theme of ['paper', 'gray', 'sepia', 'green', 'night']) {
    await set({ enabled: true, mode: 'book', theme, paperGrain: theme === 'paper' || theme === 'night' ? 0 : 2, paperShade: theme === 'gray' ? 5 : 0 });
    await page.goto(`${BASE}/${c.article}?ext`, { waitUntil: 'load' }); await sleep(1500);
    raw.themes.push(await shot());
  }

  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await set({ enabled: true, mode: 'book', theme: 'sepia', paperGrain: 1, bookFont: 'charis' });
  await page.goto(`${BASE}/${c.article}?ext`, { waitUntil: 'load' }); await sleep(1500);
  await page.mouse.click(640, 30); await sleep(250);
  await page.mouse.click(1280 - 24, 26); await sleep(700);
  raw.sheet = await shot();
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://localhost:8765/*' }))[0].id);
  const pop = await browser.newPage();
  await pop.setViewport({ width: 340, height: 580, deviceScaleFactor: 2 });
  await pop.goto(`chrome-extension://${extId}/popup/popup.html?tab=${tabId}`); await sleep(500);
  raw.popup = `data:image/png;base64,${await pop.screenshot({ encoding: 'base64' })}`;
  await browser.close();
  return raw;
}

async function compose(browser, lang, raw) {
  const c = COPY[lang];
  const dir = join(out, lang);
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage();
  const render = async (file, width, height, body) => {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${FRAME_CSS}</style><body style="width:${width}px;height:${height}px;position:relative;overflow:hidden">${body}</body>`, { waitUntil: 'load' });
    await page.screenshot({ path: join(dir, file) });
  };
  const cap = (i) => `<div class="cap"><h1>${c.shots[i][0]}</h1><p>${c.shots[i][1]}</p></div>`;
  await render('1-page-mode.png', 1280, 800, `${cap(0)}<div class="pair"><figure><figcaption>${c.shots[0][2]}</figcaption><img src="${raw.before}"></figure><figure><figcaption>${c.shots[0][3]}</figcaption><img src="${raw.after}"></figure></div>`);
  await render('2-book-view.png', 1280, 800, `${cap(1)}<img class="shot" src="${raw.book}" style="top:180px;width:1000px">`);
  await render('3-paper-tones.png', 1280, 800, `${cap(2)}<div class="row">${raw.themes.map((t) => `<img src="${t}">`).join('')}</div>`);
  await render('4-settings.png', 1280, 800, `${cap(3)}<img class="shot" src="${raw.sheet}" style="top:185px;left:60px;transform:none;width:820px"><img class="shot" src="${raw.popup}" style="top:185px;left:910px;transform:none;width:310px">`);
  const brand = (size, title, tag) => `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:${size * 0.35}px;background:#f1efe8">
      <img src="${icon}" style="width:${size}px;height:${size}px">
      <div><div style="font:600 ${size * 0.42}px/1.1 'Iowan Old Style',Georgia,'Songti SC',serif">${title}</div>
      <div style="font:400 ${size * 0.17}px/1.4 system-ui,-apple-system,'PingFang SC',sans-serif;color:#4a4a46;margin-top:${size * 0.06}px">${tag}</div></div></div>`;
  await render('promo-440x280.png', 440, 280, brand(96, c.name, c.tagline));
  await render('marquee-1400x560.png', 1400, 560, `${brand(150, c.name, c.tagline)}`);
  await page.close();
}

const raws = {};
for (const lang of ['en', 'zh']) raws[lang] = await capture(lang);
const browser = await puppeteer.launch({ headless: true });
for (const lang of ['en', 'zh']) await compose(browser, lang, raws[lang]);
await browser.close();
console.log(`store assets written to ${out}/{en,zh}`);
