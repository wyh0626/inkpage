'use strict';

const api = globalThis.browser ?? globalThis.chrome;
const S = globalThis.InkSettings;
const $ = (sel) => document.querySelector(sel);

const t = (key, ...subs) => {
  try { return api.i18n.getMessage(key, subs) || ''; } catch (_) { return ''; }
};

// Each paper swatch shows its own ink on its own paper (colours from the shared theme table).
function paintSwatches() {
  for (const b of document.querySelectorAll('.swatches button')) {
    const tone = S.themeOf(b.dataset.v);
    b.style.background = tone.bg;
    b.style.color = tone.fg;
  }
}

function localize() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
  }
  document.documentElement.lang = api.i18n.getUILanguage ? api.i18n.getUILanguage() : 'en';
}

let tabId = null;
let site = '';
let store = {};

async function findSite() {
  const forced = Number(new URLSearchParams(location.search).get('tab')); // popup.html?tab=<id> for testing
  const [tab] = forced ? [await api.tabs.get(forced)] : await api.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { ok: false };
  tabId = tab.id;
  let host = '';
  try {
    const u = new URL(tab.url || '');
    if (/^https?:$|^file:$/.test(u.protocol)) host = u.hostname;
  } catch (_) {}
  const errors = [];
  // Some browsers reject the frameId option; ask the tab without it as a second try.
  for (const opts of [{ frameId: 0 }, undefined]) {
    try {
      const res = await (opts ? api.tabs.sendMessage(tab.id, { type: 'hello' }, opts) : api.tabs.sendMessage(tab.id, { type: 'hello' }));
      // Delivered. The page's own answer names the site (it knows the top frame); without
      // one, the tab's address does.
      const named = res && typeof res.site === 'string' && res.site;
      if (named || host) return { ok: true, site: named || S.siteKey(host) };
    } catch (e) {
      errors.push(String((e && e.message) || e));
    }
  }
  // Not delivered: browser page, store page, a tab opened before install, or messaging blocked.
  return { ok: false, site: S.siteKey(host), reloadable: !!host, error: errors.join(' / ') };
}

// Save, then tell the page right away: Safari doesn't reliably pass storage changes
// on to content scripts, so the page would otherwise only update after a reload.
async function persist(data) {
  await api.storage.local.set(data);
  if (tabId != null) api.tabs.sendMessage(tabId, { type: 'settingsChanged' }).catch(() => {});
}

async function load() {
  store = await api.storage.local.get(S.KEYS);
  store.sites = store.sites || {};
  store.defaults = store.defaults || {};
}

function render() {
  const cfg = S.resolve(store, site);
  const own = store.sites[site] || {};
  $('#enabled').checked = cfg.enabled;
  $('#everywhere').checked = !!store.everywhere;
  $('#controls').classList.toggle('off', !cfg.enabled);

  for (const seg of document.querySelectorAll('.seg[data-key]')) {
    const key = seg.dataset.key;
    for (const b of seg.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(String(cfg[key]) === b.dataset.v));
    }
    markOwn(seg.closest('.row'), key in own);
  }
  for (const sw of document.querySelectorAll('.sw[data-key]')) {
    sw.checked = !!cfg[sw.dataset.key];
    markOwn(sw.closest('.row'), sw.dataset.key in own);
  }
  document.body.classList.toggle('book-mode', cfg.mode === 'book');
  for (const row of document.querySelectorAll('.row.dep')) row.classList.toggle('muted', !cfg.paging && cfg.mode !== 'book');
  for (const step of document.querySelectorAll('.step[data-key]')) {
    step.querySelector('.val').textContent = String(cfg[step.dataset.key]);
    markOwn(step.closest('.row'), step.dataset.key in own);
  }

  const hidden = own.hidden || [];
  $('#hiddenRow').hidden = hidden.length === 0;
  $('#hiddenCount').textContent = t('hiddenCount', String(hidden.length)) || `${hidden.length} hidden on this site`;
}

