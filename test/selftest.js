// In-page self test for browsers we can't script (Safari): open a fixture with
// ?ext&selftest, turn InkPage on, and the results appear in the tab title and at the
// top of the page. Page scripts can't see the extension's world, so this only checks
// what the DOM shows.
(() => {
  if (!location.search.includes('selftest')) return;
  const results = [];
  const ok = (name, pass, detail = '') => results.push(`${pass ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const wait = async (cond, ms) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(200)) if (cond()) return true;
    return false;
  };
  const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const browser = (navigator.userAgent.match(/Version\/[\d.]+ Safari|Firefox\/[\d.]+|Chrome\/[\d.]+/) || ['?'])[0];

  function show() {
    const pass = results.filter((r) => r.startsWith('✓')).length;
    document.title = `SELFTEST ${pass}/${results.length} ${pass === results.length ? 'PASS' : 'FAIL'}`;
    let pre = document.getElementById('selftest');
    if (!pre) {
      pre = document.createElement('pre');
      pre.id = 'selftest';
      pre.style.cssText = 'white-space:pre-wrap;font:15px/1.6 ui-monospace,Menlo,monospace;padding:14px;margin:0;border:3px solid';
      document.body.prepend(pre);
    }
    pre.textContent = `SELFTEST · ${browser} · ${navigator.language}\n${results.join('\n')}`;
    // Also report to the local test server's request log, so results can be read without a screen.
    const q = new URLSearchParams({ page: location.pathname, browser, lang: navigator.language, title: document.title, results: results.join(' | ') });
    new Image().src = `/__selftest?${q}`; // an image request: test pages may forbid fetch (connect-src 'none')
  }

  // Every text line inside `root` must be shown whole (not under the bottom mask) on some page.
  function audit(root) {
    const rg = document.createRange();
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const all = [];
    for (let n; (n = tw.nextNode());) { rg.selectNodeContents(n); for (const r of rg.getClientRects()) if (r.height) all.push({ top: r.top + scrollY, bottom: r.bottom + scrollY, text: n.data.trim().slice(0, 24) }); }
    const lines = [];
    for (const l of all.sort((a, b) => a.top - b.top)) if (!lines.length || Math.abs(lines[lines.length - 1].top - l.top) > 3) lines.push(l);
    const seen = new Set();
    const pages = [];
    const max = document.documentElement.scrollHeight - innerHeight;
    scrollTo(0, 0);
    for (let i = 0; i < 200; i++) {
      const y0 = scrollY;
      const y1 = y0 + innerHeight;
      const cut = lines.filter((l) => l.top < y1 - 1 && l.bottom > y1 + 0.5).map((l) => l.top);
      const maskFrom = cut.length && y0 < max - 1 ? Math.min(...cut) : y1;
      lines.forEach((l, k) => { if (l.top >= y0 - 0.5 && l.bottom <= maskFrom + 0.5) seen.add(k); });
      pages.push([Math.round(y0 * 10) / 10, Math.round(maskFrom * 10) / 10]);
      key('PageDown');
      if (Math.abs(scrollY - y0) < 1) break;
    }
    const missed = lines.filter((l, k) => !seen.has(k)).map((l) => `${l.top.toFixed(1)}–${l.bottom.toFixed(1)} "${l.text}"`);
    return { lines: lines.length, missed: missed.length, detail: missed.length ? `missed ${missed.join('; ')} · vh ${innerHeight} · pages [top,maskFrom] ${pages.map((p) => p.join(',')).join(' ')}` : '' };
  }

  addEventListener('load', () => run().catch((e) => { ok('self test crashed', false, String(e)); show(); }));
  async function run() {
    document.title = 'SELFTEST: waiting for InkPage…';
    const on = await wait(() => document.documentElement.hasAttribute('data-inkpage'), 600000);
    ok('InkPage is on for this page', on);
    if (!on) return show();
    await sleep(1500); // let the scanner and fonts settle
    const cs = (sel) => getComputedStyle(document.querySelector(sel));
    const fonts = [...document.fonts].filter((f) => f.family.startsWith('Ink') && f.status === 'loaded').map((f) => f.family);

    if (document.querySelector('inkpage-book') || document.querySelector('article h1') && !document.getElementById('article')) {
      const opened = await wait(() => document.querySelector('inkpage-book'), 5000);
      ok('book view opened', opened);
      const under = getComputedStyle(document.body.firstElementChild).visibility;
      ok('page underneath frozen', document.documentElement.hasAttribute('data-ink-book') && under === 'hidden', under);
      ok('bundled reading font loaded', fonts.length > 0, [...new Set(fonts)].join(', ') || 'none');
      return show();
    }

    if (document.getElementById('box')) { // csp.html: inline <style> is forbidden there
      ok('styles applied under strict CSP', cs('#box').backgroundColor !== 'rgb(17, 34, 51)', cs('#box').backgroundColor);
      const el = document.getElementById('inkpage-style');
      let how = 'blocked → constructed stylesheet';
      try { if (el && el.sheet && el.sheet.cssRules.length) how = `<style> allowed (${el.sheet.cssRules.length} rules)`; } catch (_) { how = '<style> allowed (rules hidden from the page)'; }
      ok('how the styles got in', true, how);
      return show();
    }
    const paper = cs('html').backgroundColor;
    ok('dark hero turned to paper', cs('.hero').backgroundColor === paper, cs('.hero').backgroundColor);
    ok('text in ink (was #333)', cs('p').color !== 'rgb(51, 51, 51)', cs('p').color);
    ok('dropdown kept opaque', document.getElementById('menu').getAttribute('data-ink-layer') === 'pop');
    ok('fixed header released', cs('#top').position === 'absolute', cs('#top').position);
    ok('GIF frozen', document.getElementById('gif').getAttribute('data-ink-gif') === 'frozen');
    ok('shadow DOM styled', !!document.getElementById('fc').shadowRoot.querySelector('style[data-inkpage]'));
    ok('fade-in content visible', cs('#fade').opacity === '1', cs('#fade').opacity);
    scrollTo(0, 0);
    await sleep(100);
    const y0 = scrollY;
    key('PageDown');
    await sleep(100);
    ok('PageDown turns one screen', scrollY - y0 > innerHeight * 0.6, `${y0} → ${Math.round(scrollY)}`);
    const a = audit(document.getElementById('article'));
    ok('no line lost across pages', a.missed === 0, `${a.lines} lines, ${a.missed} missed${a.detail ? ` · ${a.detail}` : ''}`);
    scrollTo(0, 0);
    show();
  }
})();
