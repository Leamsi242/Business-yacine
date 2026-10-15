// Parcours de fumée dans un vrai Chromium : accueil, brief du matin, shift avec GPS, saisie du soir,
// persistance après rechargement, navigation ordinateur et téléphone, cibles tactiles.
'use strict';
const { test, expect, enter } = require('./fixtures');

const setRange = (page, sel, v) => page.locator(sel).evaluate((e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, v);

test.describe('accueil', () => {
  test('la page charge sans erreur JavaScript et présente les cinq meilleures destinations', async ({ page, errors }) => {
    await page.goto('./');
    await expect(page).toHaveTitle(/Pilote Yacine/);
    await expect(page.locator('#landing')).toBeVisible();
    await expect(page.locator('#login')).toBeHidden();
    await expect(page.locator('#signDest li')).toHaveCount(5);
    await expect(page.locator('#signDest li').first()).toContainText('$');
    expect(errors).toEqual([]);
  });
  test('la touche Entrée mène au monde, le bouton Explorer au tableau de bord', async ({ page, isMobile }) => {
    test.skip(isMobile, 'clavier');
    await page.goto('./'); await page.keyboard.press('Enter');
    await expect(page.locator('#v-world')).toBeVisible();
    await page.locator('#briefSkip').click();
    await expect(page.locator('#world')).toBeVisible();
  });
});

test.describe('une journée complète', () => {
  test('brief du matin, shift GPS, saisie du soir, données conservées après rechargement', async ({ page, context, errors }) => {
    await page.goto('./');
    await page.locator('#btnExplore').click();
    await expect(page.locator('#brief')).toBeVisible();
    await expect(page.locator('#briefBody h2')).toHaveText('Bonjour Yacine.');
    await expect(page.locator('#briefDots i')).toHaveCount(4);
    await page.locator('#briefNext').click();
    await page.locator('[data-route="loin"]').click();
    await expect(page.locator('[data-route="loin"]')).toHaveClass(/on/);
    await page.locator('#briefNext').click();
    await setRange(page, '#bf_parcels', '200');
    await expect(page.locator('#bf_out')).toHaveText('200');
    await expect(page.locator('#bf_tiles .tile .val').first()).toHaveText(/580/);
    await page.locator('#briefNext').click();
    await expect(page.locator('#briefNext')).toHaveText('Commencer le shift');
    await page.locator('#briefNext').click();
    await expect(page.locator('#brief')).toBeHidden();
    await expect(page.locator('#toast')).toContainText('200 colis');
    await expect(page.locator('#shiftBar')).toBeVisible();
    await expect(page.locator('#shiftBar')).toContainText('0,0 km');
    // le GPS avance par pas de 30 m (sous 140 km/h même à une seconde d'écart) : le compteur suit
    const lat = 45.885; let lon = -72.49; const step = 0.03 / (111.32 * Math.cos(lat * Math.PI / 180));
    for (let i = 0; i < 8; i++) { lon += step; await context.setGeolocation({ latitude: lat, longitude: lon }); await page.waitForTimeout(250); }
    await expect(page.locator('#shiftBar')).toContainText('0,2 km');
    // saisie du soir
    await page.locator('#btnEndShift').click();
    await expect(page.locator('#evening')).toBeVisible();
    await expect(page.locator('#ev_goal')).toContainText('Objectif du matin : 200 colis');
    await expect(page.locator('#ev_parcels')).toHaveValue('200');
    await page.locator('#ev_parcels').fill('210'); await page.locator('#ev_inv').fill('600'); await page.locator('#ev_fuel').fill('70'); await page.locator('#ev_km').fill('312');
    await page.locator('#eveningForm button[type="submit"]').click();
    await expect(page.locator('#ev_result')).toContainText('Objectif atteint : 210 colis (105 %)');
    await expect(page.locator('#ev_result')).toContainText('de côté pour Ma voiture');
    await page.locator('#evClose').click();
    // persistance
    await page.reload();
    await expect(page.locator('#app')).toBeVisible();
    await page.locator('nav.tabs button[data-v="log"]').click();
    const today = await page.evaluate(() => window.PYU.today());
    await expect(page.locator('#logTable')).toContainText('210');
    const row = page.locator('#logTable tr', { hasText: '210' }).first();
    await expect(row).toContainText('saisie');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pilote-yacine-v2')).days.slice(-1)[0]);
    expect(saved).toMatchObject({ date: today, parcels: 210, invoiced: 600, km: 312, fuel: 70, source: 'saisie' });
    expect(errors).toEqual([]);
  });
});

test.describe('navigation', () => {
  test('tableau de bord : six compteurs, graphiques, mission, voiture', async ({ page }) => {
    await enter(page, 'dash');
    await expect(page.locator('#kpis .tile')).toHaveCount(6);
    await expect(page.locator('#chWeeks svg')).toBeVisible();
    await expect(page.locator('#mission')).toContainText('Travailler 4 jours');
    await expect(page.locator('#carTile .tile.car')).toContainText('Ma voiture');
  });
  test('carte : classement des zones et localisation', async ({ page }) => {
    await enter(page, 'map');
    await expect(page.locator('#rank .it').first()).toBeVisible();
    expect(await page.locator('#rank .it').count()).toBeGreaterThan(10);
    await page.locator('#btnLocate').click();
    await expect(page.locator('#toast')).toContainText(/Zone la plus proche|Position trouvée/);
  });
  test('objectifs, simulateur et conseils se rendent', async ({ page, isMobile }) => {
    await enter(page, 'goals');
    await expect(page.locator('#savings .tiles .tile')).toHaveCount(5);
    await expect(page.locator('#vanCountdown .tile')).toHaveCount(4);
    if (isMobile) await page.locator('nav.tabs .more').click();
    await page.locator('nav.tabs button[data-v="sim"]').click();
    await expect(page.locator('#simOut')).toContainText('Écart par mois');
    if (isMobile) await page.locator('nav.tabs .more').click();
    await page.locator('nav.tabs button[data-v="tips"]').click();
    expect(await page.locator('#advice .a').count()).toBeGreaterThan(3);
  });
  test('téléphone : cinq onglets + Plus, cibles de 44 px, pas de défilement horizontal', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'téléphone seulement');
    await enter(page, 'dash');
    const visible = page.locator('nav.tabs > button:visible');
    await expect(visible).toHaveCount(6); // 5 sections + Plus
    for (const b of await visible.all()) { const box = await b.boundingBox(); expect(box.height, 'hauteur onglet').toBeGreaterThanOrEqual(44); }
    for (const v of ['dash', 'map', 'log', 'goals']) {
      await page.locator(`nav.tabs button[data-v="${v}"]`).click();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, 'débordement horizontal sur ' + v).toBeLessThanOrEqual(0);
    }
    for (const sel of ['#btnBrief', '#btnEvening', '#v-goals button.btn']) { const box = await page.locator(sel).first().boundingBox(); expect(box.height, sel).toBeGreaterThanOrEqual(44); }
  });
});
