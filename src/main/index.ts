import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BrowserWindow, app, dialog, net, protocol, safeStorage, shell, type IpcMainInvokeEvent } from 'electron'
import type { AppEvents } from '@shared/ipc'
import { createAppContext, type AppContext } from './app-context'
import { openDatabase, type Db } from './db/connection'
import { registerIpc } from './ipc/register'

const EVIDENCE_SCHEME = 'qa-evidence'
const WORKSPACE_SCHEME = 'qa-workspace'
const here = path.dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL)

// Tests point the app at a throwaway profile; must happen before 'ready'.
if (process.env.QA_HUB_USER_DATA) app.setPath('userData', process.env.QA_HUB_USER_DATA)

protocol.registerSchemesAsPrivileged([
  { scheme: EVIDENCE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: WORKSPACE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

let mainWindow: BrowserWindow | null = null
let context: AppContext | null = null
let db: Db | null = null

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  if (isDev && process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) return true
  return url.startsWith('file://')
}

// Every window shows the same workspace, so all of them hear app events.
function emit<E extends keyof AppEvents>(event: E, payload: AppEvents[E]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(event, payload)
  }
}

/** In a packaged build the Claude SDK's native CLI lives in app.asar.unpacked (see electron-builder.yml). */
function claudeExecutablePath(): string | undefined {
  if (!app.isPackaged) return undefined
  const binary = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const candidate = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai',
    `claude-agent-sdk-${process.platform}-${process.arch}`,
    binary
  )
  return existsSync(candidate) ? candidate : undefined
}

/** Hash route of a workspace document, as the renderer's router reads it. */
function docRoute(relativePath: string): string {
  return `/library/doc/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

/** The main window, or with `docPath` a document window (`?window=doc`) that keeps its own tabs. */
function createWindow(docPath?: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'QA Hub',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true
    }
  })
  window.once('ready-to-show', () => window.show())
  // Never navigate away from the app or open new windows; web links go to the system browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file://')) event.preventDefault()
  })
  const search = docPath === undefined ? undefined : 'window=doc'
  const hash = docPath === undefined ? undefined : docRoute(docPath)
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (search) url.search = search
    if (hash) url.hash = hash
    void window.loadURL(url.toString())
  } else {
    void window.loadFile(path.join(here, '../renderer/index.html'), { search, hash })
  }
  return window
}

function registerEvidenceProtocol(ctx: AppContext): void {
  // qa-evidence://<runId>/<attachmentId> streams a stored evidence file, looked up by id (never by raw path).
  protocol.handle(EVIDENCE_SCHEME, async (request) => {
    const url = new URL(request.url)
    const runId = url.hostname
    const attachmentId = url.pathname.replace(/^\//, '')
    const file = ctx.evidence.filePath(runId, attachmentId)
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
  // qa-workspace://file/<url-encoded relative path> serves images referenced by workspace documents (images only,
  // and only inside the active workspace).
  protocol.handle(WORKSPACE_SCHEME, async (request) => {
    const relative = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
    const file = ctx.workspaceImage(relative)
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData')
  db = openDatabase(path.join(userData, 'qa-hub.db'))
  context = createAppContext({
    db,
    userDataDir: userData,
    version: app.getVersion(),
    cipher: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
      decrypt: (encoded) => safeStorage.decryptString(Buffer.from(encoded, 'base64'))
    },
    emit,
    pickFolder: async (title) => {
      const options = { title, properties: ['openDirectory' as const] }
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    openExternal: (url) => shell.openExternal(url),
    openDocWindow: (relativePath) => {
      createWindow(relativePath)
    },
    claudeExecutablePath: claudeExecutablePath(),
    stubAi: process.env.QA_HUB_AI_STUB === '1'
  })
  registerIpc(context.handlers, isTrustedSender)
  registerEvidenceProtocol(context)
  mainWindow = createWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  await context.start()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(bootstrap).catch((error: unknown) => {
    console.error('[app] startup failed', error)
    dialog.showErrorBox('QA Hub could not start', error instanceof Error ? error.message : String(error))
    app.quit()
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && context) mainWindow = createWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('will-quit', () => {
    void context?.dispose()
    db?.close()
  })
}
