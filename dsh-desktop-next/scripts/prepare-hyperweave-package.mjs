/** Stages a minimal app so electron-builder cannot collect Harness production dependencies. */
import { copyFile, cp, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = fileURLToPath(new URL('..', import.meta.url))
const appDir = join(root, '.hyperweave-package')
await mkdir(appDir, { recursive: true })
const require = createRequire(import.meta.url)
// Yarn disables lifecycle scripts; Electron downloads its checked distribution on first require.
require('electron')
const electronDist = process.env.ELECTRON_OVERRIDE_DIST_PATH || join(dirname(require.resolve('electron')), 'dist')
// electron-builder removes the top-level Electron notices on macOS.
// Carry them as explicit resources so every distribution retains both notices.
await copyFile(join(electronDist, 'LICENSE'), join(appDir, 'LICENSE.electron.txt'))
await copyFile(join(electronDist, 'LICENSES.chromium.html'), join(appDir, 'LICENSES.chromium.html'))
await copyFile(join(root, 'lib', 'hyperweave-main.js'), join(appDir, 'hyperweave-main.js'))
await copyFile(join(root, 'preload.cjs'), join(appDir, 'preload.cjs'))
await copyFile(join(root, 'LICENSES.third-party.txt'), join(appDir, 'LICENSES.third-party.txt'))
await cp(join(root, 'dist', 'hyperweave-ui'), join(appDir, 'ui'), { recursive: true, force: true })
await copyFile(join(root, 'LICENSE.upstream'), join(appDir, 'LICENSE.upstream'))
await copyFile(join(root, 'electron-builder.hyperweave.yml'), join(appDir, 'electron-builder.hyperweave.yml'))
const logo = join(root, 'assets', 'hyperweave-app-icon.svg')
const pngs = new Map()
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  pngs.set(size, await sharp(logo).resize(size, size).png().toBuffer())
}
await writeFile(join(appDir, 'hyperweave.png'), pngs.get(512))

const icoSizes = [16, 32, 48, 64, 128, 256]
const icoImages = await Promise.all(icoSizes.map(size => size === 48
  ? sharp(logo).resize(size, size).png().toBuffer()
  : Promise.resolve(pngs.get(size))))
const icoHeader = Buffer.alloc(6 + icoSizes.length * 16)
icoHeader.writeUInt16LE(0, 0)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(icoSizes.length, 4)
let icoOffset = icoHeader.length
icoSizes.forEach((size, index) => {
  const entry = 6 + index * 16
  icoHeader.writeUInt8(size === 256 ? 0 : size, entry)
  icoHeader.writeUInt8(size === 256 ? 0 : size, entry + 1)
  icoHeader.writeUInt16LE(1, entry + 4)
  icoHeader.writeUInt16LE(32, entry + 6)
  icoHeader.writeUInt32LE(icoImages[index].length, entry + 8)
  icoHeader.writeUInt32LE(icoOffset, entry + 12)
  icoOffset += icoImages[index].length
})
await writeFile(join(appDir, 'hyperweave.ico'), Buffer.concat([icoHeader, ...icoImages]))

const icnsTypes = new Map([[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'],
  [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']])
const icnsChunks = [...icnsTypes].map(([size, type]) => {
  const image = pngs.get(size)
  const chunk = Buffer.alloc(8)
  chunk.write(type, 0, 4, 'ascii')
  chunk.writeUInt32BE(image.length + 8, 4)
  return Buffer.concat([chunk, image])
})
const icnsHeader = Buffer.alloc(8)
icnsHeader.write('icns', 0, 4, 'ascii')
icnsHeader.writeUInt32BE(8 + icnsChunks.reduce((total, chunk) => total + chunk.length, 0), 4)
await writeFile(join(appDir, 'hyperweave.icns'), Buffer.concat([icnsHeader, ...icnsChunks]))
const version = process.env.HYPERWEAVE_DESKTOP_VERSION ?? '0.1.0'
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version))
  throw new TypeError('HYPERWEAVE_DESKTOP_VERSION must be a valid semantic version')
await writeFile(join(appDir, 'package.json'), `${JSON.stringify({ name: 'hyperweave-desktop', version, private: true,
  author: 'HyperWeave', desktopName: 'hyperweave.desktop', description: 'HyperWeave secure Agent workbench',
  license: 'MIT', main: 'hyperweave-main.js' }, null, 2)}\n`)
