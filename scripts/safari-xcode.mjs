// Wraps dist/safari in an Xcode project with iOS/iPadOS and macOS apps (safari-app/InkPage),
// then applies what the converter's template lacks: the bilingual setup screen in safari/xcode,
// the real icon, the package version, the signing team and the App Store Info.plist keys.
// The project is regenerated from scratch each run, so change safari/xcode, not safari-app.
// Needs the full Xcode app (not only the command line tools).
//
// Usage: node scripts/safari-xcode.mjs
//   INKPAGE_BUNDLE_ID  app bundle ID, the extension gets .Extension   (io.github.wyh0626.inkpage)
//   INKPAGE_TEAM_ID    Apple developer team for automatic signing      (PFM45ATWW9)
//   INKPAGE_BUILD      build number; raise it for each upload of the same version  (1)
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const bundleId = process.env.INKPAGE_BUNDLE_ID || 'io.github.wyh0626.inkpage';
const team = process.env.INKPAGE_TEAM_ID || 'PFM45ATWW9';
const build = process.env.INKPAGE_BUILD || '1';

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
const sips = (size, from, to) => execFileSync('sips', ['-z', size, size, from, '--out', to], { stdio: 'ignore' });

run('node', ['scripts/build.mjs']);
run('xcrun', ['safari-web-extension-converter', 'dist/safari', '--project-location', 'safari-app',
  '--app-name', 'InkPage', '--bundle-identifier', bundleId, '--swift', '--copy-resources', '--no-open', '--force']);

const project = join(root, 'safari-app', 'InkPage');
const app = join(project, 'Shared (App)');
const ours = join(root, 'safari', 'xcode');

// Setup screen.
copyFileSync(join(ours, 'ViewController.swift'), join(app, 'ViewController.swift'));
copyFileSync(join(ours, 'Main.html'), join(app, 'Resources', 'Base.lproj', 'Main.html'));
copyFileSync(join(ours, 'Script.js'), join(app, 'Resources', 'Script.js'));
copyFileSync(join(ours, 'Style.css'), join(app, 'Resources', 'Style.css'));

// Icons, all from the 1024 px store icon (no alpha, as the App Store requires).
const icon = join(root, 'store', 'icon-1024.png');
sips('192', icon, join(app, 'Resources', 'Icon.png'));
sips('256', icon, join(app, 'Assets.xcassets', 'LargeIcon.imageset', 'icon-128.png'));
const appIcon = join(app, 'Assets.xcassets', 'AppIcon.appiconset');
for (const name of readdirSync(appIcon)) {
  const m = name.match(/-(\d+)@(\d)x\.png$/);
  if (m) sips(String(m[1] * m[2]), icon, join(appIcon, name));
}

// Build settings, one per line. Xcode 27 writes the JSON-like project.xcproj ("KEY": "value",),
// older Xcode project.pbxproj (KEY = value;).
const dir = join(project, 'InkPage.xcodeproj');
const xcproj = existsSync(join(dir, 'project.xcproj'));
const file = join(dir, xcproj ? 'project.xcproj' : 'project.pbxproj');
const entry = (key, value) => (xcproj ? `"${key}": "${value}",` : `${key} = "${value}";`);
const lines = (key, value = '[^\\n]*') => new RegExp(xcproj ? `^(\\s*)"${key}": "${value}",$` : `^(\\s*)${key} = "?${value}"?;$`, 'gm');
let text = readFileSync(file, 'utf8');
const set = (key, value) => { text = text.replace(lines(key), `$1${entry(key, value)}`); };
const addAfter = (key, value, extra) => {
  text = text.replace(lines(key, value), (line, indent) => [line, ...extra.map(([k, v]) => indent + entry(k, v))].join('\n'));
};
set('MARKETING_VERSION', pkg.version);
set('CURRENT_PROJECT_VERSION', build);
// The extension needs Safari 16.4 (see build.mjs); match the app's iOS 17.
set('IPHONEOS_DEPLOYMENT_TARGET', '17.0');
set('MACOSX_DEPLOYMENT_TARGET', '13.3');
addAfter('CODE_SIGN_STYLE', 'Automatic', [['DEVELOPMENT_TEAM', team]]);
// App targets only: no export-compliance question on every upload, and the Mac App Store category.
addAfter('INFOPLIST_KEY_CFBundleDisplayName', 'InkPage', [
  ['INFOPLIST_KEY_ITSAppUsesNonExemptEncryption', 'NO'],
  ['INFOPLIST_KEY_LSApplicationCategoryType', 'public.app-category.productivity'],
]);
if (!text.includes(team)) throw new Error(`no CODE_SIGN_STYLE settings found in ${file}`);
writeFileSync(file, text);

console.log(`✓ safari-app/InkPage/InkPage.xcodeproj  (${bundleId} ${pkg.version} (${build}), team ${team})`);
