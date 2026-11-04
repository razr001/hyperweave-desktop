import { app, BrowserWindow, dialog, ipcMain, safeStorage, session } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAllowedPlatformRequest } from './request-policy.js'
import { HyperWeaveAgentProvider, type AgentTaskInput } from './agent-runtime.js'

interface ClientSettings { platformUrl: string }
interface StoredTokens { accessToken: string; refreshToken: string }
interface UploadInput { path: string; name: string; mediaType: string; bytes: Uint8Array }
const SETTINGS_FILE = 'hyperweave-desktop.json'
const TOKENS_FILE = 'hyperweave-session.bin'
let platformUrl = ''
let tokens: StoredTokens | undefined

function tokenPath(): string { return join(app.getPath('userData'), TOKENS_FILE) }

async function loadTokens(): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) return
  try {
    tokens = JSON.parse(safeStorage.decryptString(await readFile(tokenPath()))) as StoredTokens
    if (typeof tokens.accessToken !== 'string' || typeof tokens.refreshToken !== 'string') tokens = undefined
  } catch { tokens = undefined }
}

async function saveTokens(value: StoredTokens): Promise<void> {
  tokens = value
  if (safeStorage.isEncryptionAvailable()) {
    await writeFile(tokenPath(), safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 })
  }
}

async function clearTokens(): Promise<void> {
  tokens = undefined
  await rm(tokenPath(), { force: true })
}

function validatePlatformUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new TypeError('HyperWeave 地址必须使用 HTTPS')
  }
  if (url.username || url.password || url.search || url.hash) throw new TypeError('HyperWeave 地址不能包含凭据、查询参数或片段')
  return url
}

async function readSettings(): Promise<ClientSettings | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(app.getPath('userData'), SETTINGS_FILE), 'utf8')) as ClientSettings
    return { platformUrl: validatePlatformUrl(parsed.platformUrl).toString().replace(/\/$/u, '') }
  } catch { return undefined }
}

async function configurePlatform(): Promise<string | undefined> {
  const existing = await readSettings()
  const configured = process.env.HYPERWEAVE_PLATFORM_URL
  if (configured) return validatePlatformUrl(configured).toString().replace(/\/$/u, '')
  if (existing) return existing.platformUrl
  await dialog.showMessageBox({
    type: 'info', title: '连接 HyperWeave', message: '请联系管理员获取 HyperWeave 平台地址。',
    detail: '此客户端只连接管理员配置的 HyperWeave 平台，不访问外部服务。', buttons: ['退出'], defaultId: 0,
  })
  app.quit()
  return undefined
}

function applicationRoot(): string {
  return app.isPackaged ? app.getAppPath() : dirname(dirname(fileURLToPath(import.meta.url)))
}

function createPlatformWindow(platformUrl: string): BrowserWindow {
  const origin = new URL(platformUrl).origin
  const root = applicationRoot()
  const uiRoot = app.isPackaged ? join(root, 'ui') : join(root, 'dist', 'hyperweave-ui')
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !isAllowedPlatformRequest(origin, details.url, uiRoot) })
  })
  const preloadPath = join(root, 'preload.cjs')
  const window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1024, minHeight: 680, show: false,
    title: 'HyperWeave', backgroundColor: '#0d1922', autoHideMenuBar: true,
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false },
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, target) => {
    try {
      const next = new URL(target)
      if (next.protocol !== 'file:' || !isAllowedPlatformRequest(origin, target, uiRoot)) event.preventDefault()
    }
    catch { event.preventDefault() }
  })
  window.webContents.on('will-redirect', (event, target) => {
    if (!isAllowedPlatformRequest(origin, target, uiRoot)) event.preventDefault()
  })
  const uiPath = join(uiRoot, 'index.html')
  void window.loadFile(uiPath).catch(error => console.error('Failed to load local HyperWeave workbench', error))
  return window
}

async function requestPlatform(path: string, init: RequestInit = {}, retryAuth = true): Promise<unknown> {
  if (!path.startsWith('/api/') || path.startsWith('//')) throw new TypeError('仅允许 HyperWeave /api 接口')
  const target = new URL(path, platformUrl)
  if (target.origin !== new URL(platformUrl).origin) throw new TypeError('请求地址超出管理员配置的平台')
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  const publicAuthPath = path.includes('/tenant/auth/login') || path.includes('/tenant/auth/refresh')
  if (tokens?.accessToken && !publicAuthPath) {
    headers.set('Authorization', `Bearer ${tokens.accessToken}`)
  }
  const response = await fetch(target, { ...init, headers, redirect: 'manual' })
  if (response.status >= 300 && response.status < 400) throw new Error('平台接口拒绝跨站重定向')
  if (response.status === 401 && retryAuth && tokens?.refreshToken && !publicAuthPath) {
    const refreshed = await requestPlatform('/api/tenant/auth/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokens.refreshToken }),
    }, false) as { access_token?: string; refresh_token?: string }
    if (!refreshed.access_token || !refreshed.refresh_token) {
      await clearTokens()
      throw new Error('登录已失效，请重新登录')
    }
    await saveTokens({ accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token })
    return requestPlatform(path, init, false)
  }
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message.slice(0, 1000) || `HyperWeave 请求失败 (${response.status})`)
  }
  const payload = await response.json() as { code?: number; message?: string; data?: unknown }
  if (typeof payload?.code === 'number') {
    if (payload.code !== 0) throw new Error(payload.message || 'HyperWeave 拒绝了请求')
    return payload.data
  }
  return payload
}

