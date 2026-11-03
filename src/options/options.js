'use strict';

const api = globalThis.browser ?? globalThis.chrome;
const S = globalThis.InkSettings;
const $ = (sel) => document.querySelector(sel);
const t = (key, ...subs) => { try { return api.i18n.getMessage(key, subs) || ''; } catch (_) { return ''; } };

for (const el of document.querySelectorAll('[data-i18n]')) {
  const msg = t(el.dataset.i18n);
  if (msg) el.textContent = msg;
}

async function render() {
  const store = await api.storage.local.get(S.KEYS);
  const sites = store.sites || {};
  const rows = $('#rows');
  rows.textContent = '';
  const names = Object.keys(sites).sort();
  $('#empty').hidden = names.length > 0;
  for (const name of names) {
    const entry = sites[name];
    const tr = document.createElement('tr');
    const own = [];
    const count = Object.keys(entry).filter((k) => k !== 'enabled' && k !== 'hidden').length;
    if (count) own.push(t('optOwnCount', String(count)) || `${count} own settings`);
    if (entry.hidden && entry.hidden.length) own.push(`${t('optHidden') || 'hidden'}: ${entry.hidden.length}`);
    const cells = [
      name,
      'enabled' in entry ? (entry.enabled ? t('on') || 'On' : t('off') || 'Off') : '—',
      own.join(' · ') || '—',
    ];
    for (const text of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    const td = document.createElement('td');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link';
    btn.textContent = t('optRemove') || 'Remove';
    btn.addEventListener('click', async () => {
      delete sites[name];
      await api.storage.local.set({ sites });
      render();
    });
    td.appendChild(btn);
    tr.appendChild(td);
    rows.appendChild(tr);
  }
}

$('#export').addEventListener('click', async () => {
  const store = await api.storage.local.get(S.KEYS);
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'inkpage-settings.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#import').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const next = {};
    if (data.defaults && typeof data.defaults === 'object') next.defaults = data.defaults;
    if (data.sites && typeof data.sites === 'object') next.sites = data.sites;
    if (typeof data.everywhere === 'boolean') next.everywhere = data.everywhere;
    await api.storage.local.set(next);
    render();
  } catch (_) {
    alert(t('optBadFile') || 'That file is not an InkPage settings export.');
  }
  e.target.value = '';
});

$('#resetAll').addEventListener('click', async () => {
  if (!confirm(t('optConfirmReset') || 'Forget every site and restore the default settings?')) return;
  await api.storage.local.set({ defaults: {}, sites: {}, everywhere: false });
  render();
});

api.storage.onChanged.addListener(render);
render();
