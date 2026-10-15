// Finitions : fenêtres utilisables au clavier, touches de conduite qui ne volent pas la saisie, typographie
// française dans le texte visible, graphique hebdomadaire lisible. Chaque test échouait avant.
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, enter } = require('../helpers/dom');
const { localState } = require('../helpers/data');

const ROOT = path.resolve(__dirname, '..', '..');
const NOW = '2026-10-15T21:00:00-04:00';

describe('fenêtres', () => {
  test('saisie du soir : rôle dialog, focus à l’intérieur, Échap ferme et rend le focus au bouton', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      await enter(c, 'dash'); const ev = c.$('#evening');
      assert.equal(ev.getAttribute('role'), 'dialog'); assert.equal(ev.getAttribute('aria-modal'), 'true');
      c.$('#btnEvening').focus(); c.$('#btnEvening').click(); await c.until(() => !ev.hidden); await c.tick(10);
      assert.ok(ev.contains(c.d.activeElement), 'le focus est dans la fenêtre');
      ev.dispatchEvent(new c.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await c.tick(10); assert.equal(ev.hidden, true); assert.equal(c.d.activeElement, c.$('#btnEvening'));
    } finally { c.close(); }
  });
  test('Tab boucle dans la fenêtre au lieu de partir derrière', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      await enter(c, 'dash'); await c.w.PYF.openEvening(); await c.tick(10);
      const ev = c.$('#evening'); const last = [...ev.querySelectorAll('button')].pop(); last.focus();
      const e = new c.w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }); last.dispatchEvent(e);
      assert.equal(e.defaultPrevented, true); assert.ok(ev.contains(c.d.activeElement));
    } finally { c.close(); }
  });
});

describe('monde à conduire', () => {
  test('taper « a », « s », « d » ou « w » dans un champ n’est pas bloqué par la conduite', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      await enter(c, 'world');
      const inp = c.d.createElement('input'); c.d.body.appendChild(inp); inp.focus();
      const e = new c.w.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }); inp.dispatchEvent(e);
      assert.equal(e.defaultPrevented, false);
      const e2 = new c.w.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }); c.d.body.dispatchEvent(e2);
      assert.equal(e2.defaultPrevented, true, 'hors champ, les flèches conduisent toujours');
    } finally { c.close(); }
  });
});

describe('typographie', () => {
  test('texte visible de la page : apostrophes typographiques, pas de tiret cadratin comme ponctuation', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const text = [...html.matchAll(/>([^<>]+)</g)].map(m => m[1]).join(' ');
    assert.deepEqual(text.match(/\w'\w/g), null);
    assert.doesNotMatch(text, /→/);
  });
  test('messages des scripts : ni flèche, ni « — choisir », ni apostrophe droite dans les phrases affichées', () => {
    const js = ['app', 'features', 'savings'].map(n => fs.readFileSync(path.join(ROOT, 'js', n + '.js'), 'utf8')).join('\n');
    assert.doesNotMatch(js, /→|— choisir/);
    assert.doesNotMatch(js, /Aujourd'hui|d'environ|reçu d'essence|Frais d'administration/);
  });
});

describe('graphique net par semaine', () => {
  test('avec 14 semaines, une date sur deux sous les barres (plus de chevauchement) et objectif détaché', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState({ weeks: { nWeeks: 14 } }) });
    try {
      await enter(c, 'dash');
      const labels = [...c.$('#chWeeks svg').querySelectorAll('text')].filter(t => /^\d\d-\d\d$/.test(t.textContent));
      assert.equal(labels.length, 7); assert.equal(labels.pop().textContent, '10-05', 'la dernière barre garde sa date');
      assert.ok(c.$('#chWeeks text.goal-lab'));
    } finally { c.close(); }
  });
  test('accessibilité : statut d’import annoncé, panneau d’accueil lisible par un lecteur d’écran', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.match(html, /id="pdfStatus"[^>]*aria-live="polite"/);
    assert.doesNotMatch(html, /class="sign" role="img"/);
  });
});
