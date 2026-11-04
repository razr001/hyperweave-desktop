import { app, BrowserWindow, dialog, session } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isAllowedPlatformRequest } from './request-policy.js'

interface ClientSettings { platformUrl: string }
const SETTINGS_FILE = 'hyperweave-desktop.json'

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

function createPlatformWindow(platformUrl: string): BrowserWindow {
  const origin = new URL(platformUrl).origin
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !isAllowedPlatformRequest(origin, details.url) })
  })
  const window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1024, minHeight: 680, show: false,
    title: 'HyperWeave', backgroundColor: '#0d1922', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false },
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, target) => {
    try { if (new URL(target).origin !== origin) event.preventDefault() }
    catch { event.preventDefault() }
  })
  window.webContents.on('will-redirect', (event, target) => {
    try { if (new URL(target).origin !== origin) event.preventDefault() }
    catch { event.preventDefault() }
  })
  void window.loadURL(platformUrl)
  return window
}

async function launch(): Promise<void> {
  await app.whenReady()
  let platformUrl: string | undefined
  try { platformUrl = await configurePlatform() }
  catch (error) {
    await dialog.showMessageBox({ type: 'error', title: '平台地址无效', message: error instanceof Error ? error.message : String(error) })
    app.quit(); return
  }
  if (!platformUrl) return
  createPlatformWindow(platformUrl)
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createPlatformWindow(platformUrl!) })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}

void launch()
