// Checks that every message key used in src/ exists in each locale, and lists unused keys.
// Usage: node scripts/check-i18n.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'vendor' && name !== '_locales') walk(p); } else if (/\.(js|html)$/.test(name)) files.push(p);
  }
})(src);

const used = new Map();
const add = (key, file) => { if (!used.has(key)) used.set(key, new Set()); used.get(key).add(file.replace(`${src}/`, '')); };
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)) add(m[1], f);
  for (const m of text.matchAll(/getMessage\(\s*'([A-Za-z0-9_]+)'/g)) add(m[1], f);
  for (const m of text.matchAll(/data-i18n="([A-Za-z0-9_]+)"/g)) add(m[1], f);
}
const build = readFileSync(join(src, '..', 'scripts', 'build.mjs'), 'utf8');
for (const m of build.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) add(m[1], 'manifest');

let bad = 0;
const locales = readdirSync(join(src, '_locales'));
for (const loc of locales) {
  const msgs = JSON.parse(readFileSync(join(src, '_locales', loc, 'messages.json'), 'utf8'));
  const missing = [...used.keys()].filter((k) => !msgs[k]);
  const unused = Object.keys(msgs).filter((k) => !used.has(k));
  console.log(`${loc}: ${Object.keys(msgs).length} messages, ${missing.length} missing, ${unused.length} unused`);
  for (const k of missing) { bad++; console.log(`  missing ${k}  (used in ${[...used.get(k)].join(', ')})`); }
  if (unused.length) console.log(`  unused: ${unused.join(', ')}`);
}
process.exit(bad ? 1 : 0);
