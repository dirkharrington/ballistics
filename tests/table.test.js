const {
  SORTABLE_COLUMNS, TABLE_CHUNK_THRESHOLD, TABLE_CHUNK_SIZE, computeAdjustments,
  renderTable, onSortHeaderClick, updateSortIndicators, _getSortState,
  _cancelTableChunkRaf, setTablePendingResults, flushTableIfDirty,
  clearTableDirty, getTableResults, _resetTableState,
} = require('../app/table.js');

function buildTableDOM() {
  document.body.innerHTML = `
    <table id="dataTable">
      <thead>
        <tr>
          <th>Round</th>
          <th data-sort-key="range"><button class="sort-btn" type="button">Range (<span data-unit-kind="range">m</span>)<span class="sort-indicator"></span></button></th>
          <th data-sort-key="drop"><button class="sort-btn" type="button">Drop (<span data-unit-kind="drop">cm</span>)<span class="sort-indicator"></span></button></th>
          <th data-sort-key="velocity"><button class="sort-btn" type="button">Vel (<span data-unit-kind="velocity">m/s</span>)<span class="sort-indicator"></span></button></th>
          <th data-sort-key="energy"><button class="sort-btn" type="button">Energy (<span data-unit-kind="energy">J</span>)<span class="sort-indicator"></span></button></th>
          <th data-sort-key="windDrift"><button class="sort-btn" type="button">Wind (<span data-unit-kind="drift">cm</span>)<span class="sort-indicator"></span></button></th>
          <th data-sort-key="time"><button class="sort-btn" type="button">Time<span class="sort-indicator"></span></button></th>
          <th data-sort-key="moa"><button class="sort-btn" type="button">MOA<span class="sort-indicator"></span></button></th>
          <th data-sort-key="mrad"><button class="sort-btn" type="button">MRAD<span class="sort-indicator"></span></button></th>
          <th id="spinDriftColHeader" style="display:none">Spin Drift (<span data-unit-kind="drift">cm</span>)</th>
          <th id="coriolisColHeader" style="display:none">Coriolis (<span data-unit-kind="drift">cm</span>)</th>
        </tr>
      </thead>
      <tbody id="tableBody"></tbody>
    </table>
  `;
}

function makeResults() {
  return [{
    bullet: { id: '308-win-168gr', name: '.308 Win <tag>' },
    points: [
      { rangeMeters: 200, dropCm: -20, velocityMps: 700, energyJoules: 2600, windDriftCm: 5.5, timeOfFlightSec: 0.28 },
      { rangeMeters: 100, dropCm: 3.5, velocityMps: 760, energyJoules: 3100, windDriftCm: -2.1, timeOfFlightSec: 0.13 },
    ],
  }];
}

beforeEach(() => {
  jest.useFakeTimers();
  buildTableDOM();
  _resetTableState();
});

afterEach(() => {
  _resetTableState();
  jest.useRealTimers();
});

describe('table constants and computeAdjustments', () => {
  test('exports expected chunk constants and all 8 SORTABLE_COLUMNS accessors', () => {
    expect(TABLE_CHUNK_THRESHOLD).toBe(500);
    expect(TABLE_CHUNK_SIZE).toBe(250);
    const p = { rangeMeters: 100, dropCm: -10, velocityMps: 750, energyJoules: 3000, windDriftCm: 2, timeOfFlightSec: 0.13 };
    const adj = computeAdjustments(p.dropCm, p.rangeMeters);
    expect(SORTABLE_COLUMNS.range(p, adj)).toBe(100);
    expect(SORTABLE_COLUMNS.drop(p, adj)).toBe(-10);
    expect(SORTABLE_COLUMNS.velocity(p, adj)).toBe(750);
    expect(SORTABLE_COLUMNS.energy(p, adj)).toBe(3000);
    expect(SORTABLE_COLUMNS.windDrift(p, adj)).toBe(2);
    expect(SORTABLE_COLUMNS.time(p, adj)).toBe(0.13);
    expect(SORTABLE_COLUMNS.moa(p, adj)).toBe(adj.moa);
    expect(SORTABLE_COLUMNS.mrad(p, adj)).toBe(adj.mrad);
  });
});

