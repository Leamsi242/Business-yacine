#!/usr/bin/env node
// Couverture des scripts du site (js/*.js) à partir des données V8 brutes (NODE_V8_COVERAGE).
// Node ne les affiche pas lui-même car ils sont évalués dans jsdom ou vm, pas chargés comme modules.
// Usage : npm run test:unit:coverage  (lance les tests avec NODE_V8_COVERAGE=coverage/raw puis ce script)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const RAW = process.argv[2] || path.join(ROOT, 'coverage', 'raw');
const MIN = +(process.env.COVERAGE_MIN || 0); // seuil global (lignes), 0 = informatif

const files = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js') && !['data.js', 'tariffs.js', 'config.js'].includes(f)).map(f => 'js/' + f);
const src = {}; files.forEach(f => src[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'));
const covered = {}; const seen = {}; // par fichier : Uint8Array(1 = exécuté, 2 = non exécuté) par caractère
files.forEach(f => { covered[f] = new Uint8Array(src[f].length); seen[f] = false; });

for (const name of fs.existsSync(RAW) ? fs.readdirSync(RAW) : []) {
  const j = JSON.parse(fs.readFileSync(path.join(RAW, name), 'utf8'));
  for (const r of j.result) {
    if (!covered[r.url]) continue; seen[r.url] = true;
    const ranges = r.functions.flatMap(fn => fn.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    const counts = new Int32Array(src[r.url].length).fill(-1);
    ranges.forEach(g => { const end = Math.min(g.endOffset, counts.length); for (let i = g.startOffset; i < end; i++) counts[i] = g.count; });
    const c = covered[r.url]; for (let i = 0; i < c.length; i++) { if (counts[i] > 0) c[i] = 1; else if (counts[i] === 0 && c[i] !== 1) c[i] = 2; }
  }
}

const rows = []; let totLines = 0, totCov = 0;
for (const f of files) {
  const lines = src[f].split('\n'); const c = covered[f]; let off = 0; let n = 0, ok = 0; const miss = [];
  lines.forEach((line, i) => {
    const code = !/^\s*(\/\/.*)?$/.test(line) && !/^\s*[{}();]*\s*$/.test(line);
    if (code) { n++; let hit = false, any = false; for (let k = off; k < off + line.length; k++) { if (/\s/.test(src[f][k])) continue; any = true; if (c[k] === 1) { hit = true; break; } } if (hit || !any) ok++; else miss.push(i + 1); }
    off += line.length + 1;
  });
  totLines += n; totCov += ok;
  rows.push({ f, n, ok, pct: n ? 100 * ok / n : 100, miss: seen[f] ? miss : null });
}
const compact = a => { if (!a) return 'jamais chargé'; const out = []; for (let i = 0; i < a.length; i++) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; out.push(j > i ? a[i] + '-' + a[j] : String(a[i])); i = j; } return out.join(', '); };
console.log('\nCouverture des scripts du site (lignes de code, hors data/tariffs/config)\n');
console.log('fichier'.padEnd(20) + 'lignes'.padStart(8) + 'couvertes'.padStart(11) + '    %   non couvertes');
rows.forEach(r => console.log(r.f.padEnd(20) + String(r.n).padStart(8) + String(r.ok).padStart(11) + (r.pct.toFixed(1) + ' %').padStart(9) + '   ' + (r.miss && r.miss.length ? compact(r.miss).slice(0, 110) : (r.miss ? '' : 'jamais chargé'))));
const pct = totLines ? 100 * totCov / totLines : 0;
console.log('\nTotal'.padEnd(21) + String(totLines).padStart(8) + String(totCov).padStart(11) + (pct.toFixed(1) + ' %').padStart(9) + (MIN ? '   seuil ' + MIN + ' %' : ''));
if (MIN && pct < MIN) { console.error('\nCouverture ' + pct.toFixed(1) + ' % sous le seuil de ' + MIN + ' %'); process.exit(1); }
