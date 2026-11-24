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

// ── Drag model switching & MODEL pill immediacy (TEST-1) ──────────────────────

describe('drag model switching', () => {
  beforeAll(async () => {
    await loadApp();
    await waitForResults(1);
  });

  test('MODEL pill updates immediately when #dragModel changes to G7, G5, and back to G1', async () => {
    // Switch to G7 — pill must reflect the change before simulation completes
    await page.select('#dragModel', 'G7');
    await page.waitForFunction(
      () => document.getElementById('modelStatus').textContent === 'MODEL: G7',
      { timeout: 2000 },
    );
    const pillG7 = await page.$eval('#modelStatus', el => el.textContent);
    expect(pillG7).toBe('MODEL: G7');

    // Switch to G5
    await page.select('#dragModel', 'G5');
    await page.waitForFunction(
      () => document.getElementById('modelStatus').textContent === 'MODEL: G5',
      { timeout: 2000 },
    );
    const pillG5 = await page.$eval('#modelStatus', el => el.textContent);
    expect(pillG5).toBe('MODEL: G5');

    // Switch back to G1 and wait for charts to finish
    await page.select('#dragModel', 'G1');
    await page.waitForFunction(
      () => document.getElementById('modelStatus').textContent === 'MODEL: G1',
      { timeout: 2000 },
    );
    const pillG1 = await page.$eval('#modelStatus', el => el.textContent);
    expect(pillG1).toBe('MODEL: G1');
    await waitForResults(1);
  });
});

// ── Sweep mode full workflow (TEST-2) ─────────────────────────────────────────

describe('sweep mode', () => {
  test('sweep mode: select wind param, run sweep, verify sweep charts appear, then clear', async () => {
    await loadApp();
    await waitForResults(1);

    // sweepControls appears once a bullet is selected (auto-happens on first load)
    await page.waitForFunction(
      () => {
        const sc = document.getElementById('sweepControls');
        return sc && sc.style.display !== 'none';
      },
      { timeout: 5000 },
    );

    // Select wind sweep parameter
    await page.select('#sweepParam', 'wind');

    // Click SWEEP and wait for clearSweepBtn to become visible (indicates sweep completed)
    await page.click('#sweepBtn');
    await page.waitForFunction(
      () => document.getElementById('clearSweepBtn')?.style.display !== 'none',
      { timeout: 20000 },
    );

    // Verify 3 sweep chart canvases appeared
    const sweepCanvasIds = await page.$$eval('#chartContainer canvas', canvases =>
      canvases.map(c => c.id).filter(id => id.startsWith('sweep')),
    );
    expect(sweepCanvasIds).toHaveLength(3);
    expect(sweepCanvasIds).toContain('sweepDropChart');
    expect(sweepCanvasIds).toContain('sweepWindChart');
    expect(sweepCanvasIds).toContain('sweepVelChart');

    // Clear sweep — sweep canvases should be removed from DOM
    await page.click('#clearSweepBtn');
    await page.waitForFunction(
      () => document.querySelectorAll('#chartContainer canvas[id^="sweep"]').length === 0,
      { timeout: 5000 },
    );

    const sweepCanvasesAfterClear = await page.$$eval(
      '#chartContainer canvas[id^="sweep"]',
      canvases => canvases.length,
    );
    expect(sweepCanvasesAfterClear).toBe(0);
  });
});

// ── URL state persistence (TEST-3) ───────────────────────────────────────────