describe('renderTable, sorting, and optional columns', () => {
  test('renders escaped names, signs, fallback colors, and hides spin/coriolis when absent', () => {
    const res = makeResults();
    res[0].bullet.id = 'unknown-bullet';
    renderTable(res);
    const html = document.getElementById('tableBody').innerHTML;
    expect(html).toContain('&lt;tag&gt;');
    expect(html).toContain('#4ADE80');
    expect(html).toContain('+3.5 cm');
    expect(html).toContain('-20 cm');
    expect(html).toContain('+5.5 cm');
    expect(html).toContain('-2.1 cm');
    expect(document.getElementById('spinDriftColHeader').style.display).toBe('none');
    expect(document.getElementById('coriolisColHeader').style.display).toBe('none');
  });

  test('renders spinDrift and coriolis columns when present (including missing optional point props)', () => {
    renderTable([{
      bullet: { id: '308-win-168gr', name: '.308' },
      points: [
        { rangeMeters: 0, dropCm: 0, velocityMps: 800, energyJoules: 3500, windDriftCm: 0, timeOfFlightSec: 0, spinDriftCm: 0, coriolisDeflectionCm: -1.5 },
        { rangeMeters: 100, dropCm: -5, velocityMps: 750, energyJoules: 3100, windDriftCm: 1, timeOfFlightSec: 0.13, spinDriftCm: 2.3, coriolisDeflectionCm: 1.4 },
        { rangeMeters: 200, dropCm: -15, velocityMps: 700, energyJoules: 2700, windDriftCm: 3, timeOfFlightSec: 0.27 },
      ],
    }]);
    expect(document.getElementById('spinDriftColHeader').style.display).toBe('');
    expect(document.getElementById('coriolisColHeader').style.display).toBe('');
    const rows = document.querySelectorAll('#tableBody tr');
    expect(rows[0].textContent).toContain('-1.5 cm');
    expect(rows[1].textContent).toContain('2.3 cm');
    expect(rows[1].textContent).toContain('+1.4 cm');
    expect(rows[2].textContent).toContain('0.0 cm');
  });

  test('onSortHeaderClick toggles direction, switches columns, and sorts finite/NaN values', () => {
    // No-op when tableResults is null or key unknown
    onSortHeaderClick('range');
    expect(_getSortState()).toEqual({ column: null, direction: 'asc' });

    const res = [{
      bullet: { id: '308-win-168gr', name: '.308' },
      points: [
        { rangeMeters: NaN, dropCm: 0, velocityMps: 800, energyJoules: 3500, windDriftCm: 0, timeOfFlightSec: 0 },
        { rangeMeters: 200, dropCm: -20, velocityMps: 700, energyJoules: 2600, windDriftCm: 5, timeOfFlightSec: 0.28 },
        { rangeMeters: 100, dropCm: -5, velocityMps: 750, energyJoules: 3000, windDriftCm: 2, timeOfFlightSec: 0.13 },
        { rangeMeters: Infinity, dropCm: 0, velocityMps: 600, energyJoules: 2000, windDriftCm: 0, timeOfFlightSec: 0 },
      ],
    }];
    renderTable(res);
    onSortHeaderClick('unknownKey');
    expect(_getSortState().column).toBeNull();

    onSortHeaderClick('range');
    expect(_getSortState()).toEqual({ column: 'range', direction: 'asc' });
    let ranges = [...document.querySelectorAll('#tableBody tr td:nth-child(2)')].map(td => td.textContent);
    expect(ranges.slice(0, 2)).toEqual(['100', '200']);
    const rangeTh = document.querySelector('th[data-sort-key="range"]');
    expect(rangeTh.getAttribute('aria-sort')).toBe('ascending');
    expect(rangeTh.querySelector('.sort-indicator').textContent).toBe('▲');

    onSortHeaderClick('range');
    expect(_getSortState()).toEqual({ column: 'range', direction: 'desc' });
    ranges = [...document.querySelectorAll('#tableBody tr td:nth-child(2)')].map(td => td.textContent);
    expect(ranges.slice(0, 2)).toEqual(['200', '100']);
    expect(rangeTh.getAttribute('aria-sort')).toBe('descending');
    expect(rangeTh.querySelector('.sort-indicator').textContent).toBe('▼');

    onSortHeaderClick('drop');
    expect(_getSortState()).toEqual({ column: 'drop', direction: 'asc' });
    expect(rangeTh.hasAttribute('aria-sort')).toBe(false);
    expect(rangeTh.querySelector('.sort-indicator').textContent).toBe('');
  });
});

describe('chunked rendering and deferred tab state helpers', () => {
  test('renders large tables in chunks via rAF and cancels pending rAF cleanly', () => {
    const points = Array.from({ length: 650 }, (_, i) => ({
      rangeMeters: i * 10,
      dropCm: -i,
      velocityMps: 800,
      energyJoules: 3000,
      windDriftCm: 0,
      timeOfFlightSec: i * 0.01,
    }));
    renderTable([{ bullet: { id: '308-win-168gr', name: '.308' }, points }]);
    expect(document.querySelectorAll('#tableBody tr')).toHaveLength(250);

    jest.runAllTimers();
    expect(document.querySelectorAll('#tableBody tr')).toHaveLength(650);

    // Trigger again and cancel before flush
    renderTable([{ bullet: { id: '308-win-168gr', name: '.308' }, points }]);
    expect(document.querySelectorAll('#tableBody tr')).toHaveLength(250);
    _cancelTableChunkRaf();
    jest.runAllTimers();
    expect(document.querySelectorAll('#tableBody tr')).toHaveLength(250);
  });

  test('setTablePendingResults / flushTableIfDirty / clearTableDirty / getTableResults manage deferred render state', () => {
    expect(flushTableIfDirty()).toBe(false);
    const res = makeResults();
    setTablePendingResults(res);
    expect(getTableResults()).toBe(res);
    expect(flushTableIfDirty()).toBe(true);
    expect(document.querySelectorAll('#tableBody tr')).toHaveLength(2);
    expect(flushTableIfDirty()).toBe(false);

    setTablePendingResults(res);
    clearTableDirty();
    expect(flushTableIfDirty()).toBe(false);

    updateSortIndicators();
  });

  test('ENH-3: renderTable in imperial updates headers and formats yd/in/fps/ft·lb cells', () => {
    const res = makeResults();
    renderTable(res, 'imperial');
    expect(document.querySelector('[data-sort-key="range"] [data-unit-kind]').textContent).toBe('yd');
    expect(document.querySelector('[data-sort-key="drop"] [data-unit-kind]').textContent).toBe('in');
    expect(document.querySelector('[data-sort-key="velocity"] [data-unit-kind]').textContent).toBe('fps');
    expect(document.querySelector('[data-sort-key="energy"] [data-unit-kind]').textContent).toBe('ft·lb');
    const html = document.getElementById('tableBody').innerHTML;
    expect(html).toContain('219');
    expect(html).toContain('-7.9 in');
    expect(html).toContain('+2.2 in');
    onSortHeaderClick('range');
    expect(document.querySelector('[data-sort-key="range"] [data-unit-kind]').textContent).toBe('yd');
  });
});
