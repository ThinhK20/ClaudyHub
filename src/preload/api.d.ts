import type { AppEventName, AppEvents, IpcChannel, IpcInput, IpcOutput, IpcResult } from '../shared/ipc'

export interface QaHubBridge {
  invoke<C extends IpcChannel>(channel: C, input?: IpcInput<C>): Promise<IpcResult<IpcOutput<C>>>
  on<E extends AppEventName>(event: E, listener: (payload: AppEvents[E]) => void): () => void
  platform: string
}

declare global {
  interface Window {
    qaHub: QaHubBridge
  }
}
