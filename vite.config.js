import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src/main/resources/static',
  build: {
    outDir: '../../../../target/classes/static',
    emptyOutDir: true,
  },
})
