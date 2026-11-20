import { defineConfig, minifySync } from 'vite'
import { createHash } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as yaml from 'js-yaml'
import catalogProjection from './catalog-projection.cjs'

const { projectBulletCatalog } = catalogProjection

const __dirname = dirname(fileURLToPath(import.meta.url))

function htmlMinifyPlugin() {
  const RAW_TAGS = new Set(['script', 'style', 'pre', 'textarea'])
  return {
    name: 'html-minify',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const out = []
        const len = html.length
        const lower = html.toLowerCase()
        let i = 0
        while (i < len) {
          if (html.startsWith('<!--', i)) {
            const end = html.indexOf('-->', i + 4)
            i = end === -1 ? len : end + 3
            continue
          }
          if (html[i] === '<') {
            let j = i + 1
            let quote = ''
            while (j < len) {
              const ch = html[j]
              if (quote) {
                if (ch === quote) quote = ''
              } else if (ch === '"' || ch === "'") {
                quote = ch
              } else if (ch === '>') {
                break
              }
              j++
            }
            const tagEnd = j < len ? j + 1 : len
            const rawTag = html.slice(i, tagEnd)
            let cleanTag = ''
            let inQuote = ''
            let prevSpace = false
            for (let k = 0; k < rawTag.length; k++) {
              const ch = rawTag[k]
              if (inQuote) {
                cleanTag += ch
                if (ch === inQuote) inQuote = ''
              } else if (ch === '"' || ch === "'") {
                inQuote = ch
                prevSpace = false
                cleanTag += ch
              } else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
                if (!prevSpace) {
                  cleanTag += ' '
                  prevSpace = true
                }
              } else {
                if (ch === '>' && prevSpace && cleanTag.endsWith(' ')) {
                  cleanTag = cleanTag.slice(0, -1)
                }
                prevSpace = false
                cleanTag += ch
              }
            }
            out.push(cleanTag)
            i = tagEnd

            // Preserve raw-text element contents verbatim
            let nameEnd = 1
            while (nameEnd < cleanTag.length && /[a-zA-Z0-9]/.test(cleanTag[nameEnd])) nameEnd++
            const tagName = cleanTag.slice(1, nameEnd).toLowerCase()
            if (RAW_TAGS.has(tagName) && !cleanTag.endsWith('/>')) {
              const closeNeedle = `</${tagName}`
              const closeStart = lower.indexOf(closeNeedle, i)
              if (closeStart !== -1) {
                const closeGt = html.indexOf('>', closeStart + closeNeedle.length)
                const rawEnd = closeGt === -1 ? len : closeGt + 1
                out.push(html.slice(i, rawEnd))
                i = rawEnd
              }
            }
            continue
          }
          const nextLt = html.indexOf('<', i)
          const textEnd = nextLt === -1 ? len : nextLt
          const text = html.slice(i, textEnd)
          if (text.trim().length > 0) {
            out.push(text.replace(/\s+/g, ' '))
          }
          i = textEnd
        }
        return out.join('').trim()
      },
    },
  }
}

function serviceWorkerPlugin() {
  let resolvedOutDir;
  return {
    name: 'sw-build',
    configResolved(config) {
      if (config.command === 'build') {
        resolvedOutDir = resolve(config.root, config.build.outDir);
      }
    },
    writeBundle(_options, bundle) {
      if (!resolvedOutDir) return;

      // Collect hashed assets emitted by Vite, excluding the lazy Chart.js vendor chunk
      // so first-visit SW install never competes with critical-path assets (PERF-24).
      const hashedAssets = Object.keys(bundle)
        .filter(key => /\.(js|css|woff2?|ttf|eot|png|jpe?g|gif|svg|ico|webp)$/.test(key))
        .filter(key => !/^assets\/vendor-.*\.js$/.test(key))
        .sort()
        .map(key => `/ballistics/${key}`);

      // Always include un-hashed root-level URLs
      const allAssets = ['/ballistics/', '/ballistics/index.html', '/ballistics/manifest.json', ...hashedAssets];
      // Deterministic content-derived cache version so identical builds emit byte-identical sw.js
      const hash = createHash('sha256').update(allAssets.join('\n')).digest('hex').slice(0, 12);
      const manifestJson = allAssets.map(a => JSON.stringify(a)).join(', ');

      const swSrc = readFileSync(resolve(__dirname, 'app/sw.js'), 'utf-8');
      const swOut = swSrc
        .replace("let CACHE_VERSION = 'v1';", `let CACHE_VERSION = '${hash}';`)
        .replace("'__VITE_PRECACHE_MANIFEST__'", manifestJson);
      const minified = minifySync('sw.js', swOut, { compress: true, mangle: true });
      if (minified.errors?.length) {
        throw new Error(`Failed to minify sw.js: ${minified.errors.map(e => e.message).join('; ')}`);
      }
      writeFileSync(resolve(resolvedOutDir, 'sw.js'), minified.code);
    },
  };
}

