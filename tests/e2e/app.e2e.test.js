/**
 * End-to-end tests for the Ballistics Visualizer frontend.
 *
 * Run with: npm run test:e2e
 *
 * Tests run against the Vite dev server (no Spring Boot required).
 * The app falls back to client-side compute when /api/* endpoints are
 * unreachable, so all tests exercise the full frontend code path.
 */

const BASE_URL = 'http://localhost:5173';

/** Navigate to the app and wait for the bullet list to render. */
async function loadApp() {
  await page.goto(BASE_URL);
  // .bullet-card elements appear after init() completes (sync after failed fetch)
  await page.waitForSelector('.bullet-card', { timeout: 10000 });
}

// ── Page load ──────────────────────────────────────────────────────────────────

describe('page load', () => {
  beforeEach(loadApp);

  test('has correct title', async () => {
    expect(await page.title()).toBe('Ballistics Visualizer');
  });

  test('shows offline indicator when API is unreachable', async () => {
    // /api/bullets returns 404 from Vite → init falls back to mock data
    await page.waitForSelector('.status-offline', { timeout: 5000 });
    const text = await page.$eval('#statusPill', el => el.textContent.trim());
    expect(text).toContain('OFFLINE');
  });

  test('renders 10 bullet cards', async () => {
    const count = await page.$$eval('.bullet-card', cards => cards.length);
    expect(count).toBe(10);
  });

  test('all bullets are pre-selected', async () => {
    const activeCount = await page.$$eval('.bullet-card.active', cards => cards.length);
    expect(activeCount).toBe(10);
  });
});

// ── Bullet selection ───────────────────────────────────────────────────────────

describe('bullet selection', () => {
  beforeEach(loadApp);

  test('clicking an active card deselects it', async () => {
    await page.click('.bullet-card:first-of-type');
    const activeCount = await page.$$eval('.bullet-card.active', cards => cards.length);
    expect(activeCount).toBe(9);
  });

  test('clicking again re-selects the card', async () => {
    await page.click('.bullet-card:first-of-type'); // deselect
    await page.click('.bullet-card:first-of-type'); // reselect
    const activeCount = await page.$$eval('.bullet-card.active', cards => cards.length);
    expect(activeCount).toBe(10);
  });
});

// ── Simulation ─────────────────────────────────────────────────────────────────

describe('simulation', () => {
  // All 10 bullets are pre-selected; run once and share results across tests.
  beforeAll(async () => {
    await loadApp();
    await page.click('#runBtn');
    // Client-side RK4 compute — typically < 2 s for 10 bullets
    await page.waitForSelector('#resultsContainer', { visible: true, timeout: 20000 });
  });

  test('empty state is hidden after running', async () => {
    const display = await page.$eval('#emptyState', el => el.style.display);
    expect(display).toBe('none');
  });

  test('stat cards are rendered for each selected bullet', async () => {
    const count = await page.$$eval('.stat-card', cards => cards.length);
    expect(count).toBe(10);
  });

  test('data table tab shows trajectory rows', async () => {
    await page.click('#tab-data');
    await page.waitForFunction(
      () => document.getElementById('dataPanel').classList.contains('active'),
      { timeout: 5000 }
    );
    const rowCount = await page.$$eval('#tableBody tr', rows => rows.length);
    expect(rowCount).toBeGreaterThan(1);
  });

  test('switching back to charts tab restores charts panel', async () => {
    await page.click('#tab-data');
    await page.click('#tab-charts');
    const chartsActive = await page.$eval('#chartsPanel', el => el.classList.contains('active'));
    const dataInactive = await page.$eval('#dataPanel', el => !el.classList.contains('active'));
    expect(chartsActive).toBe(true);
    expect(dataInactive).toBe(true);
  });
});

// ── Custom round ───────────────────────────────────────────────────────────────

describe('custom round form', () => {
  /** Navigate and open the custom round accordion. */
  async function openForm() {
    await loadApp();
    await page.click('.custom-section summary');
    await page.waitForFunction(
      () => document.querySelector('.custom-section').open,
      { timeout: 3000 }
    );
  }

  test('validates weight > 0', async () => {
    await openForm();
    await page.$eval('#customWeight', el => { el.value = '0'; });
    await page.click('#runCustomBtn');
    await page.waitForSelector('#customError', { visible: true, timeout: 3000 });
    const msg = await page.$eval('#customError', el => el.textContent);
    expect(msg).toMatch(/weight/i);
  });

  test('validates muzzle velocity > 0', async () => {
    await openForm();
    await page.$eval('#customMV', el => { el.value = '0'; });
    await page.click('#runCustomBtn');
    await page.waitForSelector('#customError', { visible: true, timeout: 3000 });
    const msg = await page.$eval('#customError', el => el.textContent);
    expect(msg).toMatch(/velocity/i);
  });

  test('validates BC must be in (0, 1.2]', async () => {
    await openForm();
    await page.$eval('#customBC', el => { el.value = '1.5'; });
    await page.click('#runCustomBtn');
    await page.waitForSelector('#customError', { visible: true, timeout: 3000 });
    const msg = await page.$eval('#customError', el => el.textContent);
    expect(msg).toMatch(/bc/i);
  });

  test('validates diameter > 0', async () => {
    await openForm();
    await page.$eval('#customDia', el => { el.value = '0'; });
    await page.click('#runCustomBtn');
    await page.waitForSelector('#customError', { visible: true, timeout: 3000 });
    const msg = await page.$eval('#customError', el => el.textContent);
    expect(msg).toMatch(/diameter/i);
  });

  test('valid defaults produce a trajectory result', async () => {
    await openForm();
    // Default form values are all valid — just click run
    await page.click('#runCustomBtn');
    await page.waitForSelector('#resultsContainer', { visible: true, timeout: 20000 });
    const count = await page.$$eval('.stat-card', cards => cards.length);
    expect(count).toBeGreaterThan(0);
  });
});

// ── CSV export ─────────────────────────────────────────────────────────────────

describe('CSV export', () => {
  test('export button triggers a download after simulation', async () => {
    await loadApp();
    // Run to produce lastResults
    await page.click('#runBtn');
    await page.waitForSelector('#resultsContainer', { visible: true, timeout: 20000 });

    // Intercept the anchor click that triggers the download
    const downloadTriggered = await page.evaluate(() => {
      return new Promise(resolve => {
        const orig = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function() {
          HTMLAnchorElement.prototype.click = orig;
          resolve(this.download.endsWith('.csv') && this.href.startsWith('blob:'));
        };
        document.querySelector('.export-csv-btn').click();
      });
    });

    expect(downloadTriggered).toBe(true);
  });
});
