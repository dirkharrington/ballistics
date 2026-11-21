const io = require('../app/io.js');

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function computeAdjustments(dropCm, rangeMeters) {
  if (rangeMeters === 0) return { moa: 0, mrad: 0 };
  const angleRad = Math.atan2(Math.abs(dropCm) / 100, rangeMeters);
  const sign = dropCm < 0 ? 1 : (dropCm > 0 ? -1 : 0);
  return {
    moa:  Math.round(sign * angleRad * (180 / Math.PI) * 60 * 10) / 10,
    mrad: Math.round(sign * angleRad * 1000 * 10) / 10,
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const sampleResults = [{
  bullet: {
    id: '308-win-168gr',
    name: '.308 Win 168gr BTHP',
    bulletWeightGrams: 10.89,
    muzzleVelocityMps: 807.7,
    ballisticCoefficient: 0.475,
    bulletDiameterMm: 7.82,
    muzzleEnergyJoules: 3552,
    hexColor: '#F97316',
  },
  points: [
    { rangeMeters: 0,   dropCm: 0,   velocityMps: 807, energyJoules: 3552, windDriftCm: 0,  timeOfFlightSec: 0 },
    { rangeMeters: 100, dropCm: -3.5, velocityMps: 760, energyJoules: 3100, windDriftCm: 2.1, timeOfFlightSec: 0.13 },
  ],
  supersonicLimitMeters: 820,
  maxOrdinateCm: 5.1,
  maxOrdinateRangeMeters: 55,
  densityAltitudeMeters: 0,
}];

describe('csvCell', () => {
  test('wraps value in double quotes', () => {
    expect(io.csvCell('hello')).toBe('"hello"');
  });

  test('doubles internal double quotes', () => {
    expect(io.csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  test('prefixes formula-injection triggers with apostrophe', () => {
    for (const prefix of ['=', '+', '-', '@', '\t', '\r']) {
      expect(io.csvCell(`${prefix}BAD`)).toMatch(/^"'/);
    }
  });

  test('safe strings are not prefixed', () => {
    expect(io.csvCell('.308 Win')).toBe('".308 Win"');
  });
});

describe('_downloadBlob', () => {
  let createObjectURL, revokeObjectURL, anchorClick;

  beforeEach(() => {
    createObjectURL = jest.fn(() => 'blob:mock-url');
    revokeObjectURL = jest.fn();
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL;
    anchorClick = jest.fn();
    HTMLAnchorElement.prototype.click = anchorClick;
  });

  afterEach(() => {
    delete HTMLAnchorElement.prototype.click;
  });

  test('creates an anchor with the given filename and revokes the URL after click', () => {
    const blob = new Blob(['test'], { type: 'text/plain' });
    io._downloadBlob(blob, 'test.txt');
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});

describe('CSV / JSON / Markdown / PNG exports', () => {
  let createObjectURL, revokeObjectURL, anchorClick;
  const origBlob = global.Blob;

  beforeEach(() => {
    createObjectURL = jest.fn(() => 'blob:mock-url');
    revokeObjectURL = jest.fn();
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL;
    global.Blob = jest.fn((parts, opts) => ({ parts, opts }));
    anchorClick = jest.fn();
    HTMLAnchorElement.prototype.click = anchorClick;
  });

  afterEach(() => {
    global.Blob = origBlob;
    delete HTMLAnchorElement.prototype.click;
    delete HTMLCanvasElement.prototype.toDataURL;
    document.body.innerHTML = '';
  });

  test('exportTrajectoryCSV returns early when empty and builds trajectory CSV otherwise', () => {
    io.exportTrajectoryCSV([]);
    expect(createObjectURL).not.toHaveBeenCalled();

    io.exportTrajectoryCSV(sampleResults);
    expect(global.Blob).toHaveBeenCalledWith(
      [expect.stringContaining('Distance (m),Velocity (m/s),Energy (J),Drop (m),Bullet')],
      { type: 'text/csv' },
    );
    expect(global.Blob.mock.calls[0][0][0]).toContain('100,760,3100,-0.035,".308 Win 168gr BTHP"');
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  test('exportCSV returns early when empty and includes MOA/MRAD adjustments otherwise', () => {
    io.exportCSV([], computeAdjustments);
    expect(createObjectURL).not.toHaveBeenCalled();

    io.exportCSV(sampleResults, computeAdjustments);
    const csv = global.Blob.mock.calls[0][0][0];
    expect(csv).toContain('Round,Range (m),Drop (cm),Velocity (m/s),Energy (J),Wind Drift (cm),Time (s),MOA,MRAD');
    expect(csv).toContain('".308 Win 168gr BTHP",100,-3.5,760,3100,2.1,0.13,1.2,0.3');
  });

  test('exportJSON returns early when empty and formats results JSON otherwise', () => {
    io.exportJSON([]);
    expect(createObjectURL).not.toHaveBeenCalled();

    io.exportJSON(sampleResults);
    const json = global.Blob.mock.calls[0][0][0];
    expect(JSON.parse(json)[0].bullet.id).toBe('308-win-168gr');
    expect(global.Blob.mock.calls[0][1]).toEqual({ type: 'application/json' });
  });

  test('exportMarkdown returns early when empty and escapes bullet name', () => {
    io.exportMarkdown([], { computeAdjustments, escapeHtml });
    expect(createObjectURL).not.toHaveBeenCalled();

    const evilResults = [{
      bullet: { name: '<script>alert(1)</script>' },
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 800, energyJoules: 3000, windDriftCm: 0 }],
    }];
    io.exportMarkdown(evilResults, { computeAdjustments, escapeHtml });
    const md = global.Blob.mock.calls[0][0][0];
    expect(md).toContain('## &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(md).not.toContain('<script>');
  });

  test('exportPNG skips missing canvas and downloads dataURL when canvas exists', () => {
    const toDataURL = jest.fn(() => 'data:image/png;base64,abc');
    HTMLCanvasElement.prototype.toDataURL = toDataURL;

    io.exportPNG('missing-canvas');
    expect(toDataURL).not.toHaveBeenCalled();

    const canvas = document.createElement('canvas');
    canvas.id = 'dropChart';
    document.body.appendChild(canvas);

    io.exportPNG('dropChart');
    expect(toDataURL).toHaveBeenCalledWith('image/png');
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });
});

describe('importResultsFromFile', () => {
  const origFileReader = global.FileReader;

  afterEach(() => {
    global.FileReader = origFileReader;
  });

  function mockReaderWithText(text) {
    global.FileReader = jest.fn(() => ({
      onload: null,
      onerror: null,
      readAsText() { this.onload({ target: { result: text } }); },
    }));
  }

  test('returns early when file is falsy', async () => {
    const setError = jest.fn();
    const onImported = jest.fn();
    await io.importResultsFromFile(null, { hexColorRe: HEX_COLOR_RE, setError, onImported });
    expect(setError).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
  });

  test('rejects files exceeding 5 MB', async () => {
    const setError = jest.fn();
    await io.importResultsFromFile({ size: 5 * 1024 * 1024 + 1 }, {
      hexColorRe: HEX_COLOR_RE, setError, onImported: jest.fn(),
    });
    expect(setError).toHaveBeenCalledWith('Import failed: file exceeds 5 MB limit.');
  });

  test('handles FileReader.onerror cleanly', async () => {
    global.FileReader = jest.fn(() => ({
      onload: null,
      onerror: null,
      readAsText() { this.onerror(); },
    }));
    const setError = jest.fn();
    await io.importResultsFromFile({ size: 10 }, {
      hexColorRe: HEX_COLOR_RE, setError, onImported: jest.fn(),
    });
    expect(setError).toHaveBeenCalledWith('Import failed: could not read file.');
  });

  test.each([
    ['invalid json', 'not json{', /not valid JSON/],
    ['non-array JSON', '{}', /non-empty array/],
    ['empty array JSON', '[]', /non-empty array/],
    ['> 10 results', JSON.stringify(Array(11).fill(sampleResults[0])), /more than 10/],
    ['null item', JSON.stringify([null]), /"bullet" and "points"/],
    ['primitive item', JSON.stringify(['x']), /"bullet" and "points"/],
    ['missing points', JSON.stringify([{ bullet: { id: 'a', name: 'A' } }]), /"bullet" and "points"/],
    ['non-array points', JSON.stringify([{ bullet: { id: 'a', name: 'A' }, points: {} }]), /"points" must be an array/],
    ['> 2000 points', JSON.stringify([{ bullet: { id: 'a', name: 'A' }, points: Array(2001).fill({ rangeMeters: 0 }) }]), /more than 2000/],
    ['non-object bullet', JSON.stringify([{ bullet: 'bad', points: [] }]), /bullet must be an object/],
    ['non-string bullet.id', JSON.stringify([{ bullet: { id: 1, name: 'A' }, points: [] }]), /bullet\.id/],
    ['long bullet.id', JSON.stringify([{ bullet: { id: 'x'.repeat(201), name: 'A' }, points: [] }]), /bullet\.id/],
    ['non-string bullet.name', JSON.stringify([{ bullet: { id: 'x', name: 2 }, points: [] }]), /bullet\.name/],
    ['long bullet.name', JSON.stringify([{ bullet: { id: 'x', name: 'y'.repeat(201) }, points: [] }]), /bullet\.name/],
    ['non-finite bullet numeric field', JSON.stringify([{ bullet: { id: 'x', name: 'A', muzzleVelocityMps: 'NaN' }, points: [] }]), /bullet\.muzzleVelocityMps/],
    ['non-finite bullet.ballisticCoefficientG7', JSON.stringify([{ bullet: { id: 'x', name: 'A', ballisticCoefficientG7: null }, points: [] }]), /bullet\.ballisticCoefficientG7/],
    ['non-finite result numeric field', JSON.stringify([{ bullet: { id: 'x', name: 'A' }, points: [], maxOrdinateCm: null }]), /maxOrdinateCm/],
    ['null point', JSON.stringify([{ bullet: { id: 'x', name: 'A' }, points: [null] }]), /each point must be an object/],
    ['primitive point', JSON.stringify([{ bullet: { id: 'x', name: 'A' }, points: ['bad'] }]), /each point must be an object/],
    ['non-finite point numeric field', JSON.stringify([{ bullet: { id: 'x', name: 'A' }, points: [{ rangeMeters: 'bad' }] }]), /point\.rangeMeters/],
  ])('rejects %s', async (_label, payload, expectedRe) => {
    mockReaderWithText(payload);
    const setError = jest.fn();
    const onImported = jest.fn();
    await io.importResultsFromFile({ size: payload.length }, {
      hexColorRe: HEX_COLOR_RE, setError, onImported,
    });
    expect(setError).toHaveBeenCalledWith(expect.stringMatching(expectedRe));
    expect(onImported).not.toHaveBeenCalled();
  });

  test('sanitizes valid payload, strips invalid hexColor, preserves ballisticCoefficientG7, and calls onImported', async () => {
    const payload = JSON.stringify([{
      bullet: { id: 'x', name: 'Test', hexColor: 'invalid', muzzleVelocityMps: 800, ballisticCoefficientG7: 0.224, extra: 'ignored' },
      points: [{ rangeMeters: 0, dropCm: 0, extra: 'ignored' }],
      maxOrdinateCm: 5,
    }]);
    mockReaderWithText(payload);
    const setError = jest.fn();
    const onImported = jest.fn().mockResolvedValue(undefined);
    await io.importResultsFromFile({ size: payload.length }, {
      hexColorRe: HEX_COLOR_RE, setError, onImported,
    });
    expect(setError).toHaveBeenCalledWith(null);
    expect(onImported).toHaveBeenCalledWith([{
      bullet: { id: 'x', name: 'Test', muzzleVelocityMps: 800, ballisticCoefficientG7: 0.224 },
      points: [{ rangeMeters: 0, dropCm: 0 }],
      maxOrdinateCm: 5,
    }]);
  });

  test('preserves valid hexColor and reports error if onImported rejects', async () => {
    const payload = JSON.stringify(sampleResults);
    mockReaderWithText(payload);
    const setError = jest.fn();
    const onImported = jest.fn().mockRejectedValue(new Error('render fail'));
    await io.importResultsFromFile({ size: payload.length }, {
      hexColorRe: HEX_COLOR_RE, setError, onImported,
    });
    expect(setError).toHaveBeenNthCalledWith(1, null);
    expect(setError).toHaveBeenNthCalledWith(2, 'Import failed: could not render the imported data.');
  });
});
