import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const entry = join(root, 'lib', 'hyperweave-main.js')
const temp = await mkdtemp(join(tmpdir(), 'hyperweave-network-'))
let blockedOriginRequests = 0

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server.address().port)
    })
  })
}

const platformServer = createServer((request, response) => {
  if (request.url === '/probe') {
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end('platform-ok')
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/html' })
  response.end('<!doctype html><title>HyperWeave network policy</title><main>platform</main>')
})
const blockedServer = createServer((_request, response) => {
  blockedOriginRequests++
  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'text/plain',
  })
  response.end('external-origin-reached')
})

let app
try {
  const [platformPort, blockedPort] = await Promise.all([listen(platformServer), listen(blockedServer)])
  const platformUrl = `http://127.0.0.1:${platformPort}`
  const blockedUrl = `http://localhost:${blockedPort}/probe`
  const require = createRequire(join(root, 'package.json'))
  const electronExecutable = require('electron')
  const launchEnv = { ...process.env, HYPERWEAVE_PLATFORM_URL: platformUrl }
  delete launchEnv.ELECTRON_RUN_AS_NODE
  app = await electron.launch({
    executablePath: electronExecutable,
    args: [entry, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${join(temp, 'user-data')}`],
    env: launchEnv,
    timeout: 30_000,
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  assert.equal(new URL(window.url()).origin, platformUrl)

  const sameOrigin = await window.evaluate(async () => await (await fetch('/probe')).text())
  assert.equal(sameOrigin, 'platform-ok', 'same-origin HyperWeave request should reach the platform')

  const externalFetch = await window.evaluate(async (url) => {
    try { return await (await fetch(url)).text() }
    catch { return 'blocked' }
  }, blockedUrl)
  assert.equal(externalFetch, 'blocked', 'cross-origin renderer request should be denied')
  assert.equal(blockedOriginRequests, 0, 'denied cross-origin request must not reach its server')

  await window.evaluate((url) => { window.location.assign(url) }, blockedUrl.replace('/probe', '/navigation'))
  await window.waitForTimeout(250)
  assert.equal(new URL(window.url()).origin, platformUrl, 'cross-origin top-level navigation should be denied')

  const pageCount = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  await window.evaluate((url) => { window.open(url) }, blockedUrl)
  await window.waitForTimeout(100)
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), pageCount,
    'external popup should not create a BrowserWindow')
  assert.equal(blockedOriginRequests, 0, 'navigation and popup attempts must not reach the other origin')

  console.log('Verified Electron HyperWeave network boundary: same-origin allowed; external request, navigation, and popup denied.')
} finally {
  if (app) await app.close()
  await Promise.all([
    new Promise(resolve => platformServer.close(resolve)),
    new Promise(resolve => blockedServer.close(resolve)),
  ])
  await rm(temp, { recursive: true, force: true })
}
