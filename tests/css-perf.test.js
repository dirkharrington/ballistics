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
