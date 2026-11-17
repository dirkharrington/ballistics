const { readFileSync, readdirSync, existsSync } = require('fs');
const { resolve } = require('path');

const CSS_PATH   = resolve(__dirname, '../app/ballistics.css');
const FONTS_DIR  = resolve(__dirname, '../app/fonts');
const HTML_PATH  = resolve(__dirname, '../app/index.html');

const css  = readFileSync(CSS_PATH,  'utf-8');
const html = readFileSync(HTML_PATH, 'utf-8');

// Extract all src: url('/fonts/...') references from @font-face blocks
function extractFontFaceSrcs(cssText) {
  const srcs = [];
  const re = /src:\s*url\('([^']+\.woff2)'\)/g;
  let m;
  while ((m = re.exec(cssText)) !== null) srcs.push(m[1]);
  return srcs;
}

// Extract font filenames on disk
function listFontFiles() {
  return readdirSync(FONTS_DIR).filter(f => f.endsWith('.woff2'));
}

// Extract href values from <link rel="preload" as="font"> tags in HTML
function extractPreloadHrefs(htmlText) {
  const hrefs = [];
  const re = /<link[^>]+rel=["']preload["'][^>]+as=["']font["'][^>]*>/g;
  let m;
  while ((m = re.exec(htmlText)) !== null) {
    const hrefMatch = m[0].match(/href=["']([^"']+)["']/);
    if (hrefMatch) hrefs.push(hrefMatch[1]);
  }
  return hrefs;
}

describe('font files', () => {
  const declared = extractFontFaceSrcs(css);
  const onDisk   = listFontFiles();

  test('every @font-face src exists on disk', () => {
    for (const src of declared) {
      const filename = src.replace(/^\/fonts\//, '');
      expect(existsSync(resolve(FONTS_DIR, filename))).toBe(true);
    }
  });

  test('no font file on disk is orphaned (every file has a @font-face)', () => {
    for (const file of onDisk) {
      const src = `/fonts/${file}`;
      expect(declared).toContain(src);
    }
  });

  test('no duplicate family/weight combinations in @font-face', () => {
    const seen = new Set();
    const re = /@font-face\s*\{[^}]*font-family:\s*'([^']+)'[^}]*font-weight:\s*(\d+)[^}]*\}/g;
    let m;
    while ((m = re.exec(css)) !== null) {
      const key = `${m[1]}:${m[2]}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test('every PERF-5 preloaded font has a matching @font-face', () => {
    const preloads = extractPreloadHrefs(html);
    for (const href of preloads) {
      expect(declared).toContain(href);
    }
  });
});
