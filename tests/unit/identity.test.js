// Identité visuelle et couleur des données : une seule rampe séquentielle (PYU.seqColor) partagée par la carte,
// le monde à conduire et le mur des semaines, la même dans css/app.css, et des contrastes d'au moins 3:1.
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, enter } = require('../helpers/dom');
const { localState } = require('../helpers/data');

const ROOT = path.resolve(__dirname, '..', '..');
const NOW = '2026-10-15T21:00:00-04:00';
const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Contraste WCAG entre deux couleurs #RRGGBB.
function lum(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0); }
function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

describe('rampe séquentielle partagée', () => {
  test('PYU.seqColor : paliers de 1,30 $ à 3,30 $, graphite en clair, inversée en sombre', async () => {
    const c = await boot({ now: NOW });
    try {
      const U = c.w.PYU;
      assert.deepEqual([0, 1.3, 1.65, 1.75, 2.15, 2.55, 2.85, 2.95, 3.3, 9].map(v => U.seqLevel(v)), [0, 0, 0, 1, 2, 3, 3, 4, 4, 4]);
      assert.equal(U.seqLevel(undefined), 0); assert.equal(U.seqLevel('2.2'), 2);
      assert.equal(U.seqColor(1.2), '#E5E5E5'); assert.equal(U.seqColor(2.2), '#8C8C8C'); assert.equal(U.seqColor(3.5), '#1A1A1A');
      assert.equal(U.seqColor(1.2, true), '#3A3A3E'); assert.equal(U.seqColor(3.5, true), '#F5F5F7');
      // Plus payant, plus contrasté contre le fond, en clair comme en sombre.
      const up = (ramp, bg) => ramp.every((col, i) => !i || contrast(col, bg) > contrast(ramp[i - 1], bg));
      assert.ok(up(U.SEQ.light, '#FFFFFF')); assert.ok(up(U.SEQ.dark, '#1C1C1E'));
      // Le contour posé autour des marques garde 3:1 contre les fonds de carte.
      for (const bg of ['#FFFFFF', '#F5F5F7']) assert.ok(contrast(U.SEQ_EDGE.light, bg) >= 3, bg);
      for (const bg of ['#1C1C1E', '#26262A', '#0F0F10']) assert.ok(contrast(U.SEQ_EDGE.dark, bg) >= 3, bg);
      // Les paliers 3 à 5 tiennent seuls 3:1.
      U.SEQ.light.slice(2).forEach(col => assert.ok(contrast(col, '#FFFFFF') >= 3, col));
      U.SEQ.dark.slice(2).forEach(col => assert.ok(contrast(col, '#1C1C1E') >= 3, col));
    } finally { c.close(); }
  });

  test('une seule définition : ni app.js ni world.js ne gardent leur copie, et --seq1 à --seq5 reprennent PYU.SEQ', async () => {
    for (const f of ['js/app.js', 'js/world.js']) assert.doesNotMatch(src(f), /const seqColor = v => \{/, f);
    const css = src('css/app.css'); const block = css.slice(css.lastIndexOf('Logo, couleur des données'));
    const c = await boot({ now: NOW });
    try {
      const U = c.w.PYU;
      const light = block.match(/:root\{([^}]*)\}/)[1], dark = block.match(/:root\[data-theme="dark"\]\{([^}]*)\}/)[1];
      for (let i = 0; i < 5; i++) {
        assert.match(light, new RegExp('--seq' + (i + 1) + ':' + U.SEQ.light[i]));
        assert.match(dark, new RegExp('--seq' + (i + 1) + ':' + U.SEQ.dark[i]));
      }
    } finally { c.close(); }
  });

  test('isDark : data-theme l’emporte sur la préférence du système', async () => {
    const c = await boot({ now: NOW });
    try {
      const U = c.w.PYU, root = c.d.documentElement;
      root.setAttribute('data-theme', 'dark'); assert.equal(U.isDark(), true);
      root.setAttribute('data-theme', 'light'); assert.equal(U.isDark(), false);
      root.removeAttribute('data-theme'); assert.equal(typeof U.isDark(), 'boolean');
      assert.equal(U.cssVar('--inexistante', '#C7000B'), '#C7000B');
    } finally { c.close(); }
  });

  test('mur des semaines : seule la dernière colonne, la semaine en cours, est marquée', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      await enter(c, 'dash');
      const cols = [...c.$('#heatmap').querySelectorAll('.hcol')];
      assert.equal(cols.filter(x => x.classList.contains('cur')).length, 1);
      assert.ok(cols[cols.length - 1].classList.contains('cur'));
      assert.ok([...cols[cols.length - 1].querySelectorAll('i')].some(i => i.title.startsWith('2026-10-15')));
    } finally { c.close(); }
  });

  test('le monde à conduire se dessine en sombre comme en clair', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      c.d.documentElement.setAttribute('data-theme', 'dark');
      await enter(c, 'world'); await c.tick(80);
      c.d.documentElement.setAttribute('data-theme', 'light'); await c.tick(80);
      assert.deepEqual(c.errors, []);
    } finally { c.close(); }
  });
});

describe('logo', () => {
  test('img/logo.svg, favicon et en-tête partagent le même monogramme', () => {
    const svg = src('img/logo.svg'), html = src('index.html');
    const d = 'M11 24.5V7.5h6a5.25 5.25 0 0 1 0 10.5h-6';
    assert.ok(svg.includes(d)); assert.ok(html.includes(d));
    assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,[^"]*C7000B/);
    const marks = html.match(/<span class="mark" aria-hidden="true"><svg/g) || [];
    assert.equal(marks.length, 2);
  });
});
