#!/usr/bin/env node
// Lit la sortie TAP de node --test sur l'entrée standard, la recopie, et publie chaque échec comme annotation
// GitHub Actions (::error::) pour que la cause soit lisible dans l'onglet Checks sans ouvrir le journal.
'use strict';
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { buf += d; process.stdout.write(d); });
process.stdin.on('end', () => {
  const lines = buf.split('\n'); const fails = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*not ok \d+ - (.*)$/); if (!m) continue;
    const name = m[1].replace(/\s*#.*$/, ''); const detail = [];
    for (let j = i + 1; j < lines.length && j < i + 60; j++) {
      const l = lines[j]; if (/^\s*\.\.\.\s*$/.test(l) || /^\s*(not )?ok \d+/.test(l)) break;
      if (/^\s*(error:|expected:|actual:|name:|location:)/.test(l) || /^\s{8,}\S/.test(l)) detail.push(l.trim());
    }
    if (!/subtests? failed/.test(detail.join(' '))) fails.push({ name, detail: detail.slice(0, 14).join(' | ') });
  }
  if (!fails.length) return;
  const esc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  fails.slice(0, 10).forEach(f => console.log(`::error title=${esc(f.name).replace(/,/g, '%2C').replace(/:/g, '%3A')}::${esc(f.detail).slice(0, 900)}`));
  console.log(`::notice::${fails.length} test(s) en échec`);
});
