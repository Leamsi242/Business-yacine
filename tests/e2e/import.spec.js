// Import d'une vraie facture PDF : le fichier est fabriqué par Chromium à partir d'une facture synthétique
// (aucune donnée réelle), puis déposé dans le site, lu par pdf.js, importé, audité et affiché.
'use strict';
const { test, expect, enter } = require('./fixtures');
const inv = require('../helpers/invoice');

async function makePdf(context, lines) {
  const p = await context.newPage();
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  await p.setContent(`<!doctype html><html><body style="margin:0"><pre style="font:8.5px/1.35 'DejaVu Sans Mono', monospace; white-space:pre; margin:0">${lines.map(esc).join('\n')}</pre></body></html>`);
  const buf = await p.pdf({ format: 'Letter', landscape: true, margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' }, printBackground: false });
  await p.close();
  return buf;
}

test.describe('facture hebdomadaire', () => {
  test('dépôt du PDF : lecture, import, audit conforme, journal et tableau de bord à jour', async ({ page, context, errors }) => {
    const fx = inv.typicalWeek();
    const pdf = await makePdf(context, fx.lines);
    await enter(page, 'log');
    await page.locator('#pdfFile').setInputFiles({ name: 'facture-2026-41.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page.locator('#pdfStatus')).toContainText('Importé', { timeout: 45000 });
    await expect(page.locator('#pdfStatus')).toContainText('semaine 2026-41, 4 journées, 708 colis');
    await expect(page.locator('#audits')).toContainText('Semaine 2026-41');
    await expect(page.locator('#audits .pill').first()).toHaveText('Conforme');
    await expect(page.locator('#audits')).toContainText('Tarifs conformes à la grille de référence');
    const rows = page.locator('#logTable tr', { hasText: 'oct' });
    expect(await rows.count()).toBeGreaterThanOrEqual(4);
    await expect(page.locator('#logTable')).not.toContainText('saisie');
    await page.locator('nav.tabs button[data-v="dash"]').click();
    await expect(page.locator('#kpis .tile').first()).toContainText('Net ce mois-ci');
    const st = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pilote-yacine-v2')); return { inv: s.invoices.length, parcels: s.parcels.length, days: s.days.length, audit: !!s.invoices[0].audit }; });
    expect(st).toEqual({ inv: 1, parcels: 708, days: 4, audit: true });
    expect(errors).toEqual([]);
  });
  test('une facture avec baisse de tarif est signalée comme anomalie', async ({ page, context }) => {
    const ref = inv.TARIFFS['ZONE_G|2.0'];
    const fx = inv.build({ week: '2026-42', from: '2026-10-12', to: '2026-10-18', days: [{ date: '2026-10-13', parcels: Array.from({ length: 40 }, () => ({ zone: 'ZONE_G', wt: 2, amt: ref - 0.1 })) }] });
    const pdf = await makePdf(context, fx.lines);
    await enter(page, 'log');
    await page.locator('#pdfFile').setInputFiles({ name: 'facture-2026-42.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page.locator('#pdfStatus')).toContainText('Importé', { timeout: 45000 });
    await expect(page.locator('#audits')).toContainText('1 anomalie');
    await expect(page.locator('#audits')).toContainText('Grille tarifaire différente de la référence sur 40 colis (0 hausses, 1 baisses de tarif)');
  });
  test('un document qui n’est pas une facture est refusé', async ({ page, context }) => {
    const pdf = await makePdf(context, inv.creditMemoLines());
    await enter(page, 'log');
    await page.locator('#pdfFile').setInputFiles({ name: 'credit.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page.locator('#pdfStatus')).toContainText('ne ressemble pas à une facture', { timeout: 45000 });
    await expect(page.locator('#audits')).toContainText('Aucune facture importée');
  });
});
