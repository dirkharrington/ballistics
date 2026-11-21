const { readFileSync } = require('fs');
const { resolve } = require('path');
const yaml = require('js-yaml');
const { projectBulletCatalog } = require('../catalog-projection.cjs');

const REQUIRED_FIELDS = [
  'id',
  'name',
  'bulletWeightGrams',
  'muzzleVelocityMps',
  'ballisticCoefficient',
  'ballisticCoefficientG7',
  'bulletDiameterMm',
  'muzzleEnergyJoules',
  'hexColor',
];

describe('PERF-27: bullet catalog projection', () => {
  const raw = readFileSync(resolve(__dirname, '../app/data/bullets.yaml'), 'utf-8');
  const rawBullets = yaml.load(raw).app.bullets;
  const projected = projectBulletCatalog(rawBullets);

  test('loads all 37 built-in bullets from bullets.yaml', () => {
    expect(rawBullets).toHaveLength(37);
    expect(projected).toHaveLength(37);
  });

  test('preserves all 9 runtime fields and strips description and caliber', () => {
    projected.forEach((entry, idx) => {
      const source = rawBullets[idx];
      expect(Object.keys(entry).sort()).toEqual([...REQUIRED_FIELDS].sort());
      for (const field of REQUIRED_FIELDS) {
        expect(entry[field]).toBe(source[field]);
        expect(entry[field]).toBeDefined();
      }
      expect(entry).not.toHaveProperty('description');
      expect(entry).not.toHaveProperty('caliber');
    });
  });

  test('ENH-1: all 37 rounds have finite 0 < ballisticCoefficientG7 < ballisticCoefficient', () => {
    projected.forEach(entry => {
      expect(typeof entry.ballisticCoefficientG7).toBe('number');
      expect(Number.isFinite(entry.ballisticCoefficientG7)).toBe(true);
      expect(entry.ballisticCoefficientG7).toBeGreaterThan(0);
      expect(entry.ballisticCoefficientG7).toBeLessThan(entry.ballisticCoefficient);
    });
  });

  test('leaves raw source objects untouched', () => {
    expect(rawBullets[0]).toHaveProperty('description');
    expect(rawBullets[0]).toHaveProperty('caliber');
  });
});
