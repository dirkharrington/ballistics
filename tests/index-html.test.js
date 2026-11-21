const { readFileSync } = require('fs');
const { resolve } = require('path');

const html = readFileSync(resolve(__dirname, '../app/index.html'), 'utf-8');

const REQUIRED_PRELOADS = [
  '/fonts/rajdhani-400.woff2',
  '/fonts/rajdhani-600.woff2',
  '/fonts/share-tech-mono-400.woff2',
  '/fonts/orbitron.woff2',
];

describe('index.html aria-live regions', () => {
  test('contains #simStatus with aria-live="polite" and aria-atomic="true"', () => {
    expect(html).toContain('id="simStatus"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('class="sr-only"');
  });
});

describe('index.html font preloads', () => {
  test.each(REQUIRED_PRELOADS)('preloads %s with correct attributes', (href) => {
    const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

describe('PERF-24: index.html single module script entry', () => {
  test('contains exactly one <script type="module"> tag', () => {
    const matches = html.match(/<script\s+type=["']module["'][^>]*>/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(matches[0]).toContain('ballistics.js');
  });
});

describe('ENH-5: profile bar, atmosphere/Eotvos controls, custom drag CSV & clean copy', () => {
  test('removes stale HTTPS server copy from #latitudeDeg tooltip and includes ENH-5 controls', () => {
    expect(html).not.toContain('requests over HTTPS');
    expect(html).toContain('id="profileBar"');
    expect(html).toContain('id="pressureHpa"');
    expect(html).toContain('id="humidityPercent"');
    expect(html).toContain('id="includeEotvos"');
    expect(html).toContain('id="cbDragCsv"');
    expect(html).toContain('id="eotvosColHeader"');
  });
});
