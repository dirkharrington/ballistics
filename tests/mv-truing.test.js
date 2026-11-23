import {
  solveMV, validateTruingInput, truedBulletName, truedBulletFields,
  initMvTruing, setToolsUnitSystem,
} from '../app/tools.js';

describe('solveMV', () => {
  // Monotonic: faster bullet drops less.
  const linear = mv => 1000 - mv; // drop(cm) at the observed range
  test('converges to the matching MV', () => {
    const mv = solveMV(linear, 200, 50, 9999, 0.01);
    expect(Math.abs(linear(mv) - 200)).toBeLessThanOrEqual(0.01);
    expect(mv).toBeCloseTo(800, 1);
  });
  test('returns null when both extremes are on the same side of the target', () => {
    expect(solveMV(() => 500, 100)).toBeNull();
    expect(solveMV(mv => 1000 - mv * 0.001, 0)).toBeNull();
  });
  test('exact solution on the first midpoint returns after one iteration', () => {
    const calls = [];
    const fn = mv => { calls.push(mv); return mv === 100 ? 7 : (mv < 100 ? 20 : 0); };
    expect(solveMV(fn, 7, 50, 150)).toBe(100);
    expect(calls).toEqual([50, 150, 100]);
  });
  test('falls back to the bracket midpoint when maxIter is exhausted', () => {
    const mv = solveMV(linear, 200, 50, 9999, 0, 3);
    expect(mv).toBeGreaterThan(50);
    expect(mv).toBeLessThan(9999);
  });
  test('handles the high side of the bracket (target above midpoint)', () => {
    const mv = solveMV(linear, 900, 50, 9999, 0.01);
    expect(mv).toBeCloseTo(100, 1);
  });
  test('a target exactly at an extreme is bracketed', () => {
    expect(solveMV(linear, linear(50), 50, 9999, 0.01, 100)).toBeCloseTo(50, 0);
  });
});

describe('validateTruingInput', () => {
  test('accepts metric cm', () => {
    expect(validateTruingInput('300', '45', 'cm', 'metric')).toEqual({ ok: true, rangeM: 300, dropCm: 45 });
  });
  test('converts MOA to cm', () => {
    const r = validateTruingInput('100', '1', 'moa', 'metric');
    expect(r.ok).toBe(true);
    expect(r.dropCm).toBeCloseTo(2.909, 2);
  });
  test('converts imperial yards and inches', () => {
    const r = validateTruingInput('100', '10', 'cm', 'imperial');
    expect(r.rangeM).toBeCloseTo(91.44, 2);
    expect(r.dropCm).toBeCloseTo(25.4, 1);
  });
  test('rejects missing, zero, negative, non-finite or oversize range', () => {
    for (const bad of ['', null, '0', '-5', 'abc', 'Infinity']) {
      expect(validateTruingInput(bad, '10', 'cm').ok).toBe(false);
    }
    expect(validateTruingInput('5001', '10', 'cm').error).toMatch(/at most/);
  });
  test('rejects missing / non-finite drop; allows zero and negative', () => {
    for (const bad of ['', null, 'x', 'NaN']) {
      expect(validateTruingInput('100', bad, 'cm').ok).toBe(false);
    }
    expect(validateTruingInput('100', '0', 'cm').ok).toBe(true);
    expect(validateTruingInput('100', '-3', 'cm').dropCm).toBe(-3);
  });
});

describe('trued bullet naming and fields', () => {
  test('appends (trued) and does not stack suffixes', () => {
    expect(truedBulletName('Foo')).toBe('Foo (trued)');
    expect(truedBulletName('Foo (trued)')).toBe('Foo (trued)');
  });
  test('truncates long names to fit 64 chars', () => {
    const n = truedBulletName('x'.repeat(100));
    expect(n.length).toBe(64);
    expect(n.endsWith(' (trued)')).toBe(true);
  });
  test('fields convert to custom-bullet form units', () => {
    const f = truedBulletFields({
      name: 'Base', shortName: 'B', bulletWeightGrams: 10.89, ballisticCoefficient: 0.475,
      ballisticCoefficientG7: 0.24, bulletDiameterMm: 7.82, muzzleVelocityMps: 807,
    }, 800);
    expect(f).toEqual({
      name: 'Base (trued)', shortName: 'B*', bulletWeightGrains: '168.06', ballisticCoefficientG1: '0.475',
      ballisticCoefficientG7: '0.24', bulletDiameterInches: '0.308', muzzleVelocityFps: '2624.7',
    });
  });
  test('missing short name / G7 BC fall back; long short names are clipped', () => {
    const f = truedBulletFields({
      name: 'A very long bullet name', bulletWeightGrams: 5, ballisticCoefficient: 0.3,
      ballisticCoefficientG7: null, bulletDiameterMm: 6, muzzleVelocityMps: 900,
    }, 900);
    expect(f.ballisticCoefficientG7).toBe('');
    expect(f.shortName).toBe('A very long bul*');
    expect(f.shortName.length).toBeLessThanOrEqual(16 + 1);
  });
});

