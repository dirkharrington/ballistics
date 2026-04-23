import { defineConfig } from 'vite'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))

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

export default defineConfig({
  root: 'src/main/resources/static',
  build: {
    outDir: '../../../../target/classes/static',
    emptyOutDir: true,
  },
  plugins: [bulletCatalogPlugin()],
})
