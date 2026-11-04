/** Explicit opt-in acceptance against a local, real HyperWeave deployment. Creates test data. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const platformUrl = new URL(process.env.HYPERWEAVE_PLATFORM_URL || 'http://127.0.0.1:28089')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(platformUrl.hostname), 'Live acceptance requires a local test deployment')
assert.ok(process.env.HYPERWEAVE_TEST_CREDENTIALS, 'Provide the local acceptance credential file')
assert.ok(process.env.HYPERWEAVE_TEST_PDF, 'Provide a synthetic PDF containing the expected marker')
const credentials = JSON.parse(await readFile(process.env.HYPERWEAVE_TEST_CREDENTIALS, 'utf8'))
const fixture = resolve(process.env.HYPERWEAVE_TEST_PDF)
const expected = process.env.HYPERWEAVE_TEST_EXPECTED || 'ORCHID-739'
const evidence = resolve(process.env.HYPERWEAVE_TEST_EVIDENCE || join(root, '.desktop-next', 'live-evidence'))
await mkdir(evidence, { recursive: true })
const temp = await mkdtemp(join(tmpdir(), 'hyperweave-live-'))
const env = { ...process.env, HYPERWEAVE_PLATFORM_URL: platformUrl.origin }
delete env.ELECTRON_RUN_AS_NODE
// Credentials remain in this test process; the application receives them through its login form.
delete env.HYPERWEAVE_TEST_CREDENTIALS
const require = createRequire(join(root, 'package.json'))
let app
try {
  app = await electron.launch({ executablePath: require('electron'),
    args: [join(root, 'lib', 'hyperweave-main.js'), `--user-data-dir=${join(temp, 'user-data')}`], env })
  const page = await app.firstWindow()
  page.setDefaultTimeout(30_000)
  await page.locator('input[type="email"]').fill(credentials.userEmail)
  await page.locator('input[type="password"]').fill(credentials.userPassword)
  await page.getByRole('button', { name: /登录 HyperWeave/u }).click()
  await page.getByRole('heading', { name: '今天想完成什么？' }).waitFor()
  console.log('Real platform login passed')
  const name = `Desktop live researcher ${Date.now()}`
  await page.getByRole('button', { name: /我的 Agent/u }).click()
  await page.getByRole('button', { name: /新建角色/u }).click()
  await page.getByLabel('角色名称').fill(name)
  await page.getByLabel('角色简介').fill('Synthetic PDF acceptance')
  await page.getByLabel('工作方式与指令').fill('Read selected knowledge sources and cite evidence for the project code name.')
  await page.getByRole('button', { name: '保存角色' }).click()
  await page.getByText(name, { exact: true }).waitFor()
  const profile = await page.evaluate(async name =>
    (await window.hyperweave.request({ path: '/api/agent/profiles' })).find(p => p.name === name), name)
  assert.ok(profile?.id)
  assert.equal(profile.role_description, 'Synthetic PDF acceptance')
  await page.reload()
  await page.getByRole('heading', { name: '今天想完成什么？' }).waitFor()
  await page.locator('.task-composer select').selectOption(profile.id)
  // Upload to a new workspace to prove this task reads the desktop-uploaded file.
  for (const checkbox of await page.locator('.scope-option input').all()) await checkbox.uncheck()
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await page.getByRole('button', { name: /安全上传/u }).click()
  await page.getByText('已将 1 个文件提交到平台知识库').waitFor()
  const baseId = await page.locator('.upload-destination select').inputValue()
  assert.ok(baseId)
  await page.waitForFunction(async baseId => {
    const docs = await window.hyperweave.request({ path: `/api/rag/knowledge-bases/${baseId}/documents` })
    return docs.some(d => d.ingestion_state === 'SUCCEEDED' && d.version_state === 'READY')
  }, baseId, { timeout: 180_000, polling: 2000 })
  console.log('Role persistence and desktop PDF upload/indexing passed')
  await page.locator('textarea.prompt').fill(`Search knowledge base ${baseId} for the project code name. Return the exact code with its source citation.`)
  await page.getByRole('button', { name: /提交任务/u }).click()
  await page.locator('.task-detail-head .status-pill').filter({ hasText: '已完成' }).waitFor({ timeout: 260_000 })
  const result = await page.locator('.result-block pre').innerText()
  assert.ok(result.includes(expected), 'The sandbox task must return the marker from the uploaded document')
  assert.ok(result.includes('[source:'), 'The result must cite the uploaded evidence')
  const download = join(temp, 'result.txt')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, download)
  await page.getByRole('button', { name: '保存结果 ↓' }).click()
  let saved
  for (let i = 0; i < 50; i++) {
    try { saved = await readFile(download, 'utf8'); break } catch { await new Promise(r => setTimeout(r, 100)) }
  }
  assert.equal(saved, result)
  await page.screenshot({ path: join(evidence, 'desktop-task-result.png'), fullPage: true })
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ platform: platformUrl.origin,
    profileId: profile.id, knowledgeBaseId: baseId, result, verifiedAt: new Date().toISOString(),
    checks: ['login', 'profile persistence', 'PDF upload and indexing', 'scoped sandbox task', 'cited result display', 'save result'] }, null, 2))
  console.log('Real Electron task execution, cited result display, and result download passed')
} catch (error) {
  if (app) {
    const page = await app.firstWindow()
    await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => {})
    console.error('Workbench notice:', await page.locator('.notice').allTextContents().catch(() => []))
  }
  throw error
} finally {
  if (app) await app.close()
  await rm(temp, { recursive: true, force: true })
}
