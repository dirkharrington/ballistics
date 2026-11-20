const { createHash } = require('crypto');
const { readFileSync, readdirSync, existsSync } = require('fs');
const { resolve } = require('path');

const CSS_PATH   = resolve(__dirname, '../app/ballistics.css');
const FONTS_DIR  = resolve(__dirname, '../app/fonts');
const HTML_PATH  = resolve(__dirname, '../app/index.html');

const css  = readFileSync(CSS_PATH,  'utf-8');
const html = readFileSync(HTML_PATH, 'utf-8');

// Extract parsed @font-face blocks from CSS
function extractFontFaces(cssText) {
  const faces = [];
  const blockRe = /@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = blockRe.exec(cssText)) !== null) {
    const body = m[1];
    const familyMatch = body.match(/font-family:\s*'([^']+)'/);
    const weightMatch = body.match(/font-weight:\s*(\d+(?:\s+\d+)?)/);
    const urlMatch    = body.match(/src:\s*url\('([^']+\.woff2)'\)/);
    const isLocalOnly = !urlMatch && /src:\s*[^;]*local\(/i.test(body);
    faces.push({
      family: familyMatch ? familyMatch[1] : null,
      weight: weightMatch ? weightMatch[1].replace(/\s+/g, ' ').trim() : '400',
      src: urlMatch ? urlMatch[1] : null,
      isLocalOnly,
    });
  }
  return faces;
}

// Extract all src: url('/fonts/...') references from non-local @font-face blocks
function extractFontFaceSrcs(cssText) {
  return extractFontFaces(cssText)
    .filter(face => !face.isLocalOnly && face.src)
    .map(face => face.src);
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
  const faces    = extractFontFaces(css);
  const declared = extractFontFaceSrcs(css);
  const onDisk   = listFontFiles();

  test('every non-local @font-face src exists on disk', () => {
    const nonLocalFaces = faces.filter(f => !f.isLocalOnly);
    expect(nonLocalFaces.length).toBeGreaterThan(0);
    for (const face of nonLocalFaces) {
      expect(face.src).not.toBeNull();
      const filename = face.src.replace(/^\/fonts\//, '');
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
    expect(faces.length).toBeGreaterThan(0);
    const seen = new Set();
    for (const face of faces) {
      expect(face.family).not.toBeNull();
      const key = `${face.family}:${face.weight}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test('no two .woff2 files in app/fonts/ have identical SHA-256 hashes', () => {
    const hashes = new Map();
    for (const file of onDisk) {
      const hash = createHash('sha256')
        .update(readFileSync(resolve(FONTS_DIR, file)))
        .digest('hex');
      expect(hashes.has(hash)).toBe(false);
      hashes.set(hash, file);
    }
  });

  test('every PERF-5 preloaded font has a matching @font-face', () => {
    const preloads = extractPreloadHrefs(html);
    for (const href of preloads) {
      expect(declared).toContain(href);
    }
  });

  test('metric-matched fallback @font-face blocks exist for all font families', () => {
    const fallbackFamilies = faces.filter(f => f.isLocalOnly).map(f => f.family);
    expect(fallbackFamilies).toEqual(
      expect.arrayContaining(['Orbitron Fallback', 'Rajdhani Fallback', 'Share Tech Mono Fallback']),
    );
  });
});
