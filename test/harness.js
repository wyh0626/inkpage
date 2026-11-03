// Stand-in for the extension APIs so content.js can run on a plain page for testing.
(() => {
  // Tests need to look inside the book view, which uses a closed shadow root.
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    const root = attach.call(this, Object.assign({}, init, { mode: 'open' }));
    if (this.localName === 'inkpage-book') window.__bookRoot = root;
    return root;
  };
  const listeners = [];
  const data = { defaults: {}, sites: { localhost: { enabled: false } }, everywhere: false };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let onMessage = null;
  window.chrome = {
    storage: {
      local: {
        async get(keys) { const out = {}; for (const k of [].concat(keys)) if (k in data) out[k] = clone(data[k]); return out; },
        async set(obj) {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: data[k], newValue: v }; data[k] = clone(v); }
          listeners.forEach((fn) => fn(changes, 'local'));
        },
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
    runtime: { getURL: (path) => new URL(`../src/${path}`, location.href).href, sendMessage: async (m) => { (window.__sent ||= []).push(m); return {}; }, onMessage: { addListener: (fn) => { onMessage = fn; } } },
    // ?lang=zh loads the real Chinese messages (used to capture screens for the demo film).
    i18n: (() => {
      let msgs = null;
      const m = location.search.match(/lang=(\w+)/);
      if (m) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', `../src/_locales/${m[1] === 'zh' ? 'zh_CN' : 'en'}/messages.json`, false);
        xhr.send();
        msgs = JSON.parse(xhr.responseText);
      }
      return {
        getUILanguage: () => (m && m[1] === 'zh' ? 'zh-CN' : 'en'),
        getMessage(key, subs) {
          const e = msgs && msgs[key];
          if (!e) return '';
          let text = e.message;
          for (const [name, p] of Object.entries(e.placeholders || {})) {
            const i = Number(p.content.slice(1)) - 1;
            text = text.split(`$${name.toUpperCase()}$`).join((subs || [])[i] ?? '');
          }
          return text;
        },
      };
    })(),
  };
  window.inkTest = {
    data,
    async site(patch) { await chrome.storage.local.set({ sites: { localhost: Object.assign({}, data.sites.localhost, patch) } }); },
    msg(m) { return new Promise((res) => onMessage(m, {}, res) || res()); },
    // Page through the whole document with PageDown (dir 1) or PageUp (dir -1) and report any
    // text line inside `rootSel` that was never shown whole and unmasked on some page.
    audit(dir = 1, rootSel = 'body') {
      const rg = document.createRange();
      const tw = document.createTreeWalker(document.querySelector(rootSel), NodeFilter.SHOW_TEXT);
      const all = [];
      for (let n; (n = tw.nextNode());) { rg.selectNodeContents(n); for (const r of rg.getClientRects()) if (r.height) all.push({ top: r.top + scrollY, bottom: r.bottom + scrollY }); }
      const lines = [];
      for (const l of all.sort((a, b) => a.top - b.top)) if (!lines.length || Math.abs(lines[lines.length - 1].top - l.top) > 3) lines.push(l);
      const seen = new Set(); const pages = [];
      const max = document.documentElement.scrollHeight - innerHeight;
      for (let i = 0; i < 200; i++) {
        const y0 = scrollY; const y1 = y0 + innerHeight;
        const cut = lines.filter((l) => l.top < y1 - 1 && l.bottom > y1 + 0.5).map((l) => l.top);
        const maskFrom = cut.length && y0 < max - 1 ? Math.min(...cut) : y1;
        lines.forEach((l, k) => { if (l.top >= y0 - 0.5 && l.bottom <= maskFrom + 0.5) seen.add(k); });
        pages.push(Math.round(y0));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: dir > 0 ? 'PageDown' : 'PageUp', bubbles: true, cancelable: true }));
        if (Math.abs(scrollY - y0) < 1) break;
      }
      const missed = lines.map((l, k) => k).filter((k) => !seen.has(k)).map((k) => Math.round(lines[k].top));
      return { lines: lines.length, pages: pages.length, missed };
    },
    // Book view: walk every page; each text line must be whole inside the viewport on exactly
    // the pages where it shows, and every line must show on some page.
    bookAudit() {
      const root = window.__bookRoot;
      const vp = root.querySelector('.viewport').getBoundingClientRect();
      const texts = [];
      const tw = document.createTreeWalker(root.querySelector('.flow'), NodeFilter.SHOW_TEXT);
      for (let n; (n = tw.nextNode());) if (n.data.trim()) texts.push(n);
      const rg = document.createRange();
      const lineRects = () => texts.flatMap((n) => { rg.selectNodeContents(n); return Array.from(rg.getClientRects()).filter((r) => r.width && r.height); });
      const total = lineRects().length;
      let shown = 0; let clipped = 0; const { pages } = InkBook.state();
      InkBook.turn(-9999);
      while (InkBook.state().page > 0) InkBook.turn(-1);
      for (let p = 0; p < pages; p++) {
        for (const r of lineRects()) {
          const inX = r.right > vp.left + 1 && r.left < vp.right - 1;
          if (!inX) continue;
          if (r.top >= vp.top - 0.5 && r.bottom <= vp.bottom + 0.5 && r.left >= vp.left - 0.5 && r.right <= vp.right + 0.5) shown++;
          else clipped++;
        }
        InkBook.turn(1);
      }
      return { pages, lines: total, shown, clipped };
    },
  };
})();
