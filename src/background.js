/* InkPage background: keyboard commands, toolbar badge, top-frame lookup for iframes. */
'use strict';

if (typeof InkSettings === 'undefined' && typeof importScripts === 'function') {
  importScripts('shared/settings.js'); // Chrome / Safari service worker
}

const api = globalThis.browser ?? globalThis.chrome;

async function activeTabId() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab && tab.id;
}

api.commands.onCommand.addListener(async (command) => {
  const tabId = await activeTabId();
  if (tabId == null) return;
  const type = { 'toggle-eink': 'toggle', 'refresh-screen': 'flash', 'toggle-book': 'toggleBook' }[command];
  if (!type) return;
  try {
    await api.tabs.sendMessage(tabId, { type }, { frameId: 0 });
  } catch (_) {
    // Browser-internal page: content scripts can't run there.
  }
});

// Tell every open tab when settings change (options page, popup, another tab), since
// Safari doesn't reliably deliver storage.onChanged to content scripts.
api.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !InkSettings.KEYS.some((k) => k in changes)) return;
  for (const tab of await api.tabs.query({})) {
    if (tab.id != null) api.tabs.sendMessage(tab.id, { type: 'settingsChanged' }).catch(() => {});
  }
});

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !sender.tab) return;
  if (msg.type === 'topHost') {
    // Firefox has no location.ancestorOrigins; iframes ask which site the tab is on.
    let host = '';
    try { host = new URL(sender.tab.url).hostname; } catch (_) {}
    sendResponse({ host });
    return;
  }
  if (msg.type === 'loadBook') {
    // Book view code is only injected into pages that ask for it.
    api.scripting.executeScript({
      target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] },
      files: ['vendor/Readability.js', 'content/book.js'],
    }).then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
  if (msg.type === 'badge' && sender.frameId === 0) {
    const tabId = sender.tab.id;
    api.action.setBadgeText({ tabId, text: msg.enabled ? 'ON' : '' });
    api.action.setBadgeBackgroundColor?.({ tabId, color: '#111111' });
    api.action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
  }
});
