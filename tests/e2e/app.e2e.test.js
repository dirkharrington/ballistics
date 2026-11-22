/**
 * End-to-end smoke tests for the Ballistics Visualizer production bundle (dist/).
 *
 * Run with: npm run build && npm run test:e2e
 *
 * jest-puppeteer starts `vite preview` serving the built dist/ output at
 * http://127.0.0.1:4173/ballistics/.
 */

const BASE_URL = 'http://127.0.0.1:4173/ballistics/';

const pageErrors = [];
const consoleErrors = [];

beforeAll(async () => {
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
});

afterEach(() => {
  const capturedPageErrors = [...pageErrors];
  const capturedConsoleErrors = [...consoleErrors];
  pageErrors.length = 0;
  consoleErrors.length = 0;
  expect(capturedPageErrors).toEqual([]);
  expect(capturedConsoleErrors).toEqual([]);
});

/** Navigate to the app on a clean first-visit state and wait for bullet cards. */
async function loadApp(clean = true) {
  if (clean) {
    if (!page.url().startsWith(BASE_URL)) {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    }
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  }
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.waitForSelector('.bullet-card', { timeout: 10000 });
}

/** Wait until #resultsContainer is visible with >= minStats cards and 5 rendered Chart.js canvases. */
async function waitForResults(minStats = 1) {
  await page.waitForFunction(
    (min) => {
      const rc = document.getElementById('resultsContainer');
      if (!rc || getComputedStyle(rc).display === 'none') return false;
      const stats = document.querySelectorAll('.stat-card');
      if (stats.length < min) return false;
      const canvases = Array.from(document.querySelectorAll('#chartContainer canvas'));
      return canvases.length === 5 && canvases.every(c => c.width > 0 && c.height > 0);
    },
    { timeout: 20000 },
    minStats,
  );
}

// ── Boot, catalog & Web Worker initial simulation ─────────────────────────────

describe('boot, catalog & initial simulation', () => {
  test('renders 37 bullet cards, activates first card on first visit, and renders 5 charts via Web Worker', async () => {
    await loadApp();

    expect(await page.title()).toBe('Ballistics Visualizer');

    const cardCount = await page.$$eval('.bullet-card', cards => cards.length);
    expect(cardCount).toBe(37);

    const activeCount = await page.$$eval('.bullet-card.active', cards => cards.length);
    expect(activeCount).toBe(1);

    const firstActive = await page.$eval('.bullet-card:first-of-type', el => el.classList.contains('active'));
    expect(firstActive).toBe(true);

    await waitForResults(1);

    const display = await page.$eval('#resultsContainer', el => getComputedStyle(el).display);
    expect(display).not.toBe('none');

    const statCount = await page.$$eval('.stat-card', cards => cards.length);
    expect(statCount).toBeGreaterThanOrEqual(1);

    const canvasSizes = await page.$$eval('#chartContainer canvas', canvases =>
      canvases.map(c => ({ id: c.id, width: c.width, height: c.height })),
    );
    expect(canvasSizes).toHaveLength(5);
    for (const c of canvasSizes) {
      expect(c.width).toBeGreaterThan(0);
      expect(c.height).toBeGreaterThan(0);
    }
  });
});

// ── Bullet selection, data table, tools & exports ─────────────────────────────