describe('initMvTruing UI', () => {
  const bullet = { id: 'b', name: 'Base', muzzleVelocityMps: 800 };
  const req = { maxRangeMeters: 1000, stepMeters: 25 };
  // drop(cm, positive below LOS) at range = (1000 - mv) / 10 ; simulate returns negative dropCm
  const fakeSim = (b, params) => {
    const drop = (1000 - b.muzzleVelocityMps) / 10;
    return { points: [
      { rangeMeters: 0, dropCm: 0 },
      { rangeMeters: params.maxRangeMeters, dropCm: -drop },
    ] };
  };
  let deps;
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  const fill = (range, drop, unit = 'cm') => {
    document.getElementById('truingRange').value = range;
    document.getElementById('truingDrop').value = drop;
    document.getElementById('truingDropUnit').value = unit;
  };

  beforeEach(() => {
    document.body.innerHTML = `
      <section id="mvTruingCard">
        <input id="truingRange"><input id="truingDrop">
        <select id="truingDropUnit"><option value="cm">cm</option><option value="moa">MOA</option></select>
        <button id="truingCalc"></button><small id="truingError"></small>
        <div id="truingResult" style="display:none"><span id="truingMV"></span><span id="truingDelta"></span>
          <button id="truingApply"></button><span id="truingApplyMsg"></span></div>
      </section>`;
    setToolsUnitSystem('metric');
    deps = {
      getContext: jest.fn(() => ({ bullet, baseBullet: bullet, req })),
      loadSimulate: jest.fn(() => Promise.resolve(fakeSim)),
      saveTrued: jest.fn(() => ({ ok: true, name: 'Base (trued)' })),
    };
    initMvTruing(deps);
  });

  test('validation errors are shown and nothing is computed', async () => {
    fill('', '10');
    document.getElementById('truingCalc').click();
    await flush();
    expect(document.getElementById('truingError').textContent).toMatch(/range/i);
    expect(deps.getContext).not.toHaveBeenCalled();
  });

  test('no simulation context shows guidance', async () => {
    deps.getContext.mockReturnValue(null);
    fill('300', '20');
    document.getElementById('truingCalc').click();
    await flush();
    expect(document.getElementById('truingError').textContent).toMatch(/run a simulation/i);
  });

  test('engine load failure is reported', async () => {
    deps.loadSimulate.mockRejectedValue(new Error('nope'));
    fill('300', '20');
    document.getElementById('truingCalc').click();
    await flush();
    expect(document.getElementById('truingError').textContent).toMatch(/physics engine/i);
  });

  test('solves, shows MV and delta, then applies to bullet', async () => {
    fill('300', '25'); // 25 cm drop -> mv 750
    document.getElementById('truingCalc').click();
    await flush();
    expect(document.getElementById('truingError').textContent).toBe('');
    expect(document.getElementById('truingResult').style.display).toBe('');
    expect(Math.abs(parseFloat(document.getElementById('truingMV').textContent) - 750)).toBeLessThan(1);
    expect(document.getElementById('truingMV').textContent).toMatch(/ m\/s$/);
    expect(document.getElementById('truingDelta').textContent).toMatch(/^-50(\.\d)? m\/s vs nominal$|^-49\.\d m\/s vs nominal$/);
    document.getElementById('truingApply').click();
    expect(deps.saveTrued).toHaveBeenCalledWith(bullet, expect.closeTo(750, 0));
    expect(document.getElementById('truingApplyMsg').textContent).toContain('Base (trued)');
  });

  test('positive delta gets a plus sign; imperial uses fps', async () => {
    setToolsUnitSystem('imperial');
    fill('328.084', '3.937'); // 300 m, 10 cm -> mv 900
    document.getElementById('truingCalc').click();
    await flush();
    expect(document.getElementById('truingMV').textContent).toMatch(/fps$/);
    expect(document.getElementById('truingDelta').textContent).toMatch(/^\+\d/);
  });

  test('unbracketed drop shows an error and hides the result', async () => {
    fill('300', '-5000');
    document.getElementById('truingCalc').click();
    await flush();
    expect(document.getElementById('truingError').textContent).toMatch(/No muzzle velocity/);
    expect(document.getElementById('truingResult').style.display).toBe('none');
  });

  test('simulation failures and empty results are treated as huge drops', async () => {
    deps.loadSimulate.mockResolvedValue((b, p) => {
      if (b.muzzleVelocityMps < 100) throw new Error('boom');
      if (b.muzzleVelocityMps < 400) return { points: [] };
      return fakeSim(b, p);
    });
    fill('300', '55'); // -> mv 450
    document.getElementById('truingCalc').click();
    await flush();
    expect(Math.abs(parseFloat(document.getElementById('truingMV').textContent) - 450)).toBeLessThan(1);
  });

  test('bullets that fall short of the observed range are treated as huge drops', async () => {
    deps.loadSimulate.mockResolvedValue((b, p) => {
      if (b.muzzleVelocityMps < 700) return { points: [{ rangeMeters: 0, dropCm: 0 }, { rangeMeters: 10, dropCm: -1 }] };
      return fakeSim(b, p);
    });
    fill('300', '25'); // -> mv 750
    document.getElementById('truingCalc').click();
    await flush();
    expect(Math.abs(parseFloat(document.getElementById('truingMV').textContent) - 750)).toBeLessThan(1);
  });

  test('apply failure shows the message; apply without a result is a no-op', async () => {
    document.getElementById('truingApply').click();
    expect(deps.saveTrued).not.toHaveBeenCalled();
    fill('300', '25');
    document.getElementById('truingCalc').click();
    await flush();
    deps.saveTrued.mockReturnValue({ ok: false, message: 'nope' });
    document.getElementById('truingApply').click();
    expect(document.getElementById('truingApplyMsg').textContent).toBe('nope');
    deps.saveTrued.mockReturnValue({ ok: false });
    document.getElementById('truingApply').click();
    expect(document.getElementById('truingApplyMsg').textContent).toBe('Could not save bullet.');
  });

  test('a new calculation clears a previous result', async () => {
    fill('300', '25');
    document.getElementById('truingCalc').click();
    await flush();
    fill('', '25');
    document.getElementById('truingCalc').click();
    await flush();
    expect(document.getElementById('truingResult').style.display).toBe('none');
    document.getElementById('truingApply').click();
    expect(deps.saveTrued).not.toHaveBeenCalled();
  });
});
