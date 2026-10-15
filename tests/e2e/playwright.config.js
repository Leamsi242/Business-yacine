// Tests de bout en bout dans Chromium : ordinateur et téléphone, heure du Québec, GPS simulé.
// Variables utiles : PY_OFFLINE=1 (bloque les CDN, sert pdf.js depuis PY_PDFJS_DIR), PY_BASE_URL (site déployé).
'use strict';
const { defineConfig, devices } = require('@playwright/test');
const path = require('node:path');

const PORT = 8787;
const BASE = process.env.PY_BASE_URL || 'http://localhost:' + PORT + '/';

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.js/,
  outputDir: path.join(__dirname, '.out'),
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: path.join(__dirname, '.out', 'report') }]] : 'list',
  use: {
    baseURL: BASE,
    locale: 'fr-CA',
    timezoneId: 'America/Toronto',
    geolocation: { latitude: 45.885, longitude: -72.49 },
    permissions: ['geolocation'],
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'ordinateur', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'telephone', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' }, testIgnore: /import\.spec\.js/ }
  ],
  webServer: process.env.PY_BASE_URL ? undefined : { command: 'node ' + path.join(__dirname, 'serve.js') + ' ' + PORT, url: BASE, reuseExistingServer: true, timeout: 20000 }
});
