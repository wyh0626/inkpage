/* InkPage content script — runs in every frame at document_start.
 *
 * Colour:  text goes to ink, surfaces that were opaque become paper, surfaces that were
 *          see-through stay see-through (so overlays, menus and modals still read correctly).
 * Motion:  CSS animations/transitions jump to their end state, WAAPI animations finish,
 *          muted autoplay video pauses, GIFs freeze on a still frame.
 * Paging:  one key / tap / wheel notch = one screen, minus pinned bars, never cutting a line.
 */
(() => {
  'use strict';
  if (window.__inkpageLoaded) return;
  window.__inkpageLoaded = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const S = globalThis.InkSettings;
  const DOC = document;
  const ROOT = DOC.documentElement;
  if (!api || !S || !ROOT || !(DOC instanceof HTMLDocument)) return;

  const IS_TOP = window.top === window;
  const UI_TAG = 'inkpage-ui';
  const BOOK_TAG = 'inkpage-book';
  const ours = (n) => n.localName === UI_TAG || n.localName === BOOK_TAG;
  const PROBE = 'data-ink-probe';
  const HOLD = 'data-ink-hold'; // freezes transitions while we peek, so a peek never animates
  const ATTRS = ['data-ink-layer', 'data-ink-clear', 'data-ink-unpin', 'data-ink-overlay'];

  let site = '';
  let cfg = null;
  let active = false;
  const t = (key, fallback) => { try { return api.i18n.getMessage(key) || fallback; } catch (_) { return fallback; } };

  /* ------------------------------------------------------------------ CSS */

  // :not(#id) adds ID-level specificity without restricting matches, so our !important
  // rules beat the site's !important rules that use one ID or less.
  const E = `:not([${PROBE}]):not(#ink_x):not(#ink_x)`;
  const X = `${E}:not(#ink_y)`; // one notch stronger, for targeted rules
  const SERIF = '"Iowan Old Style","Charter","Georgia","Songti SC","Noto Serif CJK SC","Source Han Serif SC","Noto Serif SC",serif';
  const SANS = 'system-ui,-apple-system,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
  const ICONISH = '[class*="icon" i],[class*="fa-"],[class*="material" i],[class*="symbol" i],[class*="glyph" i],[aria-hidden="true"],i:empty,svg,svg *';

  function buildCss(c, forDocument) {
    const P = forDocument ? 'html[data-inkpage] ' : '';
    const r = [];
    if (forDocument) {
      const th = S.themeOf(c.theme);
      // Tinted paper would be washed out by a page-wide grayscale filter, so then only media lose colour.
      const pageGray = c.grayscale && !S.isTinted(c.theme);
      r.push(`html[data-inkpage]{--ink-bg:${th.bg};--ink-fg:${th.fg};--ink-dim:${th.dim};background:var(--ink-bg)!important;color-scheme:${S.isDark(c.theme) ? 'dark' : 'light'}!important;${pageGray ? 'filter:grayscale(1)!important;' : ''}}`);
      r.push(`html[data-inkpage] body${X}{background-color:var(--ink-bg)!important}`);
    }
    // Ink everywhere; only non-empty boxes lose their fill (empty ones are icons, dots, bars, toggles).
    r.push(`${P}*${E},${P}*${E}::before,${P}*${E}::after{color:var(--ink-fg)!important;-webkit-text-fill-color:var(--ink-fg)!important;text-shadow:none!important;box-shadow:none!important;accent-color:var(--ink-fg)!important}`);
    r.push(`${P}*${E}:not(:empty){background-color:transparent!important}`);
    // Boxes that were opaque before we touched them become paper (found by the scanner).
    r.push(`${P}[data-ink-layer]${X}{background-color:var(--ink-bg)!important}`);
    r.push(`${P}[data-ink-layer="pop"]${X}{box-shadow:0 0 0 1px var(--ink-fg)!important}`);
    r.push(`${P}[data-ink-clear]${X}{background-color:transparent!important;background-image:none!important}`);
    // Keep affordances that colour used to carry.
    r.push(`${P}:is(p,li,dd,td,blockquote,figcaption) a[href]${X}{text-decoration:underline!important;text-decoration-thickness:1px!important;text-underline-offset:.15em!important}`);
    r.push(`${P}:is(button,[role="button"],input[type="button" i],input[type="submit" i],input[type="reset" i]):not(:has(> svg:only-child,> img:only-child,> i:only-child))${X}{border:1px solid var(--ink-fg)!important}`);
    r.push(`${P}:is(input:not([type="checkbox" i],[type="radio" i],[type="range" i],[type="color" i],[type="image" i],[type="file" i]),textarea,select)${X}{background-color:var(--ink-bg)!important;border:1px solid var(--ink-fg)!important}`);
    r.push(`${P}*${E}::placeholder{color:var(--ink-dim)!important;-webkit-text-fill-color:var(--ink-dim)!important;opacity:1!important}`);
    r.push(`${P}*${E}::selection{background:var(--ink-fg)!important;color:var(--ink-bg)!important;-webkit-text-fill-color:var(--ink-bg)!important}`);
    r.push(`${P}*${E}:focus-visible{outline:2px solid var(--ink-fg)!important;outline-offset:2px!important}`);
    r.push(`${P}:is([aria-selected="true"],[aria-current]:not([aria-current="false"]),[aria-pressed="true"])${X}{text-decoration:underline!important;text-decoration-thickness:2px!important;text-underline-offset:.25em!important}`);
    r.push(`${P}mark${X}{background-color:var(--ink-fg)!important;color:var(--ink-bg)!important;-webkit-text-fill-color:var(--ink-bg)!important}`);
    r.push(`${P}:is(pre,kbd)${X}{border:1px solid var(--ink-dim)!important}`);
    r.push(`${P}hr${X}{border-color:var(--ink-fg)!important}`);

    if (c.unpin) {
      r.push(`${P}[data-ink-unpin="top"]${X}{position:absolute!important}`);
      r.push(`${P}[data-ink-unpin="bottom"]${X}{position:static!important}`);
      r.push(`${P}[data-ink-unpin="sticky"]${X}{position:relative!important;top:auto!important;bottom:auto!important}`);
    }
    r.push(`[${HOLD}],[${HOLD}]::before,[${HOLD}]::after{transition:none!important}`);
    if (c.noMotion) {
      // Not "animation:none": that leaves fade-in content stuck at opacity 0. A near-zero
      // duration jumps to the end state and still fires animationend. Transitions get 0s so
      // no style change (ours included) ever paints an in-between frame.
      r.push(`${P}*${E},${P}*${E}::before,${P}*${E}::after{animation-duration:.01ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}`);
      if (forDocument) r.push('html[data-inkpage]{scroll-behavior:auto!important}');
    }
    if (c.freezeGif) r.push(`${P}img[data-ink-gif="frozen"]${X}{display:none!important}`);
    if (c.textWeight) r.push(`${P}*${E}:not(svg,svg *){-webkit-text-stroke:${c.textWeight > 1 ? '.6px' : '.3px'} currentColor!important}`);
    if (c.font === 'serif' || c.font === 'sans') {
      r.push(`${P}*${E}:not(${ICONISH}):not(:is(pre,code,kbd,samp,tt,pre *,code *)){font-family:${c.font === 'serif' ? SERIF : SANS}!important}`);
    }
    const mediaGray = c.grayscale && S.isTinted(c.theme) ? 'grayscale(1) ' : '';
    if (c.images === 'contrast') r.push(`${P}:is(img,picture,video,canvas,svg image)${X}{filter:${mediaGray}contrast(1.35) brightness(1.05)!important}`);
    else if (mediaGray) r.push(`${P}:is(img,picture,video,canvas,svg,iframe,embed,object)${X}{filter:grayscale(1)!important}`);
    if (c.images === 'hide') {
      r.push(`${P}:is(img,picture,video,canvas)${X}{visibility:hidden!important}`);
      r.push(`${P}*${E}{background-image:none!important}`);
    }
    if (forDocument) {
      // Book view covers the page: stop it scrolling and painting underneath.
      r.push('html[data-ink-book],html[data-ink-book] body{overflow:hidden!important}');
      // The book draws its own paper; a page-wide grayscale would drain the paper swatches too.
      r.push('html[data-inkpage][data-ink-book]{filter:none!important}');
      r.push('html[data-ink-book] body,html[data-ink-book] body *{visibility:hidden!important}');
      for (const sel of c.hidden || []) {
        if (validSelector(sel)) r.push(`${sel}{display:none!important}`);
      }
    }
    return r.join('\n');
  }

  function validSelector(sel) {
    try { DOC.createDocumentFragment().querySelector(sel); return true; } catch (_) { return false; }
  }

  /* --------------------------------------------------------- style plumbing */

  let docCss = null; // mountCss handle for the page
  let shadowCss = '';
  let shadowRoots = new Set();
  let shadowStyles = new Map(); // ShadowRoot -> mountCss handle

  function writeStyles() {
    const css = buildCss(cfg, true);
    if (!docCss) docCss = S.mountCss(DOC, css, { id: 'inkpage-style' });
    else docCss.update(css);

    shadowCss = buildCss(cfg, false);
    for (const [sr, handle] of shadowStyles) {
      if (!sr.host || !sr.host.isConnected) { shadowStyles.delete(sr); shadowRoots.delete(sr); continue; }
      handle.update(shadowCss);
    }
  }

  // Safari (iOS especially) tints its toolbars from the page. A theme-color placed first wins,
  // so the bars turn to paper with the page instead of keeping the site's dark header colour.
  let themeMeta = null;
  function writeThemeColor() {
    if (!IS_TOP || !DOC.head) return;
    if (!themeMeta) {
      themeMeta = DOC.createElement('meta');
      themeMeta.name = 'theme-color';
      themeMeta.setAttribute('data-inkpage', '');
    }
    themeMeta.content = S.themeOf(cfg.theme).bg;
    if (DOC.head.firstChild !== themeMeta) DOC.head.prepend(themeMeta);
  }

  function adoptShadow(sr) {
    if (shadowStyles.has(sr)) return;
    shadowStyles.set(sr, S.mountCss(sr, shadowCss, { 'data-inkpage': '' }));
    shadowRoots.add(sr);
    if (observer) observer.observe(sr, OBSERVE);
    queue.add(sr);
  }

  function shadowOf(el) {
    try {
      if (el.openOrClosedShadowRoot !== undefined) return el.openOrClosedShadowRoot; // Firefox
      if (api.dom && api.dom.openOrClosedShadowRoot) return api.dom.openOrClosedShadowRoot(el); // Chrome
    } catch (_) {}
    return el.shadowRoot;
  }

  function send(msg) {
    try {
      const p = api.runtime.sendMessage(msg);
      if (p && p.catch) p.catch(() => {});
    } catch (_) {}
  }

  /* ----------------------------------------------------------------- scanner */

  // Walks the DOM in small time slices. For every element it records what the site
  // intended (with our overrides lifted via the probe attribute) and tags it:
  //   data-ink-layer  — was opaque, so paint it paper instead of letting text show through
  //   data-ink-clear  — gradient / large colour slab behind text, drop it
  //   data-ink-unpin  — fixed or sticky bar that would eat screen space on every page
  const OBSERVE = { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'open'] };
  const queue = new Set();   // subtree roots
  const shallow = new Set(); // single elements whose class/style changed
  let walk = null;
  let scanTimer = 0;
  let observer = null;

  function scheduleScan(delay = 80) {
    if (!scanTimer) scanTimer = setTimeout(runScan, delay);
  }

  function runScan() {
    scanTimer = 0;
    if (!active) { queue.clear(); shallow.clear(); walk = null; return; }
    const deadline = performance.now() + 12;
    const chunk = [];
    for (const el of shallow) {
      shallow.delete(el);
      if (el.isConnected) chunk.push(el);
      if (chunk.length >= 300) break;
    }
    while (chunk.length < 400 && performance.now() < deadline) {
      if (!walk) {
        const next = queue.values().next();
        if (next.done) break;
        const root = next.value;
        queue.delete(root);
        if (root.nodeType === 1 && !root.isConnected) continue;
        const tw = DOC.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
          acceptNode: (n) => (ours(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
        });
        walk = { tw, cur: root.nodeType === 1 && !ours(root) ? root : tw.nextNode() };
      }
      while (walk.cur && chunk.length < 400) {
        chunk.push(walk.cur);
        walk.cur = walk.tw.nextNode();
      }
      if (!walk.cur) walk = null;
    }
    if (chunk.length) classify(chunk);
    if (walk || queue.size || shallow.size) scheduleScan(16);
    else stopAnimations();
  }

  // Handles rgb()/rgba() and modern "oklch(… / a)"-style computed colours.
  function alphaOf(color) {
    if (!color || color === 'transparent') return 0;
    let a = null;
    const slash = color.match(/\/\s*([\d.]+%?)\s*\)$/);
    if (slash) a = slash[1];
    else {
      const m = color.match(/^rgba\(([^)]+)\)$/);
      if (m && m[1].split(',').length === 4) a = m[1].split(',')[3].trim();
    }
    if (a == null) return 1;
    return a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
  }

  function classify(els) {
    // 1. Lift our overrides and read what the site asked for (one style recalc for the batch).
    for (const el of els) { el.setAttribute(HOLD, ''); el.setAttribute(PROBE, ''); }
    const info = els.map((el) => {
      const cs = getComputedStyle(el);
      return {
        el,
        pos: cs.position,
        z: cs.zIndex,
        bg: cs.backgroundColor,
        img: cs.backgroundImage,
        blur: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
        empty: !el.hasChildNodes(),
      };
    });
    for (const el of els) el.removeAttribute(PROBE);
    for (const el of els) void getComputedStyle(el).color; // settle back with transitions still frozen
    for (const el of els) el.removeAttribute(HOLD);

    // 2. Layout reads (only where needed), then 3. writes.
    const vw = innerWidth;
    const vh = innerHeight;
    const writes = [];
    const pops = new Set();
    for (const i of info) {
      const { el } = i;
      if (ours(el) || el.hasAttribute('data-ink-gifstill')) continue;
      const sr = shadowOf(el);
      if (sr) adoptShadow(sr);
      if (el.localName === 'img') maybeFreeze(el);
      else if (el.localName === 'video') tameVideo(el);
      else if (el.localName === 'marquee' && cfg.noMotion && el.stop) el.stop();

      let layer = null;
      let clear = null;
      let unpin = null;
      const opaque = alphaOf(i.bg) >= 0.5 || i.blur !== 'none';
      const pinned = i.pos === 'fixed' || i.pos === 'sticky';
      if (pinned) {
        const had = el.getAttribute('data-ink-unpin');
        if (i.pos === 'sticky') unpin = 'sticky';
        else if (had === 'top' || had === 'bottom') unpin = had; // already moved; its rect no longer says where it was
        else {
          const r = el.getBoundingClientRect();
          if (r.height > 0 && r.height < vh * 0.4 && r.width >= vw * 0.5) {
            if (r.top <= 8) unpin = 'top';
            else if (r.bottom >= vh - 8) unpin = 'bottom';
          }
        }
        // Fixed and not a bar: a modal / drawer / lightbox layer (or not shown yet).
        if (i.pos === 'fixed') setAttr(el, 'data-ink-overlay', unpin ? null : '');
      }
      if (!i.empty) {
        if (opaque) {
          const floating = i.pos === 'fixed' || (i.pos === 'absolute' && i.z !== 'auto') || inOverlay(el);
          layer = floating && !unpin && !insidePop(el, pops) ? 'pop' : '1';
          if (layer === 'pop') pops.add(el);
        }
        if (i.img.includes('gradient')) clear = '';
      } else if ((pinned || i.pos === 'absolute') && (opaque || i.img.includes('gradient'))) {
        const r = el.getBoundingClientRect();
        if (r.width >= 200 && r.height >= 40) clear = ''; // colour slab / backdrop behind text, not an icon or rule
      }
      writes.push([el, layer, clear, unpin]);
    }
    for (const [el, layer, clear, unpin] of writes) {
      setAttr(el, 'data-ink-layer', layer);
      setAttr(el, 'data-ink-clear', clear);
      setAttr(el, 'data-ink-unpin', unpin);
    }
  }

  const inOverlay = (el) => !!(el.parentElement && el.parentElement.closest('[data-ink-overlay]'));

  // Only the outermost card of a floating layer gets an outline.
  function insidePop(el, pops) {
    for (let n = el.parentElement; n && n !== DOC.body; n = n.parentElement) {
      if (pops.has(n) || n.getAttribute('data-ink-layer') === 'pop') return true;
      if (n.hasAttribute('data-ink-overlay')) return false;
    }
    return false;
  }

  function setAttr(el, name, value) {
    if (value == null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
    else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((records) => {
      for (const rec of records) {
        if (rec.type === 'childList') {
          for (const n of rec.addedNodes) if (n.nodeType === 1 && !ours(n)) queue.add(n);
        } else if (rec.target.nodeType === 1 && !ours(rec.target)) {
          // A class flip often reveals a whole widget (menu, modal); re-check small subtrees fully.
          if (rec.target.getElementsByTagName('*').length < 300) queue.add(rec.target);
          else shallow.add(rec.target);
        }
      }
      if (queue.size || shallow.size) scheduleScan();
    });
    observer.observe(DOC, OBSERVE);
    for (const sr of shadowRoots) observer.observe(sr, OBSERVE);
  }

  /* ----------------------------------------------------------------- motion */

  let lastGesture = 0;
  const userActive = () => (navigator.userActivation ? navigator.userActivation.isActive : performance.now() - lastGesture < 1000);

  function stopAnimations() {
    if (!active || !cfg.noMotion || !DOC.getAnimations) return;
    let list;
    try { list = DOC.getAnimations(); } catch (_) { return; }
    for (const a of list) {
      try {
        if (a.playState !== 'running') continue;
        const name = a.constructor && a.constructor.name;
        if (name === 'CSSAnimation' || name === 'CSSTransition') continue; // handled by CSS
        const end = a.effect && a.effect.getComputedTiming().endTime;
        if (Number.isFinite(end)) a.finish();
        else a.pause();
      } catch (_) {}
    }
  }

  function tameVideo(v) {
    if (!cfg.noMotion) return;
    if ((v.autoplay || v.loop || v.muted) && !userActive()) {
      v.autoplay = false;
      if (!v.paused) v.pause();
    }
  }

  const stills = new Map(); // img -> canvas

  function maybeFreeze(img) {
    if (!cfg.freezeGif || img.hasAttribute('data-ink-gif')) return;
    const src = img.currentSrc || img.src || '';
    if (!/\.gif($|[?#])/i.test(src) && !src.startsWith('data:image/gif')) return;
    if (!img.complete || !img.naturalWidth) {
      img.addEventListener('load', () => active && maybeFreeze(img), { once: true });
      return;
    }
    const r = img.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const cv = DOC.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    try { cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); } catch (_) { return; }
    cv.className = img.className;
    cv.style.cssText = img.style.cssText;
    cv.style.width = `${r.width}px`;
    cv.style.height = `${r.height}px`;
    cv.style.cursor = 'pointer';
    cv.setAttribute('data-ink-gifstill', '');
    cv.title = t('gifPaused', 'GIF paused — click to play');
    cv.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      unfreeze(img);
      img.setAttribute('data-ink-gif', 'playing');
    }, true);
    img.after(cv);
    img.setAttribute('data-ink-gif', 'frozen');
    stills.set(img, cv);
  }

  function unfreeze(img) {
    const cv = stills.get(img);
    if (cv) cv.remove();
    stills.delete(img);
    img.removeAttribute('data-ink-gif');
  }

  DOC.addEventListener('load', (e) => {
    if (active && e.target && e.target.localName === 'img') maybeFreeze(e.target);
  }, true);

  DOC.addEventListener('play', (e) => {
    const v = e.target;
    if (!active || !cfg.noMotion || !v || v.localName !== 'video') return;
    if ((v.muted || v.loop) && !userActive()) v.pause();
  }, true);

  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, () => { lastGesture = performance.now(); }, true);
  }

  /* --------------------------------------------------------------- overlay UI */

  let ui = null;

  function getUi() {
    if (ui && ui.host.isConnected) return ui;
    const host = DOC.createElement(UI_TAG);
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;display:block;contain:strict;';
    const sr = host.attachShadow({ mode: 'closed' });
    const uiCss = `
      :host{all:initial}
      .w{--bg:#fff;--fg:#000}
      .w,.w *{-webkit-text-fill-color:currentColor;-webkit-text-stroke:0;text-shadow:none}
      [hidden]{display:none!important}
      .mask{position:fixed;background:var(--bg);border-top:1px dashed var(--fg)}
      .badge{position:fixed;right:10px;bottom:10px;padding:5px 9px;border-radius:3px;background:var(--fg);color:var(--bg);
        font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;opacity:.85}
      .flash{position:fixed;inset:0}
      .toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:calc(100% - 32px);padding:9px 14px;
        background:var(--fg);color:var(--bg);font:500 13px/1.4 system-ui,-apple-system,"PingFang SC",sans-serif;text-align:center}
      .pick{position:fixed;outline:2px solid var(--fg);background:repeating-linear-gradient(45deg,rgba(0,0,0,.18) 0 6px,transparent 6px 12px)}
      .tip{position:fixed;left:50%;top:12px;transform:translateX(-50%);padding:8px 14px;border:2px solid var(--fg);background:var(--bg);color:var(--fg);
        font:500 13px/1.3 system-ui,-apple-system,"PingFang SC",sans-serif;white-space:nowrap}`;
    const wrap = DOC.createElement('div');
    wrap.className = 'w';
    const make = (cls) => { const d = DOC.createElement('div'); d.className = cls; d.hidden = true; wrap.appendChild(d); return d; };
    const u = { host, wrap, mask: make('mask'), badge: make('badge'), pick: make('pick'), tip: make('tip'), toast: make('toast'), flash: make('flash') };
    sr.append(wrap);
    ROOT.appendChild(host);
    S.mountCss(sr, uiCss);
    ui = u;
    return u;
  }

  function syncUiTheme() {
    if (!ui) return;
    const th = S.themeOf(cfg && cfg.enabled ? cfg.theme : 'paper');
    ui.wrap.style.setProperty('--bg', th.bg); // the bottom-edge mask must match the paper exactly
    ui.wrap.style.setProperty('--fg', th.fg);
  }

  function removeUi() {
    if (ui) ui.host.remove();
    ui = null;
  }

  let toastTimer = 0;
  function toast(text, ms = 3200) {
    const u = getUi();
    syncUiTheme();
    u.toast.textContent = text;
    u.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { u.toast.hidden = true; }, ms);
  }

  function flash() {
    const u = getUi();
    syncUiTheme();
    const name = cfg && cfg.enabled ? cfg.theme : 'paper';
    const th = S.themeOf(name);
    const night = S.isDark(name);
    u.flash.style.background = night ? '#fff' : '#000';
    u.flash.hidden = false;
    setTimeout(() => {
      u.flash.style.background = th.bg;
      setTimeout(() => { u.flash.hidden = true; }, 110);
    }, 110);
  }

  /* ------------------------------------------------------------------ paging */

  let lastPointer = null;
  let turns = 0;
  let maskState = null; // { sc, top } while a mask hides a half-cut line

  window.addEventListener('pointermove', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; }, { passive: true, capture: true });

  const docScroller = () => DOC.scrollingElement || ROOT;

  function canScroll(el) {
    if (el.scrollHeight - el.clientHeight <= 8) return false;
    if (el === docScroller()) {
      // overflow:hidden on <html>, or on <body> when it propagates to the viewport (scroll lock).
      const h = getComputedStyle(ROOT).overflowY;
      if (h === 'hidden' || h === 'clip') return false;
      if (h === 'visible' && DOC.body) {
        const b = getComputedStyle(DOC.body).overflowY;
        if (b === 'hidden' || b === 'clip') return false;
      }
      return true;
    }
    const oy = getComputedStyle(el).overflowY;
    return (oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.clientHeight > innerHeight * 0.35;
  }

  function parentOf(el) {
    return el.parentElement || (el.getRootNode && el.getRootNode().host) || null;
  }

  function scrollableAt(x, y) {
    let el = DOC.elementFromPoint(x, y);
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    for (; el && el !== ROOT; el = parentOf(el)) {
      if (canScroll(el)) return el;
    }
    return null;
  }

  function getScroller() {
    const se = docScroller();
    const docOk = canScroll(se);
    if (lastPointer) {
      const inner = scrollableAt(lastPointer.x, lastPointer.y);
      if (inner && (!docOk || inner.clientHeight > innerHeight * 0.6)) return inner;
    }
    if (docOk) return se;
    return scrollableAt(innerWidth / 2, innerHeight / 2);
  }

  function viewRect(sc) {
    if (sc === docScroller()) {
      return { top: 0, left: 0, right: ROOT.clientWidth || innerWidth, bottom: Math.min(innerHeight, ROOT.clientHeight || innerHeight) };
    }
    const r = sc.getBoundingClientRect();
    return {
      top: Math.max(0, r.top + sc.clientTop),
      left: Math.max(0, r.left + sc.clientLeft),
      right: Math.min(innerWidth, r.left + sc.clientLeft + sc.clientWidth),
      bottom: Math.min(innerHeight, r.top + sc.clientTop + sc.clientHeight),
    };
  }

  function sampleXs(vp, n = 9) {
    const xs = [];
    for (let i = 0; i < n; i++) xs.push(vp.left + ((vp.right - vp.left) * (i + 0.5)) / n);
    return xs;
  }

  function pinnedAncestor(el, limit) {
    for (let n = 0; el && el !== ROOT && n < 30; el = parentOf(el), n++) {
      if (el.localName === UI_TAG) return null;
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') return el;
      if (el === limit) return null;
    }
    return null;
  }

  // Bars pinned over the top/bottom edge shrink the usable page. With "unpin" on we
  // release them on the spot (catches headers that only become fixed after scrolling).
  function coverage(sc, vp) {
    let top = vp.top;
    let bottom = vp.bottom;
    const H = vp.bottom - vp.top;
    const seen = new Set();
    for (const [y, edge] of [[vp.top + 2, 'top'], [vp.bottom - 2, 'bottom']]) {
      for (const x of sampleXs(vp, 5)) {
        for (const hit of DOC.elementsFromPoint(x, y).slice(0, 6)) {
          const pin = pinnedAncestor(hit, sc);
          if (!pin || seen.has(pin)) continue;
          seen.add(pin);
          const r = pin.getBoundingClientRect();
          if (r.height > H * 0.45) continue; // a modal or side panel, not a bar
          if (cfg.unpin && r.width >= (vp.right - vp.left) * 0.5) {
            pin.setAttribute('data-ink-unpin', getComputedStyle(pin).position === 'sticky' ? 'sticky' : edge);
            continue;
          }
          if (edge === 'top' && r.top <= vp.top + 4) top = Math.max(top, r.bottom);
          if (edge === 'bottom' && r.bottom >= vp.bottom - 4) bottom = Math.min(bottom, r.top);
        }
      }
    }
    return { top, bottom, left: vp.left, right: vp.right };
  }

  function caretAt(x, y) {
    try {
      if (DOC.caretPositionFromPoint) {
        const p = DOC.caretPositionFromPoint(x, y);
        return p && { node: p.offsetNode, offset: p.offset };
      }
      if (DOC.caretRangeFromPoint) {
        const r = DOC.caretRangeFromPoint(x, y);
        return r && { node: r.startContainer, offset: r.startOffset };
      }
    } catch (_) {}
    return null;
  }

  // Text line boxes really cut by an edge (a line ending exactly on the edge is whole).
  // Probe a quarter pixel inside the edge: a line can overhang an edge by less than a pixel.
  const cutByBottom = (view) => linesAcross(view, view.bottom - 0.25).filter((r) => r.bottom > view.bottom + 0.5);
  const cutByTop = (view) => linesAcross(view, view.top + 0.25).filter((r) => r.top < view.top - 0.5);

  // Text line boxes that cross the horizontal line y.
  function linesAcross(view, y) {
    const out = [];
    const range = DOC.createRange();
    for (const x of sampleXs(view)) {
      const c = caretAt(x, y);
      if (!c || !c.node || c.node.nodeType !== 3 || !c.node.length) continue;
      for (const off of [c.offset, c.offset - 1]) {
        if (off < 0 || off >= c.node.length) continue;
        range.setStart(c.node, off);
        range.setEnd(c.node, off + 1);
        const hit = Array.from(range.getClientRects()).find(
          (r) => r.height > 0 && r.top < y && r.bottom > y && x >= r.left - 40 && x <= r.right + 40,
        );
        if (hit) { out.push(hit); break; }
      }
    }
    return out;
  }

  const scrollTopOf = (sc) => sc.scrollTop;
  function scrollToY(sc, y) {
    const max = sc.scrollHeight - sc.clientHeight;
    y = Math.max(0, Math.min(max, Math.round(y)));
    try { sc.scrollTo({ top: y, behavior: 'instant' }); } catch (_) { sc.scrollTop = y; }
    if (Math.abs(sc.scrollTop - y) > 1) sc.scrollTop = y;
  }

  const bookOpen = () => !!(globalThis.InkBook && globalThis.InkBook.isOpen());

  function turn(dir) {
    if (!IS_TOP || !active || !cfg.paging || bookOpen()) return false;
    const sc = getScroller();
    if (!sc) return false;
    hideMask();
    const vp = viewRect(sc);
    const cov = coverage(sc, vp);
    const H = cov.bottom - cov.top;
    if (H < 80) return false;
    const before = scrollTopOf(sc);

    if (dir > 0) {
      let step = H;
      if (cfg.cleanEdges) {
        // The first line cut by the bottom edge becomes the first line of the next page.
        const cut = cutByBottom(cov);
        if (cut.length) {
          const top = Math.min(...cut.map((r) => r.top));
          if (top > cov.top + H * 0.5) step = Math.floor(top - cov.top);
        }
      }
      scrollToY(sc, before + step);
      if (cfg.cleanEdges) {
        // Second net: a line that began within the last pixel or two of the old page slips
        // past the bottom probe and shows up cut by the new top edge. Back up to its top.
        const cut = cutByTop(cov);
        if (cut.length) {
          const d = Math.ceil(cov.top - Math.min(...cut.map((r) => r.top)));
          if (d > 0 && d < H * 0.3) scrollToY(sc, scrollTopOf(sc) - d);
        }
      }
    } else {
      let target = before - H;
      if (cfg.cleanEdges) {
        // A line cut by the current top edge (the last page can't scroll far enough to
        // start cleanly) has never been shown whole: end the previous page just after it.
        const cutNow = cutByTop(cov);
        if (cutNow.length) {
          const b = Math.ceil(Math.max(...cutNow.map((r) => r.bottom)) - cov.top);
          if (b > 0 && b < H * 0.4) target += b;
        }
      }
      scrollToY(sc, target);
      if (cfg.cleanEdges && scrollTopOf(sc) > 0) {
        // A line cut by the top edge belongs to the page before this one; hide it completely.
        const cut = cutByTop(cov);
        if (cut.length) {
          const d = Math.ceil(Math.max(...cut.map((r) => r.bottom)) - cov.top);
          if (d > 0 && d < H * 0.4) scrollToY(sc, scrollTopOf(sc) + d);
        }
      }
    }

    const moved = Math.abs(scrollTopOf(sc) - before) >= 1;
    if (moved) {
      turns++;
      if (cfg.cleanEdges) showMask(sc);
      if (cfg.autoRefresh && turns % cfg.autoRefresh === 0) flash();
      stopAnimations();
    }
    updateBadge(sc, H, !moved);
    return true;
  }

  function showMask(sc) {
    const max = sc.scrollHeight - sc.clientHeight;
    if (scrollTopOf(sc) >= max - 1) return; // last page: nothing left to push to the next one
    const cov = coverage(sc, viewRect(sc));
    const H = cov.bottom - cov.top;
    const cut = cutByBottom(cov);
    if (!cut.length) return;
    const top = Math.min(...cut.map((r) => r.top));
    if (top <= cov.top + H * 0.5) return;
    const u = getUi();
    syncUiTheme();
    Object.assign(u.mask.style, {
      top: `${top}px`, left: `${cov.left}px`, width: `${cov.right - cov.left}px`, height: `${cov.bottom - top}px`,
    });
    u.mask.hidden = false;
    maskState = { sc, at: scrollTopOf(sc) };
  }

  function hideMask() {
    if (ui) ui.mask.hidden = true;
    maskState = null;
  }

  let badgeTimer = 0;
  function updateBadge(sc, H, bump) {
    if (!IS_TOP || !active || !cfg.paging || !cfg.pageIndicator || bookOpen()) { if (ui) ui.badge.hidden = true; return; }
    sc = sc || getScroller();
    if (!sc) { if (ui) ui.badge.hidden = true; return; }
    if (!H) { const c = coverage(sc, viewRect(sc)); H = c.bottom - c.top; }
    const max = sc.scrollHeight - sc.clientHeight;
    const total = Math.max(1, Math.ceil(max / H) + 1);
    const cur = sc.scrollTop >= max - 1 ? total : Math.min(total, Math.floor(sc.scrollTop / H + 0.25) + 1);
    const u = getUi();
    syncUiTheme();
    u.badge.textContent = `${cur} / ${total}`;
    u.badge.hidden = false;
    if (bump) { // pressed past the first / last page
      u.badge.style.outline = '3px solid currentColor';
      clearTimeout(badgeTimer);
      badgeTimer = setTimeout(() => { u.badge.style.outline = ''; }, 400);
    }
  }

  let scrollIdle = 0;
  DOC.addEventListener('scroll', () => {
    if (!active) return;
    if (maskState && Math.abs(scrollTopOf(maskState.sc) - maskState.at) > 2) hideMask();
    clearTimeout(scrollIdle);
    scrollIdle = setTimeout(() => updateBadge(), 150);
  }, { capture: true, passive: true });
  window.addEventListener('resize', () => { if (active) { hideMask(); updateBadge(); } }, { passive: true });

  /* ------------------------------------------------------------------- input */

  const EDITABLE = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],[role="textbox"],[role="combobox"],[role="searchbox"]';
  const WIDGET = '[role="listbox"],[role="menu"],[role="menubar"],[role="slider"],[role="tablist"],[role="grid"],[role="tree"],[role="radiogroup"],[role="spinbutton"],video,audio';
  const INTERACTIVE = `a[href],button,label,summary,details,select,input,textarea,video,audio,iframe,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"],[role="option"],[contenteditable=""],[contenteditable="true"],[onclick],[data-ink-gifstill],${WIDGET}`;

  function pathMatches(e, selector) {
    for (const n of e.composedPath()) {
      if (n === DOC || n === window) break;
      if (n.nodeType === 1 && n.matches(selector)) return true;
    }
    return false;
  }

  // Bubble phase on window: sites that handle a key themselves (players, slide decks,
  // editors) call preventDefault first and keep their behaviour.
  window.addEventListener('keydown', (e) => {
    if (!active || !cfg.paging || bookOpen() || e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (picking) return;
    if (pathMatches(e, EDITABLE)) return;
    let dir = 0;
    switch (e.key) {
      case 'PageDown': dir = 1; break;
      case 'PageUp': dir = -1; break;
      case ' ':
      case 'Spacebar':
        if (pathMatches(e, 'button,a[href],summary,[role="button"],[role="checkbox"],[role="switch"]')) return;
        dir = e.shiftKey ? -1 : 1;
        break;
      case 'ArrowDown':
      case 'ArrowRight':
        if (cfg.arrowKeys && !e.shiftKey && !pathMatches(e, WIDGET)) dir = 1;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        if (cfg.arrowKeys && !e.shiftKey && !pathMatches(e, WIDGET)) dir = -1;
        break;
      default:
    }
    if (dir && turn(dir)) e.preventDefault();
  });

  function tapEnabled() {
    if (cfg.tapZones === 'on') return true;
    if (cfg.tapZones === 'off') return false;
    return window.matchMedia && matchMedia('(pointer: coarse)').matches;
  }

  // A click or tap on the left or right 30% turns the page. Returns whether it did.
  function edgeTap(e) {
    if (!active || !cfg.paging || bookOpen() || picking || e.button !== 0 || e.defaultPrevented || !tapEnabled()) return false;
    if (pathMatches(e, INTERACTIVE)) return false;
    const target = e.composedPath()[0];
    if (target && target.nodeType === 1 && getComputedStyle(target).cursor === 'pointer') return false;
    const sel = window.getSelection && getSelection();
    if (sel && !sel.isCollapsed) return false;
    const w = innerWidth;
    if (e.clientX < w * 0.3) return turn(-1);
    if (e.clientX > w * 0.7) return turn(1);
    return false;
  }

  // iOS Safari sends no click for a tap on plain text when the only listener is on window,
  // so touch and pen taps are read from pointer events; the mouse keeps using click.
  let tapStart = null;
  let tapTurned = -Infinity;
  window.addEventListener('pointerdown', (e) => {
    tapStart = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY, t: e.timeStamp };
  });
  window.addEventListener('pointercancel', () => { tapStart = null; });
  window.addEventListener('pointerup', (e) => {
    const s = tapStart;
    tapStart = null;
    if (!s || e.timeStamp - s.t > 500 || Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) return;
    if (edgeTap(e)) tapTurned = e.timeStamp;
  });
  window.addEventListener('click', (e) => {
    if (e.timeStamp - tapTurned < 800) return; // the tap already turned the page
    edgeTap(e);
  });

  let wheelLast = 0;
  let wheelAcc = 0;
  let wheelDone = false;
  window.addEventListener('wheel', (e) => {
    if (!active || !cfg.paging || !cfg.wheelPaging || bookOpen() || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const sc = getScroller();
    if (!sc) return;
    // Let nested scroll areas (code blocks, chat panes) keep normal scrolling.
    for (const n of e.composedPath()) {
      if (n === sc || n === DOC || n === window) break;
      if (n.nodeType === 1 && n !== DOC.body && canScroll(n)) return;
    }
    e.preventDefault();
    const now = performance.now();
    if (now - wheelLast > 250) { wheelAcc = 0; wheelDone = false; } // a new gesture
    wheelLast = now;
    if (wheelDone) return; // one page per flick, however long the inertia tail
    wheelAcc += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (Math.abs(wheelAcc) >= 30) { turn(Math.sign(wheelAcc)); wheelDone = true; }
  }, { passive: false });

  /* -------------------------------------------------------------- hide picker */

  let picking = false;
  let pickTarget = null;

  function selectorFor(el) {
    const parts = [];
    for (let n = el, depth = 0; n && n.nodeType === 1 && n !== ROOT && depth < 6; n = n.parentElement, depth++) {
      if (n.id && /^[a-z][\w-]*$/i.test(n.id) && !/\d{3,}/.test(n.id)) {
        parts.unshift(`#${CSS.escape(n.id)}`);
        break;
      }
      let part = n.localName;
      const classes = Array.from(n.classList).filter((c) => /^[a-z][\w-]*$/i.test(c) && !/\d{3,}|__[a-z0-9]{5,}$|^css-|^sc-/i.test(c)).slice(0, 2);
      if (classes.length) part += classes.map((c) => `.${CSS.escape(c)}`).join('');
      const parent = n.parentElement;
      if (parent && parent !== ROOT) {
        const same = Array.from(parent.children).filter((c) => c.matches(part));
        if (same.length > 1) part += `:nth-of-type(${Array.from(parent.children).filter((c) => c.localName === n.localName).indexOf(n) + 1})`;
      }
      parts.unshift(part);
      const sel = parts.join(' > ');
      try { if (DOC.querySelectorAll(sel).length === 1) return sel; } catch (_) {}
      if (n === DOC.body) break;
    }
    return parts.join(' > ');
  }

  function startPicker() {
    if (picking) return;
    picking = true;
    const u = getUi();
    syncUiTheme();
    u.tip.textContent = t('pickTip', 'Click anything to hide it on this site · Esc to finish');
    u.tip.hidden = false;
    window.addEventListener('mousemove', pickMove, true);
    window.addEventListener('click', pickClick, true);
    window.addEventListener('keydown', pickKey, true);
  }

  function stopPicker() {
    picking = false;
    pickTarget = null;
    if (ui) { ui.tip.hidden = true; ui.pick.hidden = true; }
    window.removeEventListener('mousemove', pickMove, true);
    window.removeEventListener('click', pickClick, true);
    window.removeEventListener('keydown', pickKey, true);
  }

  function pickMove(e) {
    const el = DOC.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === ROOT || el === DOC.body || el.localName === UI_TAG) return;
    pickTarget = el;
    const r = el.getBoundingClientRect();
    Object.assign(ui.pick.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
    ui.pick.hidden = false;
  }

  async function pickClick(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    pickMove(e);
    if (!pickTarget) return;
    const sel = selectorFor(pickTarget);
    ui.pick.hidden = true; // the saved selector reaches our stylesheet through storage.onChanged
    const store = await api.storage.local.get(S.KEYS);
    const sites = store.sites || {};
    const entry = Object.assign({}, sites[site]);
    entry.hidden = Array.from(new Set([...(entry.hidden || []), sel]));
    sites[site] = entry;
    await save({ sites });
  }

  function pickKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      stopPicker();
    }
  }

  /* --------------------------------------------------------------- lifecycle */

  let rootObserver = null;

  function enable(prev) {
    const first = !active;
    active = true;
    ROOT.setAttribute('data-inkpage', '');
    ROOT.setAttribute('data-ink-theme', cfg.theme);
    writeStyles();
    syncUiTheme();
    if (!rootObserver) {
      // Frameworks that own <html> may strip our attribute or style node; put them back.
      rootObserver = new MutationObserver(() => {
        if (!active) return;
        if (!ROOT.hasAttribute('data-inkpage')) ROOT.setAttribute('data-inkpage', '');
        if (ROOT.getAttribute('data-ink-theme') !== cfg.theme) ROOT.setAttribute('data-ink-theme', cfg.theme);
        if (docCss && docCss.el.parentNode !== ROOT) docCss.update(buildCss(cfg, true));
      });
      rootObserver.observe(ROOT, { attributes: true, attributeFilter: ['data-inkpage', 'data-ink-theme'], childList: true });
    }
    const rescan = first || (prev && ((!prev.unpin && cfg.unpin) || (!prev.freezeGif && cfg.freezeGif) || (!prev.noMotion && cfg.noMotion)));
    if (prev && prev.freezeGif && !cfg.freezeGif) for (const img of Array.from(stills.keys())) unfreeze(img);
    whenReady(() => {
      if (!active) return;
      writeThemeColor();
      startObserver();
      if (rescan) { queue.add(DOC.body || ROOT); scheduleScan(0); }
      if (IS_TOP) {
        updateBadge();
        const sc = cfg.paging && cfg.cleanEdges && getScroller();
        if (sc) setTimeout(() => active && !maskState && showMask(sc), 300); // page 1 gets a clean edge too
      }
    });
  }

  function disable() {
    active = false;
    stopPicker();
    if (globalThis.InkBook) globalThis.InkBook.close();
    if (observer) { observer.disconnect(); observer = null; }
    clearTimeout(scanTimer);
    scanTimer = 0;
    queue.clear();
    shallow.clear();
    walk = null;
    ROOT.removeAttribute('data-inkpage');
    ROOT.removeAttribute('data-ink-theme');
    if (docCss) { docCss.remove(); docCss = null; }
    if (themeMeta) { themeMeta.remove(); themeMeta = null; }
    for (const handle of shadowStyles.values()) handle.remove();
    const scopes = [DOC, ...shadowRoots];
    for (const scope of scopes) {
      for (const el of scope.querySelectorAll('[data-ink-layer],[data-ink-clear],[data-ink-unpin],[data-ink-overlay]')) {
        for (const a of ATTRS) el.removeAttribute(a);
      }
    }
    shadowStyles = new Map();
    shadowRoots = new Set();
    for (const img of Array.from(stills.keys())) unfreeze(img);
    for (const img of DOC.querySelectorAll('img[data-ink-gif]')) img.removeAttribute('data-ink-gif');
    removeUi();
  }

  function whenReady(fn) {
    if (DOC.readyState === 'loading') DOC.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function apply(next) {
    const prev = cfg;
    cfg = next;
    if (IS_TOP) send({ type: 'badge', enabled: cfg.enabled });
    if (cfg.enabled) enable(prev && prev.enabled ? prev : null);
    else if (active) disable();
    syncBook();
  }

  async function setSite(patch) {
    const store = await api.storage.local.get(S.KEYS);
    const sites = store.sites || {};
    sites[site] = Object.assign({}, sites[site], typeof patch === 'function' ? patch(S.resolve(store, site)) : patch);
    await save({ sites });
  }

  const toggleSite = () => setSite((now) => ({ enabled: !now.enabled }));

  /* ------------------------------------------------------------- book view */

  // book.js and Readability are only loaded into pages that ask for book view.
  let bookDismissed = false; // Esc: show the original page until the next visit
  let bookFailed = '';       // URL where Readability found no article
  let bookBusy = false;
  let bookHref = location.href;
  let bookWatch = 0;

  const bookHooks = {
    flash,
    save: (patch) => setSite(patch),
    exit() {
      bookDismissed = true;
      syncBook();
      toast(t('bookExitHint', 'Showing the original page. Alt+Shift+B goes back to book view.'));
    },
  };

  function pageLoaded() {
    if (DOC.readyState === 'complete') return Promise.resolve();
    return new Promise((res) => {
      window.addEventListener('load', res, { once: true });
      setTimeout(res, 3000); // don't wait forever on pages with endless requests
    });
  }

  async function syncBook() {
    if (!IS_TOP || !cfg) return;
    const want = () => active && cfg.mode === 'book' && !bookDismissed && bookFailed !== location.href;
    const book = globalThis.InkBook;
    if (!want()) { if (book) book.close(); return; }
    if (book && book.isOpen()) { book.update(cfg); return; }
    if (bookBusy) return;
    bookBusy = true;
    try {
      await pageLoaded();
      if (!globalThis.InkBook) {
        try { await api.runtime.sendMessage({ type: 'loadBook' }); } catch (_) {}
      }
      const Book = globalThis.InkBook;
      if (!Book || !want()) return;
      hideMask();
      if (Book.open(cfg, bookHooks)) {
        updateBadge();
        watchUrl();
      } else {
        bookFailed = location.href;
        toast(t('bookNoArticle', 'No article found here — showing the web page instead.'));
      }
    } finally {
      bookBusy = false;
    }
  }

  // Single-page apps change articles without reloading.
  function watchUrl() {
    if (bookWatch) return;
    bookWatch = setInterval(() => {
      if (location.href === bookHref) return;
      bookHref = location.href;
      if (globalThis.InkBook && globalThis.InkBook.isOpen()) {
        globalThis.InkBook.close();
        setTimeout(syncBook, 1000);
      }
    }, 1000);
  }

  async function toggleBook() {
    if (active && cfg.mode === 'book') {
      bookDismissed = bookOpen();
      bookFailed = '';
      syncBook();
      return;
    }
    bookDismissed = false;
    bookFailed = '';
    await setSite({ enabled: true, mode: 'book' });
  }

  async function topSite() {
    if (IS_TOP) return location.hostname;
    try {
      const ao = location.ancestorOrigins;
      if (ao && ao.length) return new URL(ao[ao.length - 1]).hostname;
    } catch (_) {}
    try {
      const res = await api.runtime.sendMessage({ type: 'topHost' });
      return (res && res.host) || '';
    } catch (_) {
      return '';
    }
  }

  let applied = '';
  async function reload() {
    const store = await api.storage.local.get(S.KEYS);
    const next = S.resolve(store, site);
    const key = JSON.stringify(next);
    if (key === applied) return; // the same change can arrive by storage event and by message
    applied = key;
    apply(next);
  }

  // Write settings and apply them here at once (Safari doesn't always tell content
  // scripts about storage changes; other tabs hear about it from the background).
  async function save(data) {
    await api.storage.local.set(data);
    reload();
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'settingsChanged') { reload(); return; } // every frame
    if (!IS_TOP || !msg) return;
    switch (msg.type) {
      case 'hello': {
        // Chrome reads sendResponse; Safari and Firefox reliably deliver a returned Promise.
        const reply = { site, enabled: !!(cfg && cfg.enabled) };
        sendResponse(reply);
        return Promise.resolve(reply);
      }
      case 'toggle': toggleSite(); break;
      case 'toggleBook': toggleBook(); break;
      case 'flash': flash(); break;
      case 'pick': if (active) startPicker(); break;
      default:
    }
  });

  (async () => {
    site = S.siteKey(await topSite());
    await reload();
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && S.KEYS.some((k) => k in changes)) reload();
    });
  })();
})();
