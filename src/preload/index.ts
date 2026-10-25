import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

// The renderer gets exactly two capabilities: invoke a named main-process handler and subscribe to app events.
// Input validation happens in main; this only refuses malformed channel names.
const CHANNEL = /^[a-z]+:[a-zA-Z]+$/
const EVENTS = new Set(['ai:event', 'docs:changed'])

const api = {
  invoke(channel: string, input?: unknown): Promise<unknown> {
    if (!CHANNEL.test(channel)) return Promise.reject(new Error(`Unknown channel: ${channel}`))
    return ipcRenderer.invoke(channel, input)
  },
  on(event: string, listener: (payload: unknown) => void): () => void {
    if (!EVENTS.has(event)) throw new Error(`Unknown event: ${event}`)
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('qaHub', api)
