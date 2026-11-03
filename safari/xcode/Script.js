// Text for the container app's one screen. ViewController.swift calls show() once the page
// has loaded, and again whenever the app comes back to the foreground.
const zh = /^zh\b/i.test(navigator.language);

const T = zh ? {
    title: '墨页',
    lead: '让 Safari 里的网页像纸一样安静：白纸黑字，一次翻一屏，书页模式只留正文。',
    on: '墨页已开启。',
    off: '墨页还没开启。',
    iosStep1: '打开“设置” → App → Safari → 扩展 → 墨页。',
    iosStep2: '打开墨页，并把“所有网站”设为“允许”。',
    iosStep3: '回到 Safari，点地址栏里的页面菜单按钮，再点“墨页”。',
    macStep1: '在 Safari → 设置 → 扩展 里勾选墨页，并允许它访问网站。',
    macStep2: '在任意网页点工具栏上的墨页按钮。',
    open: '打开 Safari 扩展设置',
} : {
    title: 'InkPage',
    lead: 'Quiet, paper-like pages in Safari: black on white, one screen per page, and a book view that keeps only the article.',
    on: 'InkPage is on.',
    off: 'InkPage is off.',
    iosStep1: 'Open Settings → Apps → Safari → Extensions → InkPage.',
    iosStep2: 'Turn InkPage on and set All Websites to Allow.',
    iosStep3: 'Back in Safari, tap the page menu button in the address bar, then InkPage.',
    macStep1: 'In Safari → Settings → Extensions, tick InkPage and allow it on websites.',
    macStep2: 'On any page, click the InkPage button in the toolbar.',
    open: 'Open Safari Extension Settings',
};

document.documentElement.lang = zh ? 'zh-Hans' : 'en';
document.title = T.title;
for (const el of document.querySelectorAll('[data-t]')) el.textContent = T[el.dataset.t];

// enabled: true / false, or null when the system can't tell us.
// canOpen: whether the button can jump straight to the extension's settings.
function show(platform, enabled, canOpen) {
    document.body.classList.add(`platform-${platform}`);
    document.body.classList.toggle('state-on', enabled === true);
    document.body.classList.toggle('state-off', enabled === false);
    document.body.classList.toggle('can-open', canOpen === true);
}

document.querySelector('button.open-settings').addEventListener('click', () => {
    webkit.messageHandlers.controller.postMessage('open-settings');
});
