// Fails the build if code crosses an app boundary.
//   shell  -> may import core and any app (it is the only place that knows them all)
//   core   -> may import core only
//   app X  -> may import app X and core only (never shell, never another app)
//   main.tsx -> may import shell only
// Usage: node scripts/check-boundaries.mjs [srcDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(process.argv[2] ?? path.join(here, '..', 'src'));

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Which area a src-relative path belongs to: "shell", "core", "app:<name>" or "root".
function area(rel) {
  const parts = rel.split('/');
  if (parts[0] === 'shell') return 'shell';
  if (parts[0] === 'core') return 'core';
  if (parts[0] === 'apps' && parts[1]) return 'app:' + parts[1];
  return 'root';
}

function allowed(from, to) {
  if (from === 'shell') return true;
  if (from === 'root') return to === 'shell' || to === 'root';
  if (from === 'core') return to === 'core';
  return to === from || to === 'core'; // an app
}

const spec = /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)(["'])([^"']+)\1/g;
const problems = [];

for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file).split(path.sep).join('/');
  const from = area(rel);
  const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (/^\s*\/\//.test(line)) return;
    for (const m of line.matchAll(spec)) {
      const s = m[2];
      let target;
      if (s.startsWith('@/')) target = s.slice(2);
      else if (s.startsWith('.')) target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), s));
      else continue; // npm package
      if (target.startsWith('..')) {
        problems.push(`${rel}:${i + 1} imports outside src (${s})`);
        continue;
      }
      const to = area(target);
      if (!allowed(from, to)) {
        problems.push(`${rel}:${i + 1} ${from} must not import ${to} (${s})`);
      }
    }
  });
}

if (problems.length) {
  console.error('\nApp boundary check failed:\n');
  for (const p of problems) console.error('  ' + p);
  console.error('\nRules: an app may import itself and src/core only. Shared code belongs in src/core.');
  console.error('See docs/APP_RULES.md.\n');
  process.exit(1);
}
console.log(`App boundary check passed (${walk(SRC).length} files).`);
