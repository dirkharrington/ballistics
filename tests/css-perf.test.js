'use strict';

const { readFileSync } = require('fs');
const { resolve } = require('path');

const css = readFileSync(resolve(__dirname, '../app/ballistics.css'), 'utf-8');

// Extract all declarations for a given selector from the stylesheet.
// Returns the block text between the matching { ... } pair.
function blockFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped + '\\s*\\{([^}]*)\\}');
  const m = re.exec(css);
  return m ? m[1] : '';
}

describe('.chart-panel content-visibility (PERF-10)', () => {
  const block = blockFor('.chart-panel');

  test('.chart-panel block exists', () => {
    expect(block).not.toBe('');
  });

  test('has content-visibility: auto', () => {
    expect(block).toMatch(/content-visibility\s*:\s*auto/);
  });

  test('has contain-intrinsic-block-size with auto keyword and px value', () => {
    expect(block).toMatch(/contain-intrinsic-block-size\s*:\s*auto\s+\d+px/);
  });
});

describe('.chart-wrap canvas touch-action (PERF-11)', () => {
  const block = blockFor('.chart-wrap canvas');

  test('.chart-wrap canvas block exists', () => {
    expect(block).not.toBe('');
  });

  test('has touch-action: none', () => {
    expect(block).toMatch(/touch-action\s*:\s*none/);
  });
});

describe('CSS compositor & paint hygiene (PERF-25)', () => {
  test('body::before promotes scanline overlay onto an isolated compositor layer', () => {
    const block = blockFor('body::before');
    expect(block).toMatch(/contain\s*:\s*strict/);
    expect(block).toMatch(/will-change\s*:\s*transform/);
  });

  test('no rule uses transition: all', () => {
    expect(css).not.toMatch(/transition\s*:\s*all\b/i);
  });

  test('.bullet-card::before animates transform instead of layout width', () => {
    const block = blockFor('.bullet-card::before');
    expect(block).toMatch(/transition\s*:\s*transform\b/);
    expect(block).not.toMatch(/transition\s*:\s*width\b/);
  });

  test('mobile breakpoints override contain-intrinsic-block-size on .chart-panel', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*900px\)[\s\S]*?\.chart-panel\s*\{\s*contain-intrinsic-block-size:\s*auto\s+\d+px;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*500px\)[\s\S]*?\.chart-panel\s*\{\s*contain-intrinsic-block-size:\s*auto\s+\d+px;/);
  });

  test('#dataTable uses table-layout: fixed', () => {
    const block = blockFor('#dataTable');
    expect(block).toMatch(/table-layout\s*:\s*fixed/);
  });

  test('prefers-reduced-motion disables .empty-state .crosshair-big svg animation', () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.empty-state\s+\.crosshair-big\s+svg[\s\S]*?animation\s*:\s*none/);
  });

  test('dead .retry-btn rules are absent (PERF-34)', () => {
    expect(css).not.toMatch(/\.retry-btn\b/);
  });
});
