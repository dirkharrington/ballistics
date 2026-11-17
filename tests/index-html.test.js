const { readFileSync } = require('fs');
const { resolve } = require('path');

const html = readFileSync(resolve(__dirname, '../app/index.html'), 'utf-8');

const REQUIRED_PRELOADS = [
  '/fonts/rajdhani-400.woff2',
  '/fonts/share-tech-mono-400.woff2',
  '/fonts/orbitron-900.woff2',
];

describe('index.html font preloads', () => {
  test.each(REQUIRED_PRELOADS)('preloads %s with correct attributes', (href) => {
    const escaped = href.replace(/\./g, '\\.');
    const re = new RegExp(
      `<link[^>]+rel=["']preload["'][^>]+href=["']${escaped}["'][^>]*>|` +
      `<link[^>]+href=["']${escaped}["'][^>]+rel=["']preload["'][^>]*>`
    );
    const match = html.match(re);
    expect(match).not.toBeNull();
    const tag = match[0];
    expect(tag).toContain('as="font"');
    expect(tag).toContain('type="font/woff2"');
    expect(tag).toContain('crossorigin');
  });
});
