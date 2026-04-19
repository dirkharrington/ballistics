import { defineConfig } from 'vite'
import { copyFileSync } from 'fs'
import { join } from 'path'

// ballistics.js is a classic (non-module) script so Vite skips bundling it.
// This plugin copies it as-is until Priority 3 converts the codebase to ESM.
function copyClassicScripts() {
  return {
    name: 'copy-classic-scripts',
    closeBundle() {
      const root = process.cwd()
      copyFileSync(
        join(root, 'src/main/resources/static/ballistics.js'),
        join(root, 'target/classes/static/ballistics.js')
      )
    }
  }
}

export default defineConfig({
  root: 'src/main/resources/static',
  plugins: [copyClassicScripts()],
  build: {
    outDir: '../../../../target/classes/static',
    emptyOutDir: true,
  },
})
