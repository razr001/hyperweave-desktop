import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { 'hyperweave-main': 'src/hyperweave/main.ts' },
  outDir: 'lib', format: 'esm', platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  deps: { neverBundle: ['electron'] },
})
