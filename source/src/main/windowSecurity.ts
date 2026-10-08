import { ipcMain, shell, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'

export function sameRendererDocument(actual: string, expected: string): boolean {
  try {
    const candidate = new URL(actual), trusted = new URL(expected)
    candidate.hash = ''; trusted.hash = ''
    return candidate.href === trusted.href
  } catch { return false }
}

export function protectMainWindow(window: BrowserWindow, rendererUrl: string): void {
  const allowed = (url: string) => sameRendererDocument(url, rendererUrl)
  window.webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault() })
  window.webContents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault() })
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) void shell.openExternal(parsed.href).catch(() => {})
    } catch { /* Invalid links do not leave the application. */ }
    return { action: 'deny' }
  })
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.webContents.session.setPermissionCheckHandler(() => false)
}

export function trustedIpc(getWindow: () => BrowserWindow | null, enabled: boolean, rendererUrl: string) {
  const accepts = (event: IpcMainEvent | IpcMainInvokeEvent) => {
    if (!enabled) return true
    const window = getWindow()
    return !!window && !window.isDestroyed() && event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame && sameRendererDocument(event.senderFrame.url, rendererUrl)
  }
  const handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!accepts(event)) throw new Error('拒绝来自非应用主页面的请求')
      return listener(event, ...args)
    })
  }
  const on = (channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void) => {
    ipcMain.on(channel, (event, ...args) => { if (accepts(event)) listener(event, ...args) })
  }
  const syncHandler = (channel: string, listener: (event: IpcMainEvent, ...args: any[]) => unknown) => {
    ipcMain.on(channel, (event, ...args) => {
      let reply: {ok:boolean;value?:unknown;error?:string}
      try {
        if (!accepts(event)) throw Error('拒绝来自非应用主页面的请求')
        const value = listener(event, ...args)
        if (value && typeof (value as {then?:unknown}).then === 'function') throw Error('同步 IPC 不支持异步处理')
        reply = {ok:true,value}
      } catch (error) {
        reply = {ok:false,error:error instanceof Error && error.message ? error.message : '操作未完成'}
      }
      event.returnValue = reply
    })
  }
  return { handle, on, syncHandler }
}
