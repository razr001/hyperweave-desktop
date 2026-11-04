import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('./src/hyperweave/ui', import.meta.url)),
  base: './',
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  build: { outDir: fileURLToPath(new URL('./dist/hyperweave-ui', import.meta.url)), emptyOutDir: true },
})
