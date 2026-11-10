import { defineConfig } from 'vite'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

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
    closeBundle() {
      if (!resolvedOutDir) return;
      let hash = Date.now().toString(36);
      try {
        const assetsDir = resolve(resolvedOutDir, 'assets');
        const wasmFile = readdirSync(assetsDir).find(f => /\.wasm$/.test(f));
        if (wasmFile) {
          const m = wasmFile.match(/[-.]([0-9a-f]{8,})\.[^.]+$/i);
          if (m) hash = m[1];
        }
      } catch { /* no WASM assets yet */ }
      const swSrc = readFileSync(
        resolve(__dirname, 'src/main/resources/static/sw.js'), 'utf-8');
      const swOut = swSrc.replace("let _wasmHash = 'v1';", `let _wasmHash = '${hash}';`);
      writeFileSync(resolve(resolvedOutDir, 'sw.js'), swOut);
    },
  };
}

function wasmEnginePlugin() {
  const virtualId = 'virtual:wasm-engine'
  const stubId = '\0virtual:wasm-engine-stub'
  const entryPath = resolve(__dirname, 'src/main/resources/static/wasm/engine-entry.js')
  let warned = false
  return {
    name: 'wasm-engine',
    resolveId(id) {
      if (id === virtualId) {
        if (existsSync(entryPath)) return entryPath
        return stubId
      }
    },
    load(id) {
      if (id === stubId) {
        if (process.env.WASM_REQUIRED === 'true') {
          this.error('WASM engine artifacts missing: run wasm-pack + engine/stage.sh')
        } else if (!warned) {
          warned = true
          this.warn('WASM engine artifacts missing: run wasm-pack + engine/stage.sh')
        }
        return `export class WasmUnavailableError extends Error { constructor(m) { super(m); this.name = 'WasmUnavailableError'; } }
export class BallisticsEngineError extends Error { constructor(m) { super(m); this.name = 'BallisticsEngineError'; } }
export function initEngine() { return Promise.reject(new WasmUnavailableError('WASM engine not built')); }
export function computeTrajectory() { throw new WasmUnavailableError('WASM engine not built'); }
export function createEngineWorker() { return null; }
`
      }
    }
  }
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
          resolve(__dirname, 'src/main/resources/bullets.yaml'), 'utf-8')
        const data = yaml.load(raw)
        return `export default ${JSON.stringify(data.app.bullets)};`
      }
    }
  }
}

// Exposes /src/main/resources/physics-tables.yaml as a virtual ES module so
// the JS client and the Java engine share a single source of truth for the
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
          resolve(__dirname, 'src/main/resources/physics-tables.yaml'), 'utf-8')
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
  root: 'src/main/resources/static',
  build: {
    outDir: '../../../../target/classes/static',
    emptyOutDir: true,
  },
  plugins: [serviceWorkerPlugin(), bulletCatalogPlugin(), physicsTablesPlugin(), wasmEnginePlugin()],
  worker: {
    format: 'es',
  },
})
