// Builds dist/{chrome,firefox,safari} from src/ and zips the Chrome and Firefox packages.
// Usage: node scripts/build.mjs
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// Firefox add-on ID: set your own before the first AMO upload; it can never change after.
const GECKO_ID = 'inkpage@inkpage.app';

const icons = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };

function manifest(target) {
  const m = {
    manifest_version: 3,
    name: '__MSG_extName__',
    short_name: '__MSG_extShort__',
    description: '__MSG_extDesc__',
    version: pkg.version,
    default_locale: 'en',
    icons,
    action: { default_title: '__MSG_extName__', default_popup: 'popup/popup.html', default_icon: icons },
    permissions: ['storage', 'scripting'],
    host_permissions: ['<all_urls>'],
    content_scripts: [{
      matches: ['<all_urls>'],
      js: ['shared/settings.js', 'content/content.js'],
      run_at: 'document_start',
      all_frames: true,
      match_about_blank: true,
    }],
    commands: {
      'toggle-eink': { suggested_key: { default: 'Alt+Shift+E' }, description: '__MSG_cmdToggle__' },
      'refresh-screen': { suggested_key: { default: 'Alt+Shift+R' }, description: '__MSG_cmdRefresh__' },
      'toggle-book': { suggested_key: { default: 'Alt+Shift+B' }, description: '__MSG_cmdBook__' },
    },
    options_ui: { page: 'options/options.html', open_in_tab: true },
    web_accessible_resources: [{ resources: ['fonts/*.woff2'], matches: ['<all_urls>'] }],
  };
  // Chrome can hide the fixed extension URL from pages (less fingerprintable).
  if (target === 'chrome') m.web_accessible_resources[0].use_dynamic_url = true;
  if (target === 'firefox') {
    m.background = { scripts: ['shared/settings.js', 'background.js'] };
    m.browser_specific_settings = {
      // data_collection_permissions (required for new add-ons) arrived in Firefox 140 / Android 142.
      gecko: { id: GECKO_ID, strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } },
      gecko_android: { strict_min_version: '142.0' },
    };
  } else {
    m.background = { service_worker: 'background.js' };
  }
  if (target === 'chrome') m.minimum_chrome_version = '111';
  // Safari 16.4 (macOS 13.3 / iOS 16.4) is the first with MV3 scripting and constructed stylesheets in extensions.
  if (target === 'safari') m.browser_specific_settings = { safari: { strict_min_version: '16.4' } };
  return m;
}

rmSync(dist, { recursive: true, force: true });
for (const target of ['chrome', 'firefox', 'safari']) {
  const out = join(dist, target);
  mkdirSync(out, { recursive: true });
  cpSync(src, out, { recursive: true, filter: (p) => !p.endsWith('.DS_Store') });
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest(target), null, 2)}\n`);
  // One Chinese text for every Chinese browser: Traditional-Chinese locales would
  // otherwise fall back to English.
  cpSync(join(out, '_locales', 'zh_CN'), join(out, '_locales', 'zh_TW'), { recursive: true });
  if (target !== 'safari') {
    const zip = join(dist, `inkpage-${target}-${pkg.version}.zip`);
    execFileSync('zip', ['-qr', zip, '.'], { cwd: out });
    console.log(`✓ ${target}  →  ${zip.replace(`${root}/`, '')}`);
  } else {
    console.log(`✓ safari  →  dist/safari  (convert with: xcrun safari-web-extension-converter dist/safari --app-name InkPage)`);
  }
}
if (!existsSync(join(src, 'icons', 'icon-128.png'))) console.warn('! icons missing: run python3 scripts/icons.py src/icons');
