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
const skillId = process.env.HYPERWEAVE_TEST_SKILL_ID
const interactive = process.env.HYPERWEAVE_TEST_INTERACTIVE === '1'
if (interactive) assert.ok(skillId && credentials.adminEmail && credentials.adminPassword,
  'Interactive acceptance requires an approval-requiring Skill and a separate test administrator')
const evidence = resolve(process.env.HYPERWEAVE_TEST_EVIDENCE || join(root, '.desktop-next', 'live-evidence'))
await mkdir(evidence, { recursive: true })
const temp = await mkdtemp(join(tmpdir(), 'hyperweave-live-'))
const env = { ...process.env, HYPERWEAVE_PLATFORM_URL: platformUrl.origin }
delete env.ELECTRON_RUN_AS_NODE
// Credentials remain in this test process; the application receives them through its login form.
delete env.HYPERWEAVE_TEST_CREDENTIALS
const require = createRequire(join(root, 'package.json'))
let app
let adminApp
try {
  app = await electron.launch({ executablePath: require('electron'),
    args: [join(root, 'lib', 'hyperweave-main.js'), `--user-data-dir=${join(temp, 'user-data')}`], env })
  const page = await app.firstWindow()
  page.setDefaultTimeout(30_000)
  async function waitForTaskStatus(expected, timeout = 180_000) {
    await page.waitForFunction(expected => {
      const status = document.querySelector('.task-detail-head .status-pill')?.textContent
      return [expected, '失败', '已取消', '待核对'].includes(status)
    }, expected, { timeout })
    assert.equal(await page.locator('.task-detail-head .status-pill').innerText(), expected,
      'The task reached an unexpected terminal state')
  }
  async function selectedTaskId() {
    const label = await page.locator('.task-detail-head .eyebrow').innerText()
    const prefix = label.split(' · ').at(-1)
    const id = await page.evaluate(async prefix => {
      const response = await window.hyperweave.request({ path: '/api/agent/tasks' })
      return (Array.isArray(response) ? response : response.items).find(t => t.id.startsWith(prefix))?.id
    }, prefix)
    assert.ok(id, 'The displayed task must be persisted by the platform')
    return id
  }
  await page.locator('input[type="email"]').fill(credentials.userEmail)
  await page.locator('input[type="password"]').fill(credentials.userPassword)
  await page.getByRole('button', { name: /登录 HyperWeave/u }).click()
  await page.getByRole('heading', { name: '今天想完成什么？' }).waitFor()
  console.log('Real platform login passed')
  const skill = skillId ? await page.evaluate(async id =>
    (await window.hyperweave.request({ path: '/api/skills' })).find(s => s.id === id), skillId) : null
  if (skillId) assert.ok(skill?.enabled && skill.active_version, 'Provide an enabled published test Skill')
  const name = `Desktop live researcher ${Date.now()}`
  await page.getByRole('button', { name: /我的 Agent/u }).click()
  await page.getByRole('button', { name: /新建角色/u }).click()
  await page.getByLabel('角色名称').fill(name)
  await page.getByLabel('角色简介').fill('Synthetic PDF acceptance')
  await page.getByLabel('工作方式与指令').fill('Read selected knowledge sources and cite evidence for the project code name.')
  if (skill) await page.locator('.binding-group').first().getByLabel(skill.name, { exact: false }).check()
  await page.getByRole('button', { name: '保存角色' }).click()
  await page.getByText(name, { exact: true }).waitFor()
  const profile = await page.evaluate(async name =>
    (await window.hyperweave.request({ path: '/api/agent/profiles' })).find(p => p.name === name), name)
  assert.ok(profile?.id)
  assert.equal(profile.role_description, 'Synthetic PDF acceptance')
  if (skillId) assert.deepEqual(profile.skill_ids, [skillId])
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
  const prompt = skillId
    ? `Use skill_execute with skillId ${skillId}, capability knowledge.search and input {"knowledgeBaseId":"${baseId}","query":"project code name","recallLimit":10,"resultLimit":5}. Use this Skill to retrieve the evidence. Return the exact code with its source citation.`
    : `Search knowledge base ${baseId} for the project code name. Return the exact code with its source citation.`
  const interaction = interactive
    ? `I need a cited answer from the selected knowledge base ${baseId}, using the ${skill.name} Skill attached to this role. I will supply the search question in my next reply; ask me for that question using request_user_input before retrieving anything. Follow the platform approval process for the Skill. After retrieving the evidence, provide the answer with its source citation and a downloadable plain text file named desktop-evidence.txt containing the project code.`
    : prompt
  await page.locator('textarea.prompt').fill(interaction)
  await page.getByRole('button', { name: /提交任务/u }).click()
  if (interactive) {
    await waitForTaskStatus('等待补充')
    await page.getByPlaceholder('输入补充信息').fill('What is the project code name? Please retrieve the evidence using the bound Skill.')
    await page.getByRole('button', { name: '提交补充信息' }).click()
    await waitForTaskStatus('等待审批')
    assert.equal(await page.getByRole('button', { name: '批准继续' }).count(), 0,
      'An ordinary user must not approve their own task')
    const id = await selectedTaskId()
    // A separate administrator session discovers and approves the task in the desktop.
    adminApp = await electron.launch({ executablePath: require('electron'),
      args: [join(root, 'lib', 'hyperweave-main.js'), `--user-data-dir=${join(temp, 'admin-user-data')}`], env })
    const adminPage = await adminApp.firstWindow()
    adminPage.setDefaultTimeout(30_000)
    await adminPage.locator('input[type="email"]').fill(credentials.adminEmail)
    await adminPage.locator('input[type="password"]').fill(credentials.adminPassword)
    await adminPage.getByRole('button', { name: /登录 HyperWeave/u }).click()
    await adminPage.getByRole('heading', { name: '今天想完成什么？' }).waitFor()
    await adminPage.getByRole('button', { name: /任务记录/u }).click()
    await adminPage.locator('.approval-queue .task-list-item').filter({ hasText: id }).click()
    await adminPage.getByRole('button', { name: '批准继续' }).waitFor()
    assert.equal(await adminPage.getByRole('button', { name: '停止任务' }).count(), 0,
      'Reviewing another user task must not offer owner-only actions')
    await adminPage.screenshot({ path: join(evidence, 'desktop-approval.png'), fullPage: true })
    await adminPage.getByRole('button', { name: '批准继续' }).click()
    await adminPage.locator('.approval-queue .task-list-item').filter({ hasText: id }).waitFor({ state: 'detached' })
    console.log('Real task input and separate administrator desktop approval passed')
  }
  await waitForTaskStatus('已完成', 260_000)
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
  if (interactive) {
    const artifactPath = join(temp, 'desktop-evidence.txt')
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, artifactPath)
    await page.locator('.artifact-block').getByRole('button', { name: '下载 ↓' }).first().click()
    let artifact
    for (let i = 0; i < 50; i++) {
      try { artifact = await readFile(artifactPath, 'utf8'); break } catch { await new Promise(r => setTimeout(r, 100)) }
    }
    assert.ok(artifact?.includes(expected), 'The downloaded artifact must contain the retrieved project code')
    console.log('Real sandbox artifact publication and desktop download passed')
  }
  const taskId = await selectedTaskId()
  await page.screenshot({ path: join(evidence, 'desktop-task-result.png'), fullPage: true })
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ platform: platformUrl.origin,
    profileId: profile.id, knowledgeBaseId: baseId, skillId, taskId, result, verifiedAt: new Date().toISOString(),
    checks: ['login', 'profile persistence', 'PDF upload and indexing', 'scoped sandbox task', 'cited result display', 'save result',
      ...(skillId ? ['Skill binding persistence'] : []),
      ...(interactive ? ['task input', 'separate administrator desktop approval', 'artifact publication and download'] : [])] }, null, 2))
  console.log('Real Electron task execution, cited result display, and result download passed')
} catch (error) {
  if (app) {
    const page = await app.firstWindow()
    await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => {})
    await writeFile(join(evidence, 'failure.json'), JSON.stringify({ status: 'failed',
      message: error.message, verifiedAt: new Date().toISOString(),
      taskLabel: await page.locator('.task-detail-head .eyebrow').textContent().catch(() => null),
      taskState: await page.locator('.task-detail-head .status-pill').textContent().catch(() => null) }, null, 2))
    console.error('Workbench notice:', await page.locator('.notice').allTextContents().catch(() => []))
  }
  throw error
} finally {
  if (adminApp) await adminApp.close()
  if (app) await app.close()
  await rm(temp, { recursive: true, force: true })
}
