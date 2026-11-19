import { defineConfig } from 'vite'
import { createHash } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'
import { projectBulletCatalog } from './catalog-projection.cjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

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
      writeFileSync(resolve(resolvedOutDir, 'sw.js'), swOut);
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
  build: {
    outDir: '../dist',
    emptyOutDir: true,
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
  plugins: [serviceWorkerPlugin(), bulletCatalogPlugin(), physicsTablesPlugin()],
})
