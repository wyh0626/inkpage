/* InkPage shared settings — loaded by the content script, popup, options page and background. */
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({
    theme: 'paper',        // see THEMES
    paperGrain: 0,         // book view: fixed fine grain, max blend weight in % (0 = off)
    paperShade: 0,         // book view: soft darkening toward the edges, in % (0 = off)
    grayscale: true,       // drain all colour (turn off on real e-ink screens to save GPU work)
    paging: true,          // screen-by-screen page turns instead of scrolling
    cleanEdges: true,      // never show a half-cut line at the bottom of a page
    pageIndicator: true,   // small "3 / 12" badge
    arrowKeys: true,       // arrow keys turn pages too (not only Space / PageDown)
    tapZones: 'auto',      // 'auto' (touch screens only) | 'on' | 'off'
    wheelPaging: false,    // one wheel notch = one page
    noMotion: true,        // stop CSS / JS animations, transitions, autoplay video
    freezeGif: true,       // show GIFs as a still frame, click to play
    unpin: true,           // fixed / sticky bars stop following the scroll
    textWeight: 1,         // 0 original | 1 bolder | 2 heavy  (thin web fonts fade on e-ink)
    font: 'original',      // 'original' | 'serif' | 'sans'
    images: 'normal',      // 'normal' | 'contrast' | 'hide'
    autoRefresh: 0,        // flash the screen every N page turns to clear ghosting (0 = off)
    mode: 'page',          // 'page' (the site's own layout) | 'book' (article re-typeset like an e-reader)
    bookFont: 'literata',  // 'literata' | 'sourceserif' | 'charis' | 'palatino' | 'sans'
    bookCjkFont: 'song',   // 'song' | 'kai' | 'hei'
    bookSize: 20,          // px
    bookLeading: 1.7,      // line height
    bookMargin: 'normal',  // 'narrow' | 'normal' | 'wide'
    bookAlign: 'justify',  // 'justify' | 'left'
    bookParagraph: 'indent', // 'indent' (book style) | 'space' (web style)
    bookFooter: 'page',    // 'page' | 'time' | 'none'
    bookClock: true,       // small clock above the page
  });

  const LIMITS = { bookSize: { min: 14, max: 32 } };

  // Paper and ink. dim = secondary text, rule = hairlines.
  const THEMES = {
    paper: { bg: '#ffffff', fg: '#000000', dim: '#555555', rule: '#000000' },
    gray: { bg: '#e9e7df', fg: '#30322e', dim: '#5f615b', rule: '#30322e' },
    sepia: { bg: '#fbf0d9', fg: '#5f4b32', dim: '#86704f', rule: '#5f4b32' },
    green: { bg: '#c5e7ce', fg: '#3a4b43', dim: '#5a6d64', rule: '#3a4b43' },
    night: { bg: '#000000', fg: '#acacac', dim: '#7c7c7c', rule: '#acacac' },
  };
  const themeOf = (name) => THEMES[name] || THEMES.paper;
  const isDark = (name) => name === 'night';
  const isTinted = (name) => name === 'gray' || name === 'sepia' || name === 'green';

  // A static grain tile: seeded noise (same every time, so it never shimmers), each pixel
  // black or white with an alpha up to `percent`% — a background layer, never over text.
  const grainCache = {};
  function grainTile(percent) {
    if (!percent || typeof document === 'undefined') return null;
    if (grainCache[percent]) return grainCache[percent];
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    let seed = 314159;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      const v = seed / 4294967296;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v < 0.5 ? 0 : 255;
      img.data[i + 3] = Math.round(Math.abs(v - 0.5) * 2 * percent * 2.55);
    }
    ctx.putImageData(img, 0, 0);
    return (grainCache[percent] = c.toDataURL('image/png'));
  }

  // CSS background layers for the paper: edge shading above, grain below.
  function paperBackground(c) {
    const layers = [];
    if (c.paperShade && !isDark(c.theme)) {
      layers.push(`radial-gradient(farthest-corner at 50% 45%,transparent 8%,rgba(0,0,0,${c.paperShade / 100}) 100%)`);
    }
    const tile = grainTile(c.paperGrain);
    if (tile) layers.push(`url("${tile}")`);
    return layers.length ? layers.join(',') : 'none';
  }

  // Adds CSS to a document or shadow root: a <style> element first. A page CSP without
  // 'unsafe-inline' blocks that in Safari (Chrome and Firefox let content scripts through),
  // so then the same text goes in as a constructed stylesheet, which CSP doesn't govern.
  function mountCss(root, text, attrs) {
    const doc = root.nodeType === 9 ? root : root.ownerDocument;
    const parent = root.nodeType === 9 ? root.documentElement : root;
    const el = doc.createElement('style');
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    el.textContent = text;
    parent.appendChild(el);
    let sheet = null;
    const applied = () => {
      try { return !!(el.sheet && el.sheet.cssRules.length); } catch (_) { return true; } // unreadable = it exists
    };
    const check = () => {
      if (sheet || !el.isConnected || applied() || !text.trim()) return;
      try {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(text);
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      } catch (_) {
        sheet = null;
      }
    };
    check();
    Promise.resolve().then(check); // a shadow root's host may be attached right after this call
    return {
      el,
      update(next) {
        text = next;
        if (el.textContent !== next) el.textContent = next;
        if (el.parentNode !== parent) parent.appendChild(el);
        if (sheet) sheet.replaceSync(next);
        else check();
      },
      remove() {
        el.remove();
        if (sheet) root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== sheet);
        sheet = null;
      },
    };
  }

  function siteKey(hostname) {
    return String(hostname || '').toLowerCase().replace(/^www\./, '');
  }

  // Store layout: { defaults: {...}, sites: { "example.com": { enabled, ...overrides } }, everywhere: bool }
  function resolve(store, hostname) {
    store = store || {};
    const key = siteKey(hostname);
    const site = (store.sites && store.sites[key]) || {};
    const out = Object.assign({}, DEFAULTS, store.defaults || {}, site);
    out.enabled = typeof site.enabled === 'boolean' ? site.enabled : !!store.everywhere;
    out.site = key;
    return out;
  }

  root.InkSettings = {
    DEFAULTS, LIMITS, THEMES, themeOf, isDark, isTinted, paperBackground, mountCss, siteKey, resolve,
    KEYS: ['defaults', 'sites', 'everywhere'],
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