function bulletCatalogPlugin() {
  const virtualId = 'virtual:bullet-catalog'
  const resolvedId = '\0' + virtualId
  return {
    name: 'bullet-catalog',
    resolveId(id) {
      if (id === virtualId) return resolvedId
    },
    load(id) {
      if (id === resolvedId) {
        const raw = readFileSync(
          resolve(__dirname, 'app/data/bullets.yaml'), 'utf-8')
        const data = yaml.load(raw)
        return `export default ${JSON.stringify(projectBulletCatalog(data.app.bullets))};`
      }
    }
  }
}

// Exposes /app/data/physics-tables.yaml as a virtual ES module so
// the JS client has a single source of truth for the
// G1 drag table and atmosphere model constants.
function physicsTablesPlugin() {
  const virtualId = 'virtual:physics-tables'
  const resolvedId = '\0' + virtualId
  return {
    name: 'physics-tables',
    resolveId(id) {
      if (id === virtualId) return resolvedId
    },
    load(id) {
      if (id === resolvedId) {
        const raw = readFileSync(
          resolve(__dirname, 'app/data/physics-tables.yaml'), 'utf-8')
        const data = yaml.load(raw)
        const G1_TABLE = data.g1Table.map(({ v, f }) => [v, f])
        const G7_TABLE = data.g7Table.map(({ v, f }) => [v, f])
        const ATMOSPHERE = data.atmosphere
        return `export const G1_TABLE = ${JSON.stringify(G1_TABLE)};\n`
             + `export const G7_TABLE = ${JSON.stringify(G7_TABLE)};\n`
             + `export const ATMOSPHERE = ${JSON.stringify(ATMOSPHERE)};\n`
             + `export default { G1_TABLE, G7_TABLE, ATMOSPHERE };\n`
      }
    }
  }
}

export default defineConfig({
  base: '/ballistics/',
  root: 'app',
  css: {
    transformer: 'lightningcss',
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    cssMinify: 'lightningcss',
    // Browser floor is already set by module workers + module SW; lowering gains no browsers.
    // Fallback to 'es2022' if a target browser breaks.
    target: 'esnext',
    reportCompressedSize: false,
    rolldownOptions: {
      treeshake: {
        // Chart.js unused scale classes (LogarithmicScale, RadialLinearScale, TimeScale,
        // TimeSeriesScale) read static properties (Ticks.formatters.*, TimeScale.defaults)
        // in class field initializers; mark property reads pure so Rolldown tree-shakes them
        // when excluded by app/chart-loader.js (PERF-26).
        propertyReadSideEffects: false,
      },
      output: {
        codeSplitting: {
          groups: [
            // Narrow test: only chart.js and @kurkle — avoids pulling Vite helpers into vendor,
            // which would make Chart.js load eagerly and undo the PERF-3 lazy-import.
            { name: 'vendor',  test: /[\\/]node_modules[\\/](chart\.js|@kurkle)[\\/]/, priority: 20 },
            { name: 'physics', test: /[\\/]app[\\/]physics[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  worker: {
    plugins: () => [bulletCatalogPlugin(), physicsTablesPlugin()],
  },
  plugins: [htmlMinifyPlugin(), serviceWorkerPlugin(), bulletCatalogPlugin(), physicsTablesPlugin()],
})
