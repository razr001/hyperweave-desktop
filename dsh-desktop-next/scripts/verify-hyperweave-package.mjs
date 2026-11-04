import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extractFile, listPackage } from '@electron/asar'

const output = join('release', 'hyperweave')
const macAppAsar = ['mac', 'mac-arm64', 'mac-x64', 'mac-universal']
  .map(directory => join(output, directory, 'HyperWeave.app', 'Contents', 'Resources', 'app.asar'))
  .find(existsSync)
const appAsarByPlatform = {
  win32: join(output, 'win-unpacked', 'resources', 'app.asar'),
  linux: join(output, 'linux-unpacked', 'resources', 'app.asar'),
  darwin: macAppAsar,
}
const targetPlatform = process.argv[2] || process.platform
const appAsar = appAsarByPlatform[targetPlatform]
assert.ok(appAsar, `Unsupported packaging platform: ${targetPlatform}`)

const files = listPackage(appAsar).map(path => path.replaceAll('\\', '/')).filter(path => path !== '/ui').sort()
assert.ok(files.includes('/ui/index.html'), 'the package must contain the local workbench UI')
assert.ok(files.includes('/preload.cjs'), 'the package must contain the restricted IPC bridge')
assert.deepEqual(files.filter(path => !path.startsWith('/ui/')),
  ['/LICENSE.upstream', '/LICENSES.third-party.txt', '/hyperweave-main.js', '/package.json', '/preload.cjs'])
const staged = join('.hyperweave-package')
const [ico, icns, png] = await Promise.all([
  readFile(join(staged, 'hyperweave.ico')),
  readFile(join(staged, 'hyperweave.icns')),
  readFile(join(staged, 'hyperweave.png')),
])
assert.equal(ico.readUInt16LE(2), 1, 'Windows icon must be an ICO resource')
assert.equal(icns.toString('ascii', 0, 4), 'icns', 'macOS icon must be an ICNS resource')
assert.equal(icns.readUInt32BE(4), icns.length, 'macOS icon resource length must be valid')
assert.equal(png.toString('ascii', 1, 4), 'PNG', 'Linux icon must be a PNG resource')
const main = extractFile(appAsar, 'hyperweave-main.js').toString('utf8')
assert.match(main, /HYPERWEAVE_PLATFORM_URL/u)
assert.match(main, /onBeforeRequest/u)
assert.match(main, /onWindowOpenHandler|setWindowOpenHandler/u)
assert.doesNotMatch(main,
  /NextDesktopRuntime|HarnessHost|CommunityMarket|NextUpdates|checkForDesktopUpdate|dshmarket|posthog|sentry|github\.com|deepseek/u,
  'the HyperWeave package must not include DSH runtime, marketplace, telemetry, or update integrations')
const packageInfo = JSON.parse(extractFile(appAsar, 'package.json').toString('utf8'))
assert.equal(packageInfo.main, 'hyperweave-main.js')
assert.match(packageInfo.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
assert.equal(packageInfo.version, process.env.HYPERWEAVE_DESKTOP_VERSION ?? '0.1.0')
assert.equal(packageInfo.name, 'hyperweave-desktop')
assert.equal(packageInfo.desktopName, 'hyperweave.desktop')
const ui = extractFile(appAsar, 'ui/index.html').toString('utf8')
assert.match(ui, /Content-Security-Policy/u)
assert.match(ui, /connect-src 'none'/u)
await readFile(appAsar.replace(/resources[\\/]app\.asar$/u, 'LICENSE.electron.txt'))
await readFile(appAsar.replace(/resources[\\/]app\.asar$/u, 'LICENSES.chromium.html'))
console.log(`Verified isolated HyperWeave Desktop package: ${appAsar}`)