describe('URL state persistence', () => {
  test('param changes are encoded in the URL and restored on reload', async () => {
    await loadApp();
    await waitForResults(1);

    // Change zeroRange to a distinctive non-default value via input event
    await page.$eval('#zeroRange', (el) => {
      el.value = '200';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.$eval('#maxRange', (el) => {
      el.value = '800';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Wait for the debouncer to flush and URL to update
    await page.waitForFunction(
      () => window.location.search.includes('zero=200'),
      { timeout: 5000 },
    );

    const href = await page.evaluate(() => window.location.href);
    expect(href).toContain('zero=200');
    expect(href).toContain('maxRange=800');

    // Reload to the same URL — params must be restored
    await page.goto(href, { waitUntil: 'load' });
    await page.waitForSelector('.bullet-card', { timeout: 10000 });

    const restoredZero = await page.$eval('#zeroRange', el => el.value);
    const restoredMax = await page.$eval('#maxRange', el => el.value);
    expect(restoredZero).toBe('200');
    expect(restoredMax).toBe('800');
  });
});

// ── Profile save / load / delete (TEST-4) ────────────────────────────────────

describe('profile save / load / delete', () => {
  test('saves a profile, restores params on load, and deletes it cleanly', async () => {
    await loadApp();
    await waitForResults(1);

    // Set a distinctive non-default zero range value
    await page.$eval('#zeroRange', (el) => {
      el.value = '150';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Type profile name and save
    await page.click('#profileNameInput', { clickCount: 3 });
    await page.type('#profileNameInput', 'E2E Profile');
    await page.click('#saveProfileBtn');

    // Verify profile appears in the select
    await page.waitForFunction(
      () => Array.from(document.getElementById('profileSelect').options)
        .some(o => o.text === 'E2E Profile'),
      { timeout: 5000 },
    );

    // Reset zero range to default
    await page.$eval('#zeroRange', (el) => {
      el.value = '100';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(await page.$eval('#zeroRange', el => el.value)).toBe('100');

    // Load saved profile
    await page.select('#profileSelect', 'E2E Profile');
    await page.waitForFunction(
      () => document.getElementById('zeroRange').value === '150',
      { timeout: 5000 },
    );
    expect(await page.$eval('#zeroRange', el => el.value)).toBe('150');

    // Delete the profile
    await page.click('#deleteProfileBtn');
    await page.waitForFunction(
      () => !Array.from(document.getElementById('profileSelect').options)
        .some(o => o.text === 'E2E Profile'),
      { timeout: 5000 },
    );
    const profileOptions = await page.$$eval('#profileSelect option', opts =>
      opts.map(o => o.text),
    );
    expect(profileOptions).not.toContain('E2E Profile');
  });
});

// ── Unit system toggle (TEST-5) ───────────────────────────────────────────────

describe('unit system toggle', () => {
  beforeAll(async () => {
    await loadApp();
    await waitForResults(1);
  });

  test('toggles between METRIC and IMPERIAL, updating the toggle label and unit labels', async () => {
    // Initial state: METRIC
    const initialLabel = await page.$eval('#unitToggle', el => el.textContent.trim());
    expect(initialLabel).toBe('METRIC');

    const metricRangeUnit = await page.$eval(
      'label[for="zeroRange"] [data-unit-kind="range"]',
      el => el.textContent,
    );
    expect(metricRangeUnit).toBe('m');

    // Switch to imperial
    await page.click('#unitToggle');
    await page.waitForFunction(
      () => document.getElementById('unitToggle').getAttribute('aria-pressed') === 'true',
      { timeout: 3000 },
    );

    const imperialLabel = await page.$eval('#unitToggle', el => el.textContent.trim());
    expect(imperialLabel).toBe('IMPERIAL');

    const imperialRangeUnit = await page.$eval(
      'label[for="zeroRange"] [data-unit-kind="range"]',
      el => el.textContent,
    );
    expect(imperialRangeUnit).toBe('yd');

    // Switch back to metric
    await page.click('#unitToggle');
    await page.waitForFunction(
      () => document.getElementById('unitToggle').getAttribute('aria-pressed') === 'false',
      { timeout: 3000 },
    );

    const revertedLabel = await page.$eval('#unitToggle', el => el.textContent.trim());
    expect(revertedLabel).toBe('METRIC');

    const revertedRangeUnit = await page.$eval(
      'label[for="zeroRange"] [data-unit-kind="range"]',
      el => el.textContent,
    );
    expect(revertedRangeUnit).toBe('m');
  });
});

// ── Multi-bullet comparison (TEST-6) ─────────────────────────────────────────

describe('multi-bullet comparison', () => {
  test('selecting a third bullet card shows 2 stat cards; deselecting reverts to 1', async () => {
    await loadApp();
    await waitForResults(1);

    // The first card is active from loadApp. Activate the third card.
    const thirdActive = await page.$eval(
      '.bullet-card:nth-of-type(3)',
      el => el.classList.contains('active'),
    );
    expect(thirdActive).toBe(false);

    await page.click('.bullet-card:nth-of-type(3)');
    await waitForResults(2);

    const statCount = await page.$$eval('.stat-card', cards => cards.length);
    expect(statCount).toBe(2);

    // Both active bullet names appear in the stats grid
    const [bullet1Name, bullet3Name] = await page.$$eval(
      '.bullet-card.active',
      cards => cards.map(c => c.querySelector('.bullet-name')?.textContent?.trim() ?? ''),
    );
    const statsText = await page.$eval('.stats-grid', el => el.textContent);
    expect(statsText).toContain(bullet1Name);
    expect(statsText).toContain(bullet3Name);

    // Deselect the third bullet
    await page.click('.bullet-card:nth-of-type(3)');
    await page.waitForFunction(
      () => document.querySelectorAll('.bullet-card.active').length === 1,
      { timeout: 5000 },
    );
    // Wait for the re-simulation to complete and stat cards to settle at exactly 1
    await page.waitForFunction(
      () => document.querySelectorAll('.stat-card').length === 1,
      { timeout: 10000 },
    );

    const statCountAfter = await page.$$eval('.stat-card', cards => cards.length);
    expect(statCountAfter).toBe(1);
  });
});

// ── S23-5: custom bullet, JSON export/import, theme persistence ───────────────

/** Fill and submit the custom-bullet form (the form must already be open). */
async function submitCustomBullet({ name, shortName = 'S23', weight = '175', bcG1 = '0.505', bcG7 = '0.26', diameter = '0.308', mv = '2650' }) {
  const fields = {
    '#cbName': name, '#cbShortName': shortName, '#cbBulletWeightGrains': weight,
    '#cbBcG1': bcG1, '#cbBcG7': bcG7, '#cbBulletDiameterInches': diameter, '#cbMuzzleVelocityFps': mv,
  };
  for (const [sel, val] of Object.entries(fields)) {
    if (val) await page.type(sel, val);
  }
  await page.$eval('#customBulletSaveBtn', el => el.scrollIntoView({ block: 'center' }));
  await page.click('#customBulletSaveBtn');
}

async function openCustomBulletForm() {
  await page.$eval('#addCustomBulletBtn', el => el.scrollIntoView({ block: 'center' }));
  await page.click('#addCustomBulletBtn');
  await page.waitForSelector('#customBulletForm:not([hidden])', { timeout: 3000 });
}

describe('S23-5a custom bullet form', () => {
  it('S23-5a: creates a custom bullet and runs a simulation', async () => {
    await loadApp(true);
    await openCustomBulletForm();
    await submitCustomBullet({ name: 'S23 Custom 175gr' });
    await page.waitForSelector('#customBulletForm[hidden]', { timeout: 3000 });

    // Bullet appears in the list
    await page.waitForSelector('.bullet-card--custom', { timeout: 3000 });
    const names = await page.$$eval('.bullet-card--custom', cards => cards.map(c => c.textContent));
    expect(names.some(t => t.includes('S23 Custom 175gr'))).toBe(true);

    // Select it and wait for a simulation
    await page.$eval('.bullet-card--custom', el => el.scrollIntoView({ block: 'center' }));
    await page.click('.bullet-card--custom');
    await page.waitForFunction(
      () => document.querySelector('.bullet-card--custom')?.classList.contains('active'),
      { timeout: 3000 },
    );
    await waitForResults(2);

    const width = await page.$eval('#dropChart', c => c.width);
    expect(width).toBeGreaterThan(0);
    expect(await page.$eval('.stats-grid', el => el.textContent)).toContain('S23 Custom 175gr');
  });

  it('S23-5a: blocks save when name is empty', async () => {
    await loadApp(true);
    await openCustomBulletForm();
    const before = await page.$$eval('.bullet-card--custom', cards => cards.length);

    await submitCustomBullet({ name: '' });

    const err = await page.$eval('#cbName-error', el => ({
      text: el.textContent, visible: el.offsetParent !== null && getComputedStyle(el).display !== 'none',
    }));
    expect(err.text).toMatch(/required/i);
    expect(err.visible).toBe(true);
    expect(await page.$eval('#customBulletForm', el => el.hasAttribute('hidden'))).toBe(false);
    expect(await page.$$eval('.bullet-card--custom', cards => cards.length)).toBe(before);
  });
});

describe('S23-5b JSON export / import', () => {
  /** Click the JSON export button, capturing the blob link and its text. */
  async function captureJsonExport() {
    return page.evaluate(() => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('JSON export timed out')), 10000);
      const origCreate = URL.createObjectURL;
      let blob = null;
      URL.createObjectURL = function (b) { blob = b; return origCreate.call(URL, b); };
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = async function () {
        HTMLAnchorElement.prototype.click = origClick;
        URL.createObjectURL = origCreate;
        clearTimeout(timer);
        resolve({ download: this.download, href: this.href, text: blob ? await blob.text() : null });
      };
      document.querySelector('.export-json-btn').click();
    }));
  }

  it('S23-5b: JSON export produces a downloadable link', async () => {
    await loadApp(true);
    await waitForResults(1);

    const exported = await captureJsonExport();
    expect(exported.href.startsWith('blob:')).toBe(true);
    expect(exported.download).toBe('trajectory.json');
    const parsed = JSON.parse(exported.text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].points.length).toBeGreaterThan(0);
  });

  it('S23-5b: JSON import restores bullet state', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    // Create a known custom bullet, run a simulation and capture the export
    await loadApp(true);
    await openCustomBulletForm();
    await submitCustomBullet({ name: 'S23 Roundtrip 168gr', shortName: 'RT168', weight: '168', mv: '2600' });
    await page.waitForSelector('.bullet-card--custom', { timeout: 3000 });
    await page.$eval('.bullet-card--custom', el => el.scrollIntoView({ block: 'center' }));
    await page.click('.bullet-card--custom');
    await waitForResults(2);
    const exported = await captureJsonExport();
    expect(exported.text).toContain('S23 Roundtrip 168gr');

    // Reset to a clean app: the custom bullet no longer exists
    await loadApp(true);
    await waitForResults(1);
    expect(await page.$eval('.stats-grid', el => el.textContent)).not.toContain('S23 Roundtrip 168gr');

    // Import the captured JSON through the file input
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's23-import-'));
    const file = path.join(dir, 'trajectory.json');
    fs.writeFileSync(file, exported.text);
    try {
      const input = await page.$('#importJsonFile');
      await input.uploadFile(file);
      await page.waitForFunction(
        () => document.querySelector('.stats-grid')?.textContent.includes('S23 Roundtrip 168gr'),
        { timeout: 10000 },
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(await page.$eval('#simulationError', el => el.hasAttribute('hidden'))).toBe(true);
  });
});

describe('S23-5c theme persistence', () => {
  it('S23-5c: theme is persisted across reload', async () => {
    await loadApp(true);
    // The theme lives on <html data-theme>, persisted in localStorage `bv_theme`
    const theme = () => page.$eval('html', el => el.getAttribute('data-theme'));
    const before = await theme();
    await page.click('#themeToggle');
    const after = await theme();
    expect(after).not.toBe(before);
    expect(await page.evaluate(() => localStorage.getItem('bv_theme'))).toBe(after);

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.bullet-card', { timeout: 10000 });
    expect(await theme()).toBe(after);
  });
});

// ── S24-3: Sprint 23 feature smoke tests ──────────────────────────────────────

/** Set an input/select value and fire input + change so the app reacts. */
async function setField(selector, value) {
  await page.$eval(selector, (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

describe('S24-3 Sprint 23 features', () => {
  it('S24-3a: MV temperature sensitivity shows an Effective MV line', async () => {
    await loadApp(true);
    await waitForResults(1);
    expect(await page.$eval('.stats-grid', el => el.textContent)).not.toContain('Effective MV');

    await setField('#temperature', '30');
    await setField('#mvSens', '1');
    await page.waitForFunction(
      () => document.querySelector('.stats-grid')?.textContent.includes('Effective MV'),
      { timeout: 15000 },
    );
    expect(await page.$eval('.stats-grid', el => el.textContent)).toContain('Effective MV');
  });

  it('S24-3b: transonic / subsonic markers appear on the stat card', async () => {
    await loadApp(true);
    await waitForResults(1);
    const text = await page.$eval('.stats-grid', el => el.textContent);
    expect(/Mach 1\.[02]/.test(text) || text.includes('Beyond max range')).toBe(true);
    expect(text).toContain('transonic');
    expect(text).toContain('subsonic');
  });

  it('S24-3c: DOPE table shows a Clicks column for the chosen click value', async () => {
    await loadApp(true);
    await waitForResults(1);
    await page.click('#tab-tools');
    await page.waitForFunction(
      () => document.getElementById('toolsPanel')?.classList.contains('active')
        && document.querySelectorAll('#dopeTable tbody tr').length > 0,
      { timeout: 10000 },
    );
    await setField('#clickValue', '0.5moa');
    await page.waitForFunction(
      () => [...document.querySelectorAll('#dopeTable th')].some(th => th.textContent.includes('Clicks')),
      { timeout: 5000 },
    );
    const headings = await page.$$eval('#dopeTable th', ths => ths.map(t => t.textContent));
    expect(headings.some(h => h.includes('Clicks'))).toBe(true);
    expect(await page.$eval('#dopeTable', el => el.parentElement.parentElement.textContent)).toMatch(/½ MOA|0\.5 MOA/i);
  });

  it('S24-3d: MV truing solves a numeric trued MV', async () => {
    await loadApp(true);
    await waitForResults(1);
    await page.click('#tab-tools');
    await page.waitForFunction(
      () => document.getElementById('toolsPanel')?.classList.contains('active'),
      { timeout: 10000 },
    );
    await page.waitForSelector('#truingCalc', { visible: true });
    await setField('#truingRange', '500');
    await setField('#truingDrop', '120');
    await page.click('#truingCalc');
    await page.waitForFunction(
      () => document.getElementById('truingResult')?.style.display !== 'none'
        || document.getElementById('truingError')?.textContent,
      { timeout: 15000 },
    );
    expect(await page.$eval('#truingError', el => el.textContent)).toBe('');
    const mvText = await page.$eval('#truingMV', el => el.textContent);
    expect(mvText).toMatch(/^\d+(\.\d+)?\s*\S+/);
    expect(Number.parseFloat(mvText)).toBeGreaterThan(0);
  });
});