async function savePlatformArtifact(path: string, fileName: string, retryAuth = true): Promise<boolean> {
  if (!path.startsWith('/api/') || path.startsWith('//')) throw new TypeError('仅允许 HyperWeave /api 接口')
  const target = new URL(path, platformUrl)
  if (target.origin !== new URL(platformUrl).origin) throw new TypeError('请求地址超出管理员配置的平台')
  // Result endpoints produce text/plain; artifacts may use their original MIME type.
  const headers = new Headers({ Accept: '*/*' })
  if (tokens?.accessToken) headers.set('Authorization', `Bearer ${tokens.accessToken}`)
  const response = await fetch(target, { headers, redirect: 'manual' })
  if (response.status >= 300 && response.status < 400) throw new Error('平台接口拒绝跨站重定向')
  if (response.status === 401 && retryAuth && tokens?.refreshToken) {
    const refreshed = await requestPlatform('/api/tenant/auth/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokens.refreshToken }),
    }, false) as { access_token?: string; refresh_token?: string }
    if (!refreshed.access_token || !refreshed.refresh_token) {
      await clearTokens()
      throw new Error('登录已失效，请重新登录')
    }
    await saveTokens({ accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token })
    return savePlatformArtifact(path, fileName, false)
  }
  if (!response.ok) throw new Error(`下载失败 (${response.status})`)
  const safeName = basename(fileName).replace(/[\\/:*?"<>|]/gu, '_') || 'HyperWeave-artifact'
  const choice = await dialog.showSaveDialog({ defaultPath: safeName, title: '保存 HyperWeave 产物' })
  if (choice.canceled || !choice.filePath) return false
  await writeFile(choice.filePath, Buffer.from(await response.arrayBuffer()))
  return true
}

function registerPlatformIpc(): void {
  const agentProvider = new HyperWeaveAgentProvider({
    request: async <T,>(path: string, init?: RequestInit) => await requestPlatform(path, init) as T,
  })
  ipcMain.handle('hyperweave:session', async () => {
    if (!tokens) return null
    try { return await requestPlatform('/api/tenant/auth/me') }
    catch (error) {
      if (error instanceof Error && /登录已失效/u.test(error.message)) return null
      throw error
    }
  })
  ipcMain.handle('hyperweave:login', async (_event, credentials: { email: string; password: string }) => {
    if (typeof credentials?.email !== 'string' || typeof credentials?.password !== 'string') throw new TypeError('请输入邮箱和密码')
    const session = await requestPlatform('/api/tenant/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials),
    }) as { access_token?: string; refresh_token?: string; user?: unknown }
    if (!session.access_token || !session.refresh_token || !session.user) throw new Error('平台登录响应无效')
    await saveTokens({ accessToken: session.access_token, refreshToken: session.refresh_token })
    return session.user
  })
  ipcMain.handle('hyperweave:logout', async () => { await clearTokens() })
  ipcMain.handle('hyperweave:request', async (_event, input: { path: string; method?: string; body?: unknown; headers?: Record<string, string> }) => {
    if (typeof input?.path !== 'string') throw new TypeError('缺少 API 路径')
    const headers = new Headers(input.headers)
    let body: BodyInit | undefined
    if (input.body !== undefined) {
      headers.set('Content-Type', 'application/json')
      body = JSON.stringify(input.body)
    }
    return requestPlatform(input.path, { method: input.method ?? 'GET', headers, body })
  })
  ipcMain.handle('hyperweave:submit-task', async (_event, input: AgentTaskInput) => {
    if (!input || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 100_000
      || typeof input.sessionId !== 'string' || typeof input.requestId !== 'string'
      || (input.knowledgeBaseIds !== undefined && (!Array.isArray(input.knowledgeBaseIds)
        || input.knowledgeBaseIds.length > 100 || input.knowledgeBaseIds.some(id => typeof id !== 'string')))) {
      throw new TypeError('Agent 任务参数无效')
    }
    return agentProvider.submit(input)
  })
  ipcMain.handle('hyperweave:upload', async (_event, input: UploadInput) => {
    if (!(input?.bytes instanceof Uint8Array) || typeof input.name !== 'string' || input.bytes.length > 104_857_600) {
      throw new TypeError('资料文件无效或超过 100 MB 限制')
    }
    const form = new FormData()
    const fileBytes = input.bytes.buffer.slice(input.bytes.byteOffset, input.bytes.byteOffset + input.bytes.byteLength) as ArrayBuffer
    form.append('file', new Blob([fileBytes], { type: input.mediaType || 'application/octet-stream' }), basename(input.name))
    return requestPlatform(input.path, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: form }, true)
  })
  ipcMain.handle('hyperweave:download', async (_event, input: { path: string; fileName: string }) => {
    if (typeof input?.path !== 'string' || typeof input?.fileName !== 'string') throw new TypeError('产物信息无效')
    return savePlatformArtifact(input.path, input.fileName)
  })
}

async function launch(): Promise<void> {
  await app.whenReady()
  let configuredUrl: string | undefined
  try { configuredUrl = await configurePlatform() }
  catch (error) {
    await dialog.showMessageBox({ type: 'error', title: '平台地址无效', message: error instanceof Error ? error.message : String(error) })
    app.quit(); return
  }
  if (!configuredUrl) return
  platformUrl = configuredUrl
  registerPlatformIpc()
  await loadTokens()
  createPlatformWindow(configuredUrl)
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createPlatformWindow(platformUrl!) })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}

void launch()
