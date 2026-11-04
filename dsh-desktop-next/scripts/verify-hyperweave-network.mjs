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
let authenticatedPluginCatalogRequests = 0
let cancelledTasks = 0
let recoveredTasks = 0
let uploadedFiles = 0
let savedProfiles = []
let knowledgeBases = []
let submittedTaskInput
let taskState = 'QUEUED'
let blockedUrl = ''
const skillId = '2a000000-0000-4000-8000-000000000001'
const pluginId = '2a000000-0000-4000-8000-000000000002'
const knowledgeBaseId = '2a000000-0000-4000-8000-000000000003'

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server.address().port)
    })
  })
}

const platformServer = createServer(async (request, response) => {
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
  } else if (request.url?.startsWith('/api/agent/plugins/catalog')) {
    if (request.headers.authorization !== 'Bearer test-access-token') authenticatedPluginCatalogRequests = -1
    else authenticatedPluginCatalogRequests++
    response.end(JSON.stringify({ code: 0, data: { plugins: [{ pluginId, pluginKey: 'ledger-export', versionId: '2a000000-0000-4000-8000-000000000004', version: '1.0.0', description: 'Ledger export' }], nextPluginKey: null } }))
  } else if (request.url === '/api/agent/profiles' && request.method === 'GET') {
    response.end(JSON.stringify({ code: 0, data: savedProfiles }))
  } else if (request.url === '/api/agent/profiles' && request.method === 'POST') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const profile = { id: '2a000000-0000-4000-8000-000000000005', name: input.name,
      roleDescription: input.role_description, instructions: input.instructions, enabled: true, revision: 1,
      skillIds: input.skill_ids, pluginIds: input.plugin_ids, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    savedProfiles = [profile]
    response.end(JSON.stringify({ code: 0, data: profile }))
  } else if (request.url === '/api/skills') {
    response.end(JSON.stringify({ code: 0, data: [{ id: skillId, name: 'Research Notes', description: 'Summarize uploaded notes', enabled: true, activeVersion: 1 }] }))
  } else if (request.url === '/api/rag/knowledge-bases' && request.method === 'GET') {
    response.end(JSON.stringify({ code: 0, data: knowledgeBases }))
  } else if (request.url === '/api/rag/knowledge-bases' && request.method === 'POST') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const base = { id: knowledgeBaseId, name: input.name, description: input.description }
    knowledgeBases = [base]
    response.end(JSON.stringify({ code: 0, data: base }))
  } else if (request.url === `/api/rag/knowledge-bases/${knowledgeBaseId}/documents` && request.method === 'POST') {
    response.end(JSON.stringify({ code: 0, data: { id: '2a000000-0000-4000-8000-000000000006', knowledge_base_id: knowledgeBaseId, source_name: 'notes.txt' } }))
  } else if (request.url?.startsWith(`/api/rag/knowledge-bases/${knowledgeBaseId}/documents/`) && request.url.endsWith('/versions') && request.method === 'POST') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const uploaded = Buffer.concat(chunks).toString('utf8')
    assert.match(uploaded, /name="notes\.txt"/u, 'selected local file should be sent as a named multipart upload')
    assert.match(String(request.headers['content-type']), /multipart\/form-data; boundary=/u)
    uploadedFiles++
    response.end(JSON.stringify({ code: 0, data: { id: 'version-1', ingestion_state: 'QUEUED' } }))
  } else if (request.url === '/api/agent/tasks' && request.method === 'GET') {
    response.end(JSON.stringify({ code: 0, data: { items: [], nextCursor: null } }))
  } else if (request.url === '/api/agent/tasks' && request.method === 'POST') {
    if (request.headers.authorization !== 'Bearer test-access-token') authenticatedTaskRequests = -1
    else authenticatedTaskRequests++
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const taskInput = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    submittedTaskInput = taskInput
    taskState = taskInput.prompt.includes('approval') ? 'WAITING_APPROVAL'
      : taskInput.prompt.includes('unknown') ? 'OUTCOME_UNKNOWN'
        : taskInput.prompt.includes('failed') ? 'FAILED'
          : taskInput.prompt.includes('success') ? 'SUCCEEDED' : 'QUEUED'
    response.end(JSON.stringify({ code: 0, data: { id: 'task-1', state: taskState, prompt: taskInput.prompt,
      promptPreview: '检查本地工作台连接', sessionId: 'session-1', requestId: 'request-1' } }))
  } else if (request.url === '/api/agent/tasks/task-1/cancel' && request.method === 'POST') {
    cancelledTasks++
    taskState = 'CANCELLED'
    response.end(JSON.stringify({ code: 0, data: { id: 'task-1', state: taskState, prompt: '检查本地工作台连接' } }))
  } else if (request.url === '/api/agent/tasks/task-1/recover' && request.method === 'POST') {
    recoveredTasks++
    taskState = 'RUNNING'
    response.end(JSON.stringify({ code: 0, data: { id: 'task-1', state: taskState, prompt: 'unknown task' } }))
  } else if (request.url?.startsWith('/api/agent/tasks/task-1/events')) {
    response.end(JSON.stringify({ code: 0, data: [] }))
  } else if (request.url === '/api/agent/tasks/task-1/artifacts') {
    response.end(JSON.stringify({ code: 0, data: [] }))
  } else if (request.url === '/api/agent/tasks/task-1') {
    response.end(JSON.stringify({ code: 0, data: { id: 'task-1', state: taskState, prompt: '检查本地工作台连接' } }))
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
  assert.equal(authenticatedPluginCatalogRequests, 1, 'the workbench should load the authenticated platform plugin catalog')

  await window.getByRole('button', { name: /Skills 与插件/u }).click()
  await window.getByText('ledger-export', { exact: true }).waitFor()
  await window.getByRole('button', { name: /我的 Agent/u }).click()
  await window.getByRole('button', { name: /新建角色/u }).click()
  await window.getByLabel('角色名称').fill('Evidence Researcher')
  await window.getByLabel('角色简介').fill('Research and cite internal sources')
  await window.getByLabel('工作方式与指令').fill('Use approved skills and cite every source.')
  await window.locator('.binding-group').nth(0).getByRole('checkbox').check()
  await window.locator('.binding-group').nth(1).getByRole('checkbox').check()
  await window.getByRole('button', { name: '保存角色' }).click()
  await window.getByText('Evidence Researcher', { exact: true }).waitFor()
  assert.equal(savedProfiles.length, 1, 'the profile should persist through the platform profile API')
  assert.deepEqual(savedProfiles[0].skillIds, [skillId])
  assert.deepEqual(savedProfiles[0].pluginIds, [pluginId])

  await window.getByRole('button', { name: /开始工作/u }).click()
  await window.locator('.task-composer select').selectOption(savedProfiles[0].id)
  await window.locator('input[type="file"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('private local notes') })
  await window.getByRole('button', { name: /安全上传/u }).click()
  await window.getByText('已将 1 个文件提交到平台知识库').waitFor()
  assert.equal(uploadedFiles, 1, 'the selected local file should upload to the authorized HyperWeave knowledge base')

  await window.locator('textarea.prompt').fill('检查本地工作台连接')
  await window.getByRole('button', { name: /提交任务/u }).click()
  await window.getByText('PLATFORM TASK · task-1').waitFor()
  assert.equal(authenticatedTaskRequests, 1, 'task submission should use the authenticated platform session')
  assert.equal(submittedTaskInput.agentProfileId, savedProfiles[0].id, 'task submissions should include the selected role profile')
  assert.deepEqual(submittedTaskInput.knowledgeBaseIds, [knowledgeBaseId], 'task submissions should include the selected knowledge scope')
  await window.getByRole('button', { name: '停止任务' }).click()
  await window.locator('.task-detail-head .status-pill').filter({ hasText: '已取消' }).waitFor()
  assert.equal(cancelledTasks, 1, 'the workbench should submit task cancellation to HyperWeave')

  await window.getByRole('button', { name: '开始工作' }).click()
  await window.locator('textarea.prompt').fill('recover unknown task state')
  await window.getByRole('button', { name: /提交任务/u }).click()
  await window.getByRole('button', { name: '恢复任务状态' }).waitFor()
  await window.getByRole('button', { name: '恢复任务状态' }).click()
  await window.locator('.task-detail-head .status-pill').filter({ hasText: '执行中' }).waitFor()
  assert.equal(recoveredTasks, 1, 'unknown outcomes should expose the platform recovery operation')

  await window.getByRole('button', { name: '开始工作' }).click()
  await window.locator('textarea.prompt').fill('approval-gated task')
  await window.getByRole('button', { name: /提交任务/u }).click()
  await window.getByText('这项任务需要租户管理员审批').waitFor()
  assert.equal(await window.getByRole('button', { name: '批准继续' }).count(), 0,
    'non-admin users must not be offered an approval action')

  await window.getByRole('button', { name: '开始工作' }).click()
  await window.locator('textarea.prompt').fill('failed task')
  await window.getByRole('button', { name: /提交任务/u }).click()
  await window.locator('.task-detail-head .status-pill').filter({ hasText: '失败' }).waitFor()
  assert.equal(await window.locator('.followup').count(), 0,
    'failed tasks must not offer follow-up when the platform contract only accepts successful tasks')

  await window.getByRole('button', { name: '开始工作' }).click()
  await window.locator('textarea.prompt').fill('successful task')
  await window.getByRole('button', { name: /提交任务/u }).click()
  await window.locator('.task-detail-head .status-pill').filter({ hasText: '已完成' }).waitFor()
  await window.locator('.followup').waitFor()

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