describe('bullet selection, lazy tabs & exports', () => {
  beforeAll(async () => {
    await loadApp();
  });

  test('toggling second bullet card updates selection and recomputes 2 stat cards', async () => {
    const secondInitiallyActive = await page.$eval(
      '.bullet-card:nth-of-type(2)',
      el => el.classList.contains('active'),
    );
    expect(secondInitiallyActive).toBe(false);

    await page.click('.bullet-card:nth-of-type(2)');
    const activeAfterSelect = await page.$$eval('.bullet-card.active', cards => cards.length);
    expect(activeAfterSelect).toBe(2);

    // Verify toggle off and back on works cleanly without #selectAllBullets
    await page.click('.bullet-card:nth-of-type(2)');
    expect(await page.$$eval('.bullet-card.active', cards => cards.length)).toBe(1);
    await page.click('.bullet-card:nth-of-type(2)');
    expect(await page.$$eval('.bullet-card.active', cards => cards.length)).toBe(2);

    await waitForResults(2);

    const statCount = await page.$$eval('.stat-card', cards => cards.length);
    expect(statCount).toBe(2);
  });

  test('switching to Data Table lazily populates rows and sorts by range', async () => {
    await page.click('#tab-data');
    await page.waitForFunction(
      () => document.getElementById('dataPanel')?.classList.contains('active')
        && document.querySelectorAll('#tableBody tr').length > 5,
      { timeout: 10000 },
    );

    const rowCount = await page.$$eval('#tableBody tr', rows => rows.length);
    expect(rowCount).toBeGreaterThan(5);

    await page.click('th[data-sort-key="range"] button');
    const ascSort = await page.$eval('th[data-sort-key="range"]', el => el.getAttribute('aria-sort'));
    expect(ascSort).toBe('ascending');

    await page.click('th[data-sort-key="range"] button');
    const descSort = await page.$eval('th[data-sort-key="range"]', el => el.getAttribute('aria-sort'));
    expect(descSort).toBe('descending');

    const { firstRange, lastRange } = await page.evaluate(() => {
      const rows = document.querySelectorAll('#tableBody tr');
      const firstCell = rows[0]?.querySelectorAll('td')[1]?.textContent ?? '0';
      const lastCell = rows[rows.length - 1]?.querySelectorAll('td')[1]?.textContent ?? '0';
      return {
        firstRange: parseFloat(firstCell),
        lastRange: parseFloat(lastCell),
      };
    });
    expect(firstRange).toBeGreaterThan(lastRange);
  });

  test('switching to Tools tab lazily loads tools.js, populates DOPE table, and calculates MOA/MRAD', async () => {
    await page.click('#tab-tools');
    await page.waitForFunction(
      () => document.getElementById('toolsPanel')?.classList.contains('active')
        && document.querySelectorAll('#dopeTable tbody tr').length > 0,
      { timeout: 10000 },
    );

    const dopeRows = await page.$$eval('#dopeTable tbody tr', rows => rows.length);
    expect(dopeRows).toBeGreaterThan(0);

    await page.$eval('#toolDrop', el => { el.value = '-100'; });
    await page.$eval('#toolRange', el => { el.value = '500'; });
    await page.click('#toolCalcBtn');

    await page.waitForFunction(
      () => {
        const res = document.getElementById('toolResults');
        return res && res.textContent.includes('MOA') && res.textContent.includes('MRAD');
      },
      { timeout: 5000 },
    );

    const toolText = await page.$eval('#toolResults', el => el.textContent);
    expect(toolText).toContain('MOA');
    expect(toolText).toContain('MRAD');
  });

  test('exporting CSV and PNG triggers blob/data downloads without CSP errors', async () => {
    await page.click('#tab-charts');
    await page.waitForFunction(
      () => document.getElementById('chartsPanel')?.classList.contains('active'),
      { timeout: 5000 },
    );

    const csvDownload = await page.evaluate(() => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('CSV download timed out')), 10000);
        const orig = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
          HTMLAnchorElement.prototype.click = orig;
          clearTimeout(timer);
          resolve({ download: this.download, href: this.href });
        };
        document.getElementById('exportCsvBtn').click();
      });
    });
    expect(csvDownload.download.endsWith('.csv')).toBe(true);
    expect(csvDownload.href.startsWith('blob:')).toBe(true);

    const pngDownload = await page.evaluate(() => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('PNG download timed out')), 10000);
        const orig = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
          HTMLAnchorElement.prototype.click = orig;
          clearTimeout(timer);
          resolve({ download: this.download, href: this.href });
        };
        document.querySelector('.export-btn[data-chart-id="dropChart"]').click();
      });
    });
    expect(pngDownload.download).toBe('dropChart.png');
    expect(pngDownload.href.startsWith('data:image/png')).toBe(true);
  });
});

// ── Custom bullet catalog ─────────────────────────────────────────────────────

describe('custom bullet catalog', () => {
  test('validates required inputs, saves a custom bullet, selects it, and renders charts via Web Worker', async () => {
    await loadApp();

    await page.$eval('#addCustomBulletBtn', el => el.scrollIntoView({ block: 'center' }));
    await page.click('#addCustomBulletBtn');
    await page.waitForSelector('#customBulletForm:not([hidden])', { timeout: 3000 });

    // Submit empty form to confirm validation error rendering
    await page.$eval('#customBulletSaveBtn', el => el.scrollIntoView({ block: 'center' }));
    await page.click('#customBulletSaveBtn');
    const nameErr = await page.$eval('#cbName-error', el => el.textContent);
    expect(nameErr).toMatch(/required/i);

    // Fill valid custom bullet inputs and save
    await page.type('#cbName', 'E2E 175gr SMK');
    await page.type('#cbShortName', 'E2E175');
    await page.type('#cbBulletWeightGrains', '175');
    await page.type('#cbBcG1', '0.505');
    await page.type('#cbBulletDiameterInches', '0.308');
    await page.type('#cbMuzzleVelocityFps', '2650');

    await page.$eval('#customBulletSaveBtn', el => el.scrollIntoView({ block: 'center' }));
    await page.click('#customBulletSaveBtn');
    await page.waitForSelector('#customBulletForm[hidden]', { timeout: 3000 });
    await page.waitForSelector('.bullet-card--custom', { timeout: 3000 });

    // Activate custom bullet card and compute trajectories
    await page.$eval('.bullet-card--custom', el => el.scrollIntoView({ block: 'center' }));
    await page.click('.bullet-card--custom');
    await page.waitForFunction(
      () => document.querySelector('.bullet-card--custom')?.classList.contains('active'),
      { timeout: 3000 },
    );

    await waitForResults(2);

    const statsText = await page.$eval('.stats-grid', el => el.textContent);
    expect(statsText).toContain('E2E 175gr SMK');
  });
});
