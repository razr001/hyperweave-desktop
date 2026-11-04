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
let authenticatedTaskRequests = 0
let blockedUrl = ''

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
  if (request.url === '/api/probe') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ code: 0, data: 'platform-ok' }))
    return
  }
  if (request.url === '/api/redirect') {
    response.writeHead(302, { Location: blockedUrl })
    response.end()
    return
  }
  response.writeHead(200, { 'Content-Type': 'application/json' })
  if (request.url === '/api/tenant/auth/login' && request.method === 'POST') {
    response.end(JSON.stringify({ code: 0, data: { access_token: 'test-access-token', refresh_token: 'test-refresh-token',
      user: { id: 'user-1', email: 'agent@example.test', display_name: '测试用户', role: 'USER' } } }))
  } else if (request.url === '/api/tenant/auth/me') {
    response.end(JSON.stringify({ code: 0, data: { id: 'user-1', email: 'agent@example.test', display_name: '测试用户', role: 'USER' } }))
  } else if (['/api/agent/profiles', '/api/skills', '/api/agent/plugins', '/api/rag/knowledge-bases'].includes(request.url ?? '')) {
    response.end(JSON.stringify({ code: 0, data: [] }))
  } else if (request.url === '/api/agent/tasks' && request.method === 'GET') {
    response.end(JSON.stringify({ code: 0, data: { items: [], nextCursor: null } }))
  } else if (request.url === '/api/agent/tasks' && request.method === 'POST') {
    if (request.headers.authorization !== 'Bearer test-access-token') authenticatedTaskRequests = -1
    else authenticatedTaskRequests++
    response.end(JSON.stringify({ code: 0, data: { id: 'task-1', state: 'QUEUED', prompt: '检查本地工作台连接',
      promptPreview: '检查本地工作台连接', sessionId: 'session-1', requestId: 'request-1' } }))
  } else if (request.url?.startsWith('/api/agent/tasks/task-1/events')) {
    response.end(JSON.stringify({ code: 0, data: [] }))
  } else if (request.url === '/api/agent/tasks/task-1/artifacts') {
    response.end(JSON.stringify({ code: 0, data: [] }))
  } else if (request.url === '/api/agent/tasks/task-1') {
    response.end(JSON.stringify({ code: 0, data: { id: 'task-1', state: 'QUEUED', prompt: '检查本地工作台连接' } }))
  } else {
    response.end(JSON.stringify({ code: 0, data: null }))
  }
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
  blockedUrl = `http://localhost:${blockedPort}/probe`
  const require = createRequire(join(root, 'package.json'))
  const packagedExecutable = process.env.HYPERWEAVE_DESKTOP_EXECUTABLE
  const electronExecutable = packagedExecutable || require('electron')
  const launchEnv = { ...process.env, HYPERWEAVE_PLATFORM_URL: platformUrl }
  delete launchEnv.ELECTRON_RUN_AS_NODE
  app = await electron.launch({
    executablePath: electronExecutable,
    args: [...(packagedExecutable ? [] : [entry]), ...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${join(temp, 'user-data')}`],
    env: launchEnv,
    timeout: 30_000,
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  assert.equal(new URL(window.url()).protocol, 'file:', 'the client should render its own packaged workbench')
  assert.equal(await window.title(), 'HyperWeave')
  assert.equal(await window.locator('.login-form h2').textContent(), '欢迎回来')

  await window.locator('input[type="email"]').fill('agent@example.test')
  await window.locator('input[type="password"]').fill('test-password')
  await window.getByRole('button', { name: /登录 HyperWeave/u }).click()
  await window.getByRole('heading', { name: '今天想完成什么？' }).waitFor()

  await window.locator('textarea.prompt').fill('检查本地工作台连接')
  await window.getByRole('button', { name: /提交任务/u }).click()
  await window.getByText('PLATFORM TASK · task-1').waitFor()
  assert.equal(authenticatedTaskRequests, 1, 'task submission should use the authenticated platform session')

  const sameOrigin = await window.evaluate(async () => await window.hyperweave.request({ path: '/api/probe' }))
  assert.equal(sameOrigin, 'platform-ok', 'same-origin HyperWeave request should reach the platform')

  const externalFetch = await window.evaluate(async (url) => {
    try { return await (await fetch(url)).text() }
    catch { return 'blocked' }
  }, blockedUrl)
  assert.equal(externalFetch, 'blocked', 'cross-origin renderer request should be denied')
  assert.equal(blockedOriginRequests, 0, 'denied cross-origin request must not reach its server')
  const escapedApi = await window.evaluate(async () => {
    try { await window.hyperweave.request({ path: 'http://localhost/outside/api' }); return 'allowed' }
    catch { return 'blocked' }
  })
  assert.equal(escapedApi, 'blocked', 'IPC must reject arbitrary request origins')
  const escapedRedirect = await window.evaluate(async () => {
    try { await window.hyperweave.request({ path: '/api/redirect' }); return 'allowed' }
    catch { return 'blocked' }
  })
  assert.equal(escapedRedirect, 'blocked', 'IPC must reject platform redirects to external origins')
  assert.equal(blockedOriginRequests, 0, 'external redirect targets must never be requested')

  await window.evaluate((url) => { window.location.assign(url) }, blockedUrl.replace('/probe', '/navigation'))
  await window.waitForTimeout(250)
  assert.equal(new URL(window.url()).protocol, 'file:', 'cross-origin top-level navigation should be denied')

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