function markOwn(row, on) {
  if (!row) return;
  const label = row.querySelector(':scope > span:first-child > span') || row.querySelector(':scope > span:first-child');
  if (label) label.classList.toggle('mark', on);
}

async function setSite(patch) {
  store.sites[site] = Object.assign({}, store.sites[site], patch);
  await persist({ sites: store.sites });
  render();
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

function wire() {
  $('#enabled').addEventListener('change', (e) => setSite({ enabled: e.target.checked }));

  $('#everywhere').addEventListener('change', async (e) => {
    store.everywhere = e.target.checked;
    await persist({ everywhere: store.everywhere });
    render();
  });

  for (const seg of document.querySelectorAll('.seg[data-key]')) {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const v = 'num' in seg.dataset ? Number(b.dataset.v) : b.dataset.v;
      // Picking a reading mode implies the user wants InkPage on for this site.
      setSite(seg.dataset.key === 'mode' ? { mode: v, enabled: true } : { [seg.dataset.key]: v });
    });
  }
  for (const step of document.querySelectorAll('.step[data-key]')) {
    step.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const key = step.dataset.key;
      const { min, max } = S.LIMITS[key];
      const next = Math.max(min, Math.min(max, S.resolve(store, site)[key] + Number(b.dataset.d)));
      setSite({ [key]: next });
    });
  }
  for (const sw of document.querySelectorAll('.sw[data-key]')) {
    sw.addEventListener('change', () => setSite({ [sw.dataset.key]: sw.checked }));
  }

  $('#flash').addEventListener('click', () => {
    api.tabs.sendMessage(tabId, { type: 'flash' }, { frameId: 0 }).catch(() => {});
  });

  $('#pick').addEventListener('click', async () => {
    if (!S.resolve(store, site).enabled) await setSite({ enabled: true });
    api.tabs.sendMessage(tabId, { type: 'pick' }, { frameId: 0 }).catch(() => {});
    window.close();
  });

  $('#restoreHidden').addEventListener('click', async () => {
    const entry = Object.assign({}, store.sites[site]);
    delete entry.hidden;
    store.sites[site] = entry;
    await persist({ sites: store.sites });
    render();
  });

  $('#makeDefault').addEventListener('click', async () => {
    const cfg = S.resolve(store, site);
    const defaults = {};
    for (const k of Object.keys(S.DEFAULTS)) defaults[k] = cfg[k];
    // This site now simply follows the defaults (keeps on/off and hidden elements).
    const entry = store.sites[site] || {};
    const keep = {};
    if ('enabled' in entry) keep.enabled = entry.enabled;
    if (entry.hidden) keep.hidden = entry.hidden;
    store.defaults = defaults;
    store.sites[site] = keep;
    await persist({ defaults, sites: store.sites });
    render();
    toast(t('savedDefault') || 'Saved as default');
  });

  $('#resetSite').addEventListener('click', async () => {
    delete store.sites[site];
    await persist({ sites: store.sites });
    render();
    toast(t('resetDone') || 'Site reset');
  });
}

(async () => {
  localize();
  paintSwatches();
  const found = await findSite();
  site = found.site || '';
  $('#site').textContent = site || '—';
  if (!found.ok && !found.reloadable) {
    $('#unavailable').hidden = false;
    $('#controls').hidden = true;
    $('#enabled').disabled = true;
    return;
  }
  if (!found.ok) {
    // Settings still work: they are saved to storage and the page picks them up from there.
    // Only the actions that talk to the page directly need it to answer.
    const note = $('#unavailable');
    note.hidden = false;
    note.textContent = t('pageNotReached') || 'This page did not answer. Settings still apply; refresh the page for Refresh screen and Hide elements.';
    if (found.error) note.appendChild(Object.assign(document.createElement('small'), { className: 'err', textContent: found.error }));
  }
  await load();
  wire();
  render();
})();
