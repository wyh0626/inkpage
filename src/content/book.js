/* InkPage book view — injected on demand into the top frame, after vendor/Readability.js.
 *
 * Mozilla Readability pulls the article out of the page; we typeset it inside a closed
 * shadow root and lay it out in CSS columns, one screen (or a two-page spread on wide
 * landscape screens) per page. Pages always break between lines, like an e-reader.
 *
 * The look follows a Kindle: a quiet page with only a clock above and progress below;
 * tap the top for the toolbars (back, title, Aa, a page slider); Aa opens Font / Layout /
 * Theme tabs. Literata stands in for Bookerly, which can't be redistributed.
 */
(() => {
  'use strict';
  if (globalThis.InkBook) return;

  const api = globalThis.browser ?? globalThis.chrome;
  const S = globalThis.InkSettings; // loaded with the content script in this same world
  const DOC = document;
  const ROOT = DOC.documentElement;
  const TAG = 'inkpage-book';
  const t = (key, fallback, ...subs) => {
    try { return api.i18n.getMessage(key, subs.map(String)) || fallback; } catch (_) { return fallback; }
  };

  // Bundled faces ("Ink…") come first; a copy the user has installed is the fallback.
  const LATIN = {
    literata: '"InkLiterata","Literata"',
    sourceserif: '"InkSourceSerif","Source Serif 4","InkLiterata"',
    charis: '"InkCharis","Charis SIL","Charter","InkLiterata"',
    palatino: '"Palatino Linotype","Palatino","Book Antiqua","URW Palladio L"',
    sans: '"Helvetica Neue","Helvetica","Arial"',
  };
  const CJK_FONTS = {
    song: '"Songti SC","STSong","SimSun","Noto Serif CJK SC","Source Han Serif SC","Noto Serif SC"',
    kai: '"Kaiti SC","STKaiti","KaiTi","BiauKai","TW-Kai","Noto Serif CJK SC"',
    hei: '"PingFang SC","Hiragino Sans GB","Heiti SC","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC"',
  };
  const UI_FONT = 'system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
  const MARGIN = { narrow: 0.035, normal: 0.07, wide: 0.12 };
  const MAX_COL = 680; // keeps lines near 60–75 characters on wide screens
  const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/g;
  const BLOCKS = '.head,.body p,.body h1,.body h2,.body h3,.body h4,.body h5,.body h6,.body li,.body blockquote,.body pre,.body figure,.body img,.body table,.body hr,.end';
  const POS_KEY = 'bookPos';

  let s = null; // state while open

  /* ------------------------------------------------------------------ fonts */

  // Bundled fonts are registered on the document (Chrome ignores @font-face inside shadow
  // roots) from bytes, so the page's CSP font-src never gets a say. Each face also gets a
  // "…CJK" twin without general punctuation, so Chinese quotes and dashes keep their
  // full-width shapes. A family is only fetched when it is first used or previewed.
  const LATIN_RANGE = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
  const EXT_RANGE = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
  const variable = (prefix) => [
    [`${prefix}-latin-wght-normal`, 'normal', '200 900', LATIN_RANGE], [`${prefix}-latin-wght-italic`, 'italic', '200 900', LATIN_RANGE],
    [`${prefix}-latin-ext-wght-normal`, 'normal', '200 900', EXT_RANGE], [`${prefix}-latin-ext-wght-italic`, 'italic', '200 900', EXT_RANGE],
  ];
  const FONT_FILES = {
    literata: ['InkLiterata', variable('literata')],
    sourceserif: ['InkSourceSerif', variable('source-serif-4')],
    charis: ['InkCharis', [
      ['charis-sil-latin-400-normal', 'normal', '400', LATIN_RANGE], ['charis-sil-latin-400-italic', 'italic', '400', LATIN_RANGE],
      ['charis-sil-latin-700-normal', 'normal', '700', LATIN_RANGE], ['charis-sil-latin-700-italic', 'italic', '700', LATIN_RANGE],
    ]],
  };
  const fontLoads = {};

  function loadFont(key) {
    const entry = FONT_FILES[key];
    if (!entry) return Promise.resolve();
    if (fontLoads[key]) return fontLoads[key];
    const [family, files] = entry;
    fontLoads[key] = Promise.all(files.map(async ([file, style, weight, range]) => {
      const buf = await fontBytes(`fonts/${file}.woff2`);
      if (!buf) return;
      const cjkRange = range.replace('U+2000-206F', 'U+2000-200F,U+2028-202F,U+205F-206F');
      for (const [name, unicodeRange] of [[family, range], [`${family}CJK`, cjkRange]]) {
        try {
          const face = new FontFace(name, buf.slice(0), { style, weight, unicodeRange });
          DOC.fonts.add(face);
          await face.load();
        } catch (_) {}
      }
    })).then(() => { if (s) soon(); });
    return fontLoads[key];
  }

  function loadFontsFor(c) {
    const key = c.bookFont;
    loadFont(key);
    if (key === 'charis' || key === 'sourceserif') loadFont('literata'); // their fallback
  }

  // Content-script requests for the extension's own files aren't subject to the page's
  // CSP (checked against connect-src/font-src 'none' in Chrome, Firefox and Safari).
  async function fontBytes(path) {
    try {
      const res = await fetch(api.runtime.getURL(path));
      if (res.ok) return await res.arrayBuffer();
    } catch (_) {}
    return null;
  }

  function fontStack(c, cjk) {
    const latinKey = c.bookFont;
    let latin = LATIN[latinKey] || LATIN.literata;
    if (cjk) latin = latin.replace(/"(Ink\w+)"/g, '"$1CJK"');
    const han = CJK_FONTS[c.bookCjkFont] || CJK_FONTS.song;
    return `${latin},${han},${latinKey === 'sans' ? 'sans-serif' : 'serif'}`;
  }

  /* ------------------------------------------------------------- extraction */

  function extract() {
    if (typeof Readability !== 'function') return null;
    let art = null;
    try {
      // serializer returns the element itself, so no HTML string is ever re-parsed.
      art = new Readability(DOC.cloneNode(true), { charThreshold: 300, serializer: (el) => el }).parse();
    } catch (_) {
      return null;
    }
    if (!art || !art.content) return null;
    const text = (art.textContent || '').trim();
    const cjk = (text.match(CJK) || []).length;
    if (cjk * 3 + (text.length - cjk) < 900) return null; // roughly 300 CJK characters or 150 words
    art.text = text;
    art.cjk = cjk;
    art.title = tidyTitle(art);
    return art;
  }

  // "Headline - Site Name" → "Headline"; then drop the article's own copy of the headline,
  // since the book view prints it on the title block.
  function tidyTitle(art) {
    const norm = (x) => String(x || '').replace(/\s+/g, ' ').trim();
    let title = norm(art.title || DOC.title);
    const site = norm(art.siteName);
    if (site && title.length > site.length) {
      title = title.replace(new RegExp(`\\s*[-|–—_·:：]\\s*${site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
    }
    const first = art.content.querySelector('h1, h2');
    if (first) {
      const h = norm(first.textContent);
      if (h && (h === title || title.startsWith(h))) {
        title = h;
        first.remove();
      }
    }
    // A short "By …" line near the top repeats the byline already on the title block.
    const byline = norm(art.byline);
    if (byline) {
      for (const n of Array.from(art.content.querySelectorAll('p, div, span, address')).slice(0, 6)) {
        const text = norm(n.textContent);
        if (text.includes(byline) && text.length <= byline.length + 24 && !n.querySelector('img')) { n.remove(); break; }
      }
    }
    return title;
  }

  function dateOf(art) {
    const d = art.publishedTime && new Date(art.publishedTime);
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  }

  function clean(root) {
    for (const el of root.querySelectorAll('script,style,link,meta,noscript,form,button,input,select,textarea,object,embed,template')) el.remove();
    for (const el of root.querySelectorAll('iframe,video,audio')) {
      const src = el.getAttribute('src') || (el.querySelector('source') && el.querySelector('source').getAttribute('src'));
      if (src && /^https?:/i.test(src)) {
        const p = DOC.createElement('p');
        const a = DOC.createElement('a');
        a.href = src;
        a.textContent = t('bookMedia', '▶ Embedded media (opens the original)');
        p.appendChild(a);
        el.replaceWith(p);
      } else {
        el.remove();
      }
    }
    for (const el of root.querySelectorAll('*')) {
      for (const { name } of Array.from(el.attributes)) {
        const n = name.toLowerCase();
        if (n.startsWith('on') || n === 'style' || n === 'class' || n === 'align' || n === 'bgcolor' || n === 'color') el.removeAttribute(name);
      }
      if (el.localName === 'a' && /^\s*javascript:/i.test(el.getAttribute('href') || '')) el.removeAttribute('href');
      if (el.localName === 'img') { el.loading = 'eager'; el.decoding = 'async'; }
    }
    return root;
  }

  /* ------------------------------------------------------------------ build */

  const CSS = `
    :host{all:initial}
    [hidden]{display:none!important}
    .book{position:fixed;inset:0;overflow:hidden;background:var(--bg);color:var(--fg);touch-action:pinch-zoom;
      -webkit-text-fill-color:currentColor;-webkit-text-stroke:var(--stroke) currentColor;
      font-family:var(--font);font-size:var(--size);line-height:var(--lead);
      text-rendering:optimizeLegibility;font-kerning:normal;font-variant-ligatures:common-ligatures;
      font-feature-settings:"kern","liga","onum" 0;-webkit-font-smoothing:antialiased}
    .book *{box-sizing:border-box;-webkit-text-fill-color:currentColor}
    .book{background-image:var(--paper-tex);background-size:var(--paper-tile)} /* grain + edge shading sit behind the text */

    /* page */
    .viewport{position:absolute;overflow:hidden}
    .flow{height:100%;column-fill:auto;padding:6px 0} /* room for tall glyphs at each column's edges */
    .head{padding:var(--headpad) 0 1.4em;margin:0 0 1.6em;text-align:center;break-inside:avoid;text-indent:0}
    .head h1{font-size:1.6em;line-height:1.22;margin:0 0 .7em;font-weight:600;letter-spacing:-.005em;text-wrap:balance}
    .by{margin:0;font-size:.78em;line-height:1.5;font-style:italic;color:var(--dim)}
    .head::after{content:"";display:block;width:2.5em;margin:1.3em auto 0;border-top:1px solid var(--rule)}
    .body{text-align:var(--align);hyphens:auto;-webkit-hyphens:auto;hyphenate-limit-chars:6 3 3;overflow-wrap:break-word}
    .body p{margin:0 0 var(--pgap);text-indent:var(--indent);orphans:2;widows:2}
    .body :is(h1,h2,h3,h4,h5,h6,figure,blockquote,ul,ol,pre,table,hr,div) + p,.body p:first-of-type,.body li p,.body blockquote p{text-indent:var(--indent-after)}
    .body :is(h1,h2,h3,h4,h5,h6){line-height:1.3;margin:1.5em 0 .7em;font-weight:600;text-align:left;break-after:avoid;break-inside:avoid;text-indent:0;hyphens:manual}
    .body h1{font-size:1.3em}.body h2{font-size:1.18em}.body h3{font-size:1.06em}.body :is(h4,h5,h6){font-size:1em;font-style:italic}
    .body :is(img,svg,picture,video){display:block;max-width:100%;max-height:var(--imgmax);width:auto;height:auto;margin:.9em auto;break-inside:avoid;object-fit:contain}
    .body figure{margin:1.1em 0;break-inside:avoid;text-indent:0}
    .body figcaption{font-size:.8em;line-height:1.45;color:var(--dim);text-align:center;text-indent:0;font-style:italic}
    .body blockquote{margin:1em 1.2em;font-size:.95em}
    .body pre{white-space:pre-wrap;word-break:break-all;font:.78em/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;padding:.2em 0 .2em 1em;border-left:2px solid var(--rule);text-align:left;text-indent:0}
    .body code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.86em}
    .body a{color:inherit;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.16em}
    .body table{display:block;max-width:100%;overflow:hidden;border-collapse:collapse;font-size:.82em;text-align:left;break-inside:avoid;text-indent:0}
    .body :is(td,th){border:1px solid var(--rule);padding:.25em .45em;vertical-align:top}
    .body :is(ul,ol){margin:.3em 0 var(--pgap);padding-left:1.5em;text-indent:0}
    .body li{margin:.15em 0}
    .body hr{border:0;margin:1.2em 0;text-align:center;height:1.4em}
    .body hr::after{content:"⁂";font-size:.9em}
    .noimg .body :is(img,svg,picture,figure){display:none}
    .graymedia .body :is(img,svg,picture,video){filter:grayscale(1)}
    .end{margin-top:2.4em;text-align:center;font-size:.85em;color:var(--dim);break-inside:avoid;text-indent:0;letter-spacing:.2em}

    /* quiet chrome: clock above, progress below */
    .ui{font-family:${UI_FONT};-webkit-text-stroke:0;font-size:12px;line-height:1.3}
    .clock{position:absolute;top:10px;left:0;right:0;text-align:center;color:var(--dim);font-size:11px;font-weight:500;letter-spacing:.02em}
    .foot{position:absolute;display:flex;justify-content:space-between;gap:16px;color:var(--dim);white-space:nowrap;font-size:11px}
    .foot .fl{overflow:hidden;text-overflow:ellipsis;min-width:0}
    .foot.bump{color:var(--fg);font-weight:700}

    /* toolbars (tap the top of the page) */
    .topbar{position:absolute;top:0;left:0;right:0;height:52px;display:flex;align-items:center;gap:8px;padding:0 6px;
      background:var(--bar);color:var(--fg);border-bottom:1px solid var(--rule);z-index:3}
    .topbar .title{flex:1;min-width:0;text-align:center;font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tb{border:0;background:none;color:var(--fg);font:inherit;font-size:14px;padding:10px 10px;cursor:pointer;white-space:nowrap}
    .tb.aa{font:600 19px/1 Georgia,"Songti SC",serif;padding:8px 12px}
    .tb[aria-expanded="true"]{background:var(--fg);color:var(--bg)}
    .bottombar{position:absolute;bottom:0;left:0;right:0;padding:12px 20px 16px;background:var(--bar);color:var(--fg);border-top:1px solid var(--rule);z-index:3}
    .bottombar .where{display:flex;justify-content:space-between;font-size:12px;margin-bottom:10px}
    .slider{-webkit-appearance:none;appearance:none;width:100%;height:24px;background:transparent;margin:0;cursor:pointer}
    .slider::-webkit-slider-runnable-track{height:3px;background:var(--fg)}
    .slider::-moz-range-track{height:3px;background:var(--fg)}
    .slider::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;margin-top:-7.5px;border-radius:50%;background:var(--bg);border:3px solid var(--fg)}
    .slider::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:var(--bg);border:3px solid var(--fg)}

    /* Aa sheet */
    .sheet{position:absolute;top:52px;left:50%;transform:translateX(-50%);width:min(460px,100%);max-height:calc(100% - 52px);overflow:auto;
      background:var(--bar);color:var(--fg);border:1px solid var(--rule);border-top:0;z-index:4;padding:0 18px 16px}
    .tabs{display:flex;border-bottom:1px solid var(--rule);margin:0 -18px 6px}
    .tabs button{flex:1;border:0;background:none;color:var(--fg);font:inherit;font-size:14px;padding:13px 0 11px;cursor:pointer;border-bottom:3px solid transparent}
    .tabs button[aria-selected="true"]{font-weight:700;border-bottom-color:var(--fg)}
    .prow{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0}
    .prow > span{font-size:13px}
    .fonts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:8px 0 4px}
    .fonts button{border:1px solid var(--rule);background:var(--bg);color:var(--fg);padding:12px 4px;font-size:17px;cursor:pointer;-webkit-text-stroke:0}
    .fonts button[aria-pressed="true"]{outline:3px solid var(--fg);outline-offset:-3px;font-weight:600}
    .swatches{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:8px 0 6px}
    .swatches button{border:1px solid var(--rule);padding:9px 2px 7px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;font:inherit}
    .swatches b{font:600 18px/1 Georgia,serif}.swatches span{font-size:11px}
    .swatches button[aria-pressed="true"]{outline:3px solid var(--fg);outline-offset:2px}
    .label{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;margin:14px 0 2px}
    .seg{display:inline-flex;border:1px solid var(--rule)}
    .seg button,.size button{border:0;background:var(--bg);color:var(--fg);font:inherit;font-size:13px;padding:6px 10px;cursor:pointer}
    .seg button+button{border-left:1px solid var(--rule)}
    .seg button[aria-pressed="true"]{background:var(--fg);color:var(--bg)}
    .size{display:flex;align-items:center;gap:10px;flex:1;justify-content:flex-end}
    .size .small{font:500 14px/1 Georgia,serif}.size .big{font:500 22px/1 Georgia,serif}
    .size input{flex:1;max-width:200px}
    .size .val{min-width:24px;text-align:center;font-size:12px;color:var(--dim)}
    .hint{margin:14px 0 0;color:var(--dim);font-size:11px;line-height:1.5}
    button:focus-visible,input:focus-visible{outline:2px solid var(--fg);outline-offset:2px}`;

  function el(tag, cls, text) {
    const n = DOC.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function button(cls, text, onClick) {
    const b = el('button', cls, text);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  function minutesOf(art) {
    const words = (art.text.replace(CJK, ' ').match(/[A-Za-z0-9À-ɏ’']+/g) || []).length;
    return Math.max(1, Math.round(art.cjk / 400 + words / 230));
  }

  function build(art) {
    const host = DOC.createElement(TAG);
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;display:block;';
    const shadow = host.attachShadow({ mode: 'closed' });

    const book = el('div', 'book');
    const lang = art.lang || ROOT.lang || '';
    const cjk = /^(zh|ja|ko)/i.test(lang) || art.cjk / Math.max(1, art.text.length) > 0.2;
    if (cjk) book.classList.add('cjk');

    const viewport = el('div', 'viewport');
    const flow = el('div', 'flow');
    const head = el('header', 'head');
    head.appendChild(el('h1', '', art.title || DOC.title));
    const minutes = minutesOf(art);
    const by = [art.byline, art.siteName || location.hostname, dateOf(art), t('bookReadTime', `${minutes} min read`, minutes)]
      .filter((x) => x && String(x).trim()).join(' · ');
    head.appendChild(el('p', 'by', by));
    const body = el('div', 'body');
    if (lang) body.lang = lang;
    body.appendChild(DOC.adoptNode(clean(art.content)));
    const end = el('div', 'end', t('bookEnd', '— End —'));
    flow.append(head, body, end);
    viewport.appendChild(flow);

    const clock = el('div', 'clock ui');
    const foot = el('div', 'foot ui');
    const fl = el('span', 'fl');
    const fr = el('span', 'fr');
    foot.append(fl, fr);

    // Toolbars
    const topbar = el('div', 'topbar ui');
    const back = button('tb', `‹ ${t('bookBack', 'Web page')}`, () => s.hooks.exit());
    const title = el('div', 'title', art.title || DOC.title);
    const aa = button('tb aa', 'Aa', () => toggleSheet());
    aa.title = t('bookSettings', 'Reading settings');
    aa.setAttribute('aria-expanded', 'false');
    topbar.append(back, title, aa);
    const bottombar = el('div', 'bottombar ui');
    const where = el('div', 'where');
    const whereL = el('span');
    const whereR = el('span');
    where.append(whereL, whereR);
    const slider = el('input', 'slider');
    slider.type = 'range';
    slider.min = '1';
    slider.addEventListener('input', () => { go(Number(slider.value) - 1, true); savePos(); });
    bottombar.append(where, slider);
    const sheet = buildSheet(cjk);
    topbar.hidden = bottombar.hidden = sheet.hidden = true;

    book.append(viewport, clock, foot, topbar, bottombar, sheet);
    shadow.append(book);
    const css = S.mountCss(shadow, CSS);
    return {
      host, shadow, book, css, viewport, flow, body, end, clock, foot, fl, fr,
      topbar, bottombar, whereL, whereR, slider, aa, sheet, minutes, cjk,
    };
  }

  function buildSheet(cjk) {
    const sheet = el('div', 'sheet ui');
    const tabs = el('div', 'tabs');
    const panes = {};
    const show = (name) => {
      for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === name));
      for (const [k, p] of Object.entries(panes)) p.hidden = k !== name;
    };
    for (const [name, label] of [['font', t('tabFont', 'Font')], ['layout', t('tabLayout', 'Layout')], ['theme', t('tabTheme', 'Theme')]]) {
      const b = button('', label, () => show(name));
      b.dataset.tab = name;
      b.setAttribute('role', 'tab');
      tabs.appendChild(b);
      panes[name] = el('div');
    }
    sheet.appendChild(tabs);

    const row = (pane, label, control) => {
      const r = el('div', 'prow');
      r.append(el('span', '', label), control);
      pane.appendChild(r);
    };
    const seg = (key, options) => {
      const g = el('div', 'seg');
      g.dataset.key = key;
      for (const [value, label] of options) {
        const b = button('', label, () => save({ [key]: value }));
        b.dataset.v = String(value);
        g.appendChild(b);
      }
      return g;
    };
    // Font choices are drawn in their own typeface, like a Kindle's font list.
    const fontGrid = (key, options) => {
      const g = el('div', 'fonts');
      g.dataset.key = key;
      for (const [value, label, family] of options) {
        const b = button('', label, () => save({ [key]: value }));
        b.dataset.v = value;
        b.style.fontFamily = family;
        g.appendChild(b);
      }
      return g;
    };

    const f = panes.font;
    const latinGrid = fontGrid('bookFont', [
      ['literata', 'Literata', `${LATIN.literata},serif`],
      ['sourceserif', 'Source Serif', `${LATIN.sourceserif},serif`],
      ['charis', 'Charis', `${LATIN.charis},serif`],
      ['palatino', 'Palatino', `${LATIN.palatino},serif`],
      ['sans', 'Helvetica', `${LATIN.sans},sans-serif`],
    ]);
    const hanGrid = fontGrid('bookCjkFont', [
      ['song', t('fontSong', 'Song'), `${CJK_FONTS.song},serif`],
      ['kai', t('fontKai', 'Kai'), `${CJK_FONTS.kai},serif`],
      ['hei', t('fontHei', 'Hei'), `${CJK_FONTS.hei},sans-serif`],
    ]);
    // Chinese articles list the Chinese faces first.
    const groups = [[t('latinFont', 'Latin font'), latinGrid], [t('cjkFont', 'Chinese font'), hanGrid]];
    if (cjk) groups.reverse();
    for (const [label, grid] of groups) f.append(el('div', 'label', label), grid);
    const size = el('div', 'size');
    const range = el('input', 'slider');
    range.type = 'range';
    range.min = String(S.LIMITS.bookSize.min);
    range.max = String(S.LIMITS.bookSize.max);
    range.step = '2';
    range.addEventListener('change', () => save({ bookSize: Number(range.value) }));
    size.append(el('span', 'small', 'A'), range, el('span', 'big', 'A'), el('span', 'val'));
    f.appendChild(el('div', 'label', t('bookSize', 'Text size')));
    f.appendChild(size);
    row(f, t('textWeight', 'Boldness'), seg('textWeight', [[0, t('weight0', 'Original')], [1, t('weight1', 'Bolder')], [2, t('weight2', 'Heavy')]]));

    const l = panes.layout;
    row(l, t('bookLeading', 'Line spacing'), seg('bookLeading', [[1.5, t('leadTight', 'Tight')], [1.7, t('leadNormal', 'Normal')], [1.9, t('leadLoose', 'Loose')]]));
    row(l, t('bookMargin', 'Margins'), seg('bookMargin', [['narrow', t('marginNarrow', 'Narrow')], ['normal', t('marginNormal', 'Normal')], ['wide', t('marginWide', 'Wide')]]));
    row(l, t('bookAlign', 'Alignment'), seg('bookAlign', [['justify', t('alignJustify', 'Justified')], ['left', t('alignLeft', 'Left')]]));
    row(l, t('bookParagraph', 'Paragraphs'), seg('bookParagraph', [['indent', t('paraIndent', 'Indent')], ['space', t('paraSpace', 'Spaced')]]));

    const th = panes.theme;
    // Paper swatches: each shows its own ink on its own paper.
    const sw = el('div', 'swatches');
    sw.dataset.key = 'theme';
    for (const [name, label] of [['paper', t('themePaper', 'White')], ['gray', t('themeGray', 'Gray')], ['sepia', t('themeSepia', 'Warm')], ['green', t('themeGreen', 'Green')], ['night', t('themeNight', 'Night')]]) {
      const tone = S.themeOf(name);
      const b = button('', '', () => save({ theme: name }));
      b.dataset.v = name;
      b.style.background = tone.bg;
      b.style.color = tone.fg;
      b.append(el('b', '', 'Aa'), el('span', '', label));
      sw.appendChild(b);
    }
    th.append(el('div', 'label', t('theme', 'Theme')), sw);
    row(th, t('paperGrain', 'Paper grain'), seg('paperGrain', [[0, t('off', 'Off')], [1, t('lvlLight', 'Light')], [2, t('lvlMedium', 'Medium')], [3.5, t('lvlStrong', 'Strong')]]));
    row(th, t('paperShade', 'Edge shading'), seg('paperShade', [[0, t('off', 'Off')], [3, t('lvlLight', 'Light')], [5, t('lvlMedium', 'Medium')], [8, t('lvlStrong', 'Strong')]]));
    row(th, t('bookClock', 'Show clock'), seg('bookClock', [[true, t('on', 'On')], [false, t('off', 'Off')]]));
    row(th, t('bookFooter', 'Footer'), seg('bookFooter', [['page', t('footPage', 'Page')], ['time', t('footTime', 'Time left')], ['none', t('footNone', 'Off')]]));
    row(th, t('pageRefresh', 'Page refresh'), seg('autoRefresh', [[0, t('off', 'Off')], [1, t('refreshEvery', 'Every page')], [5, '5'], [10, '10']]));

    for (const p of Object.values(panes)) sheet.appendChild(p);
    sheet.appendChild(el('p', 'hint', t('bookHint', 'Tap the left side for the previous page, anywhere else for the next · tap the top for menus · Esc: back to the web page')));
    show('font');
    return sheet;
  }

  function save(patch) {
    if (s) s.hooks.save(patch);
  }

  function syncSheet() {
    const { sheet } = s.ui;
    for (const g of sheet.querySelectorAll('[data-key]')) {
      const key = g.dataset.key;
      const cur = s.cfg[key];
      for (const b of g.children) b.setAttribute('aria-pressed', String(String(cur) === b.dataset.v));
    }
    const range = sheet.querySelector('.size input');
    range.value = String(s.cfg.bookSize);
    sheet.querySelector('.size .val').textContent = String(s.cfg.bookSize);
  }

  function chromeOpen() {
    return !s.ui.topbar.hidden;
  }

  function toggleChrome(force) {
    const show = force ?? !chromeOpen();
    s.ui.topbar.hidden = s.ui.bottombar.hidden = !show;
    if (!show) toggleSheet(false);
    else updateFoot();
  }

  function toggleSheet(force) {
    const { sheet, aa } = s.ui;
    const show = force ?? sheet.hidden;
    sheet.hidden = !show;
    aa.setAttribute('aria-expanded', String(show));
    if (show) for (const key of Object.keys(FONT_FILES)) loadFont(key); // so the font buttons preview themselves
  }

  /* ----------------------------------------------------------------- layout */

  function applyLook() {
    const c = s.cfg;
    const { book } = s.ui;
    const th = S.themeOf(c.theme);
    for (const [k, v] of [['--bg', th.bg], ['--fg', th.fg], ['--dim', th.dim], ['--rule', th.rule], ['--bar', th.bg]]) {
      book.style.setProperty(k, v);
    }
    const tex = S.paperBackground(c);
    book.style.setProperty('--paper-tex', tex);
    // Shading (if any) is the first layer and stretches; grain tiles at device-pixel size.
    const tile = `${Math.round(256 / Math.min(window.devicePixelRatio || 1, 2))}px`;
    book.style.setProperty('--paper-tile', c.paperShade && !S.isDark(c.theme) ? `cover,${tile}` : tile);
    book.classList.toggle('noimg', c.images === 'hide');
    book.classList.toggle('graymedia', !!c.grayscale);
    const indentMode = c.bookParagraph !== 'space';
    const cjk = s.ui.cjk;
    book.style.setProperty('--font', fontStack(c, cjk));
    book.style.setProperty('--size', `${c.bookSize}px`);
    book.style.setProperty('--lead', String(c.bookLeading));
    book.style.setProperty('--align', c.bookAlign === 'left' ? 'left' : 'justify');
    book.style.setProperty('--stroke', c.textWeight > 1 ? '.6px' : c.textWeight ? '.3px' : '0px');
    // Book-style paragraphs: first-line indent and no gap, except right after a heading.
    // Chinese always indents two characters.
    book.style.setProperty('--indent', cjk ? '2em' : indentMode ? '1.5em' : '0');
    book.style.setProperty('--indent-after', cjk ? '2em' : '0');
    book.style.setProperty('--pgap', indentMode ? (cjk ? '.2em' : '0') : '.85em');
    syncSheet();
  }

  function flowLeft() {
    return s.ui.flow.getBoundingClientRect().left;
  }

  function pageOf(node) {
    const r = node.getClientRects()[0] || node.getBoundingClientRect();
    return Math.max(0, Math.floor((r.left - flowLeft() + 2) / s.step));
  }

  // Where the reader is: the first block that starts on the current page (exact), or
  // failing that, the reading fraction.
  function anchorNow() {
    if (!s.pages) return null;
    const fl = flowLeft();
    for (let i = 0; i < s.blocks.length; i++) {
      const r = s.blocks[i].getClientRects()[0];
      if (!r) continue;
      const p = Math.floor((r.left - fl + 2) / s.step);
      if (p === s.page) return { i, f: s.page / s.pages };
      if (p > s.page) break;
    }
    return { i: -1, f: s.page / s.pages };
  }

  function pageFor(anchor) {
    if (anchor && anchor.i >= 0 && s.blocks[anchor.i]) return pageOf(s.blocks[anchor.i]);
    return Math.round(((anchor && anchor.f) || 0) * s.pages);
  }

  function layout(anchor) {
    const { viewport, flow, foot, book, end } = s.ui;
    const c = s.cfg;
    const vw = innerWidth;
    const vh = innerHeight;
    const cols = vw >= 1000 && vw / vh >= 1.3 ? 2 : 1;
    let side = Math.max(18, Math.round(vw * (MARGIN[c.bookMargin] || MARGIN.normal)));
    const gap = cols === 2 ? Math.max(56, side) : 2 * side;
    let colW = cols === 2 ? Math.floor((vw - 2 * side - gap) / 2) : vw - 2 * side;
    if (colW > MAX_COL) {
      colW = MAX_COL;
      side = Math.floor((vw - cols * colW - (cols - 1) * gap) / 2);
    }
    const viewW = cols * colW + (cols - 1) * gap;
    const top = Math.round(Math.max(40, vh * 0.065));
    const bottom = 44;
    const H = vh - top - bottom;
    Object.assign(viewport.style, { left: `${side}px`, top: `${top}px`, width: `${viewW}px`, height: `${H}px` });
    flow.style.columnWidth = `${colW}px`;
    flow.style.columnGap = `${gap}px`;
    Object.assign(foot.style, { left: `${side}px`, right: `${side}px`, bottom: '16px' });
    book.style.setProperty('--imgmax', `${Math.floor(H * 0.9)}px`);
    book.style.setProperty('--headpad', `${Math.round(H * 0.12)}px`); // title sits lower, like a title page
    s.step = viewW + gap;
    flow.style.transform = 'translateX(0)';
    s.pages = Math.max(1, pageOf(end) + 1);
    s.blocks = Array.from(flow.querySelectorAll(BLOCKS));
    s.ui.slider.max = String(s.pages);
    go(anchor ? pageFor(anchor) : Math.min(s.page, s.pages - 1), true);
  }

  function relayout() {
    if (!s) return;
    layout(anchorNow());
  }

  function go(n, quiet) {
    n = Math.max(0, Math.min(s.pages - 1, n));
    const moved = n !== s.page;
    s.page = n;
    s.ui.flow.style.transform = `translateX(${-n * s.step}px)`;
    updateFoot();
    if (!quiet && moved) {
      s.turns++;
      if (s.cfg.autoRefresh && s.turns % s.cfg.autoRefresh === 0) s.hooks.flash();
      savePos();
    }
    return moved;
  }

  function turn(d) {
    if (go(s.page + d)) return;
    const { foot } = s.ui; // already on the first / last page
    foot.classList.add('bump');
    setTimeout(() => foot.classList.remove('bump'), 400);
  }

  function pageText() {
    return t('bookPageOf', `Page ${s.page + 1} of ${s.pages}`, s.page + 1, s.pages);
  }

  function timeText() {
    if (s.page + 1 >= s.pages) return t('bookDone', 'Finished');
    const left = Math.max(1, Math.ceil(s.ui.minutes * (1 - (s.page + 1) / s.pages)));
    return t('bookLeft', `${left} min left in article`, left);
  }

  function updateFoot() {
    const { fl, fr, foot, whereL, whereR, slider } = s.ui;
    const mode = s.cfg.bookFooter || 'page';
    const pct = `${Math.round(((s.page + 1) / s.pages) * 100)}%`;
    foot.hidden = !s.cfg.pageIndicator || mode === 'none';
    fl.textContent = mode === 'time' ? timeText() : pageText();
    fr.textContent = pct;
    whereL.textContent = pageText();
    whereR.textContent = `${timeText()} · ${pct}`;
    slider.value = String(s.page + 1);
  }

  function tick() {
    if (!s) return;
    const { clock } = s.ui;
    clock.hidden = s.cfg.bookClock === false;
    clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /* --------------------------------------------------------------- position */

  const urlKey = () => location.origin + location.pathname + location.search;
  let saveTimer = 0;

  function savePos() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (!s) return;
      const a = anchorNow();
      try {
        const got = await api.storage.local.get(POS_KEY);
        const all = got[POS_KEY] || {};
        all[urlKey()] = { i: a.i, f: a.f, t: Date.now() };
        const keys = Object.keys(all);
        if (keys.length > 300) {
          keys.sort((x, y) => all[x].t - all[y].t).slice(0, keys.length - 300).forEach((k) => delete all[k]);
        }
        await api.storage.local.set({ [POS_KEY]: all });
      } catch (_) {}
    }, 600);
  }

  async function restorePos() {
    try {
      const got = await api.storage.local.get(POS_KEY);
      const a = (got[POS_KEY] || {})[urlKey()];
      if (s && a) go(pageFor(a), true);
    } catch (_) {}
  }

  /* ----------------------------------------------------------------- input */

  function onKey(e) {
    if (!s || e.ctrlKey || e.metaKey || e.altKey) return;
    const focus = s.ui.shadow.activeElement;
    if (focus && (focus.localName === 'input' || (focus.localName === 'button' && (e.key === ' ' || e.key === 'Enter')))) return;
    let handled = true;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': case 'PageDown': turn(1); break;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp': turn(-1); break;
      case ' ': case 'Spacebar': turn(e.shiftKey ? -1 : 1); break;
      case 'Home': go(0); break;
      case 'End': go(s.pages - 1); break;
      case 'Escape':
        if (chromeOpen()) toggleChrome(false);
        else s.hooks.exit();
        break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
    if (e.key.length === 1 || handled) e.stopImmediatePropagation(); // keep the hidden page's shortcuts quiet
  }

  let down = null;
  let swiped = false;

  function onPointerDown(e) {
    down = { x: e.clientX, y: e.clientY };
    swiped = false;
  }

  function onPointerUp(e) {
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    down = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && !chromeOpen()) {
      swiped = true;
      turn(dx < 0 ? 1 : -1);
    }
  }

  function onClick(e) {
    const path = e.composedPath();
    const within = (sel) => path.some((n) => n.nodeType === 1 && n.matches && n.matches(sel));
    if (within('.topbar,.bottombar,.sheet')) return;
    const link = path.find((n) => n.nodeType === 1 && n.localName === 'a' && n.hasAttribute('href'));
    if (link && !chromeOpen()) {
      const href = link.getAttribute('href');
      if (href.startsWith('#')) { // footnotes and in-article links stay inside the book
        e.preventDefault();
        const target = s.ui.shadow.getElementById(decodeURIComponent(href.slice(1)));
        if (target) go(pageOf(target));
      }
      return;
    }
    if (swiped) return;
    if (chromeOpen()) { toggleChrome(false); return; }
    const sel = s.ui.shadow.getSelection ? s.ui.shadow.getSelection() : getSelection();
    if (sel && !sel.isCollapsed) return;
    // Kindle-style zones: top strip opens the menus, footer cycles what it shows,
    // left side goes back, everything else goes forward.
    if (e.clientY < innerHeight * 0.12) { toggleChrome(true); return; }
    if (e.clientY > innerHeight - 44 && e.clientX < innerWidth * 0.6 && !s.ui.foot.hidden) {
      const order = ['page', 'time'];
      save({ bookFooter: order[(order.indexOf(s.cfg.bookFooter) + 1) % order.length] });
      return;
    }
    if (e.clientX < innerWidth * 0.3) turn(-1);
    else turn(1);
  }

  let wheelLast = 0;
  let wheelAcc = 0;
  let wheelDone = false;
  function onWheel(e) {
    if (e.ctrlKey) return; // pinch zoom
    if (e.composedPath().some((n) => n === s.ui.sheet)) return; // let the settings sheet scroll
    e.preventDefault();
    const now = performance.now();
    if (now - wheelLast > 250) { wheelAcc = 0; wheelDone = false; }
    wheelLast = now;
    if (wheelDone) return; // one page per flick
    wheelAcc += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * (e.deltaMode === 1 ? 16 : 1);
    if (Math.abs(wheelAcc) >= 30) { turn(Math.sign(wheelAcc)); wheelDone = true; }
  }

  let relayoutTimer = 0;
  function soon() {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(relayout, 180);
  }

  /* ------------------------------------------------------------------- API */

  // The hidden page still sees events that bubble out of the book (they reach document and
  // window retargeted to our host), and carousels or swipe-to-switch-tab scripts listening
  // there would change the page underneath. The book's own listeners run first, on .book.
  const SEALED = ['touchstart', 'touchmove', 'touchend', 'touchcancel',
    'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
    'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel',
    'gesturestart', 'gesturechange', 'gestureend'];
  const seal = (e) => e.stopPropagation();

  function open(cfg, hooks, art = extract()) {
    if (s) { update(cfg); return true; }
    if (!art) return false;
    loadFontsFor(cfg);
    const ui = build(art);
    s = { cfg, hooks, ui, text: art.text, page: 0, pages: 0, step: 1, turns: 0, blocks: [] };
    ROOT.setAttribute('data-ink-book', '');
    ROOT.appendChild(ui.host);
    ui.css.update(CSS); // now that it's attached: falls back to a constructed sheet if CSP blocked <style>
    if (DOC.activeElement && DOC.activeElement.blur) DOC.activeElement.blur();
    applyLook();
    layout(null);
    restorePos();
    tick();
    s.clockTimer = setInterval(tick, 15000);

    window.addEventListener('keydown', onKey, true);
    // Rotation and window resizes don't always fire "resize"; watch the book's own box.
    let lastSize = `${innerWidth}x${innerHeight}`;
    s.resizer = new ResizeObserver(() => {
      const size = `${innerWidth}x${innerHeight}`;
      if (size !== lastSize) { lastSize = size; soon(); }
    });
    s.resizer.observe(ui.book);
    ui.book.addEventListener('pointerdown', onPointerDown);
    ui.book.addEventListener('pointerup', onPointerUp);
    ui.book.addEventListener('click', onClick);
    ui.book.addEventListener('wheel', onWheel, { passive: false });
    for (const type of SEALED) ui.book.addEventListener(type, seal, { passive: true });
    ui.flow.addEventListener('load', soon, true); // images arriving change the page count
    ui.flow.addEventListener('error', soon, true);
    if (DOC.fonts && DOC.fonts.ready) DOC.fonts.ready.then(() => s && soon());
    return true;
  }

  function update(cfg) {
    if (!s) return;
    s.cfg = cfg;
    loadFontsFor(cfg);
    const anchor = anchorNow();
    applyLook();
    layout(anchor);
    tick();
  }

  function close() {
    if (!s) return;
    window.removeEventListener('keydown', onKey, true);
    s.resizer.disconnect();
    clearInterval(s.clockTimer);
    clearTimeout(relayoutTimer);
    s.ui.host.remove();
    ROOT.removeAttribute('data-ink-book');
    s = null;
  }

  // The address changed under an open book (a single-page app, or a page that rewrites its
  // own URL). Swap the article in place, within one task, so the original page never shows;
  // keep the book as it is when the text is the same. Returns false once there's no article.
  function reload() {
    if (!s) return false;
    const art = extract();
    if (!art) { close(); return false; }
    if (art.text === s.text) return true;
    const { cfg, hooks } = s;
    close();
    return open(cfg, hooks, art);
  }

  globalThis.InkBook = {
    open,
    update,
    close,
    reload,
    isOpen: () => !!s,
    turn: (d) => s && turn(d),
    state: () => (s ? { page: s.page, pages: s.pages, step: s.step } : null), // for tests
  };
})();
