import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { ipcInputs, type IpcChannel, type IpcOutput, type IpcResult } from '@shared/ipc'
import { UserError, errorMessage } from '../errors'

export type IpcHandlers = {
  [C in IpcChannel]: (input: z.output<(typeof ipcInputs)[C]>) => Promise<IpcOutput<C>> | IpcOutput<C>
}

/**
 * Registers one ipcMain handler per declared channel. Each call is checked for a trusted sender, its input is
 * zod-validated, and the result is wrapped in an {ok, data | error} envelope so errors cross the bridge intact.
 */
export function registerIpc(handlers: IpcHandlers, isTrustedSender: (event: IpcMainInvokeEvent) => boolean): void {
  for (const channel of Object.keys(ipcInputs) as IpcChannel[]) {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<unknown>> => {
      if (!isTrustedSender(event)) return { ok: false, error: { message: 'Untrusted sender' } }
      const parsed = ipcInputs[channel].safeParse(raw)
      if (!parsed.success) {
        return { ok: false, error: { message: `Invalid request: ${z.prettifyError(parsed.error)}` } }
      }
      try {
        const handler = handlers[channel] as (input: unknown) => unknown
        return { ok: true, data: await handler(parsed.data) }
      } catch (error) {
        if (!(error instanceof UserError)) console.error(`[ipc] ${channel} failed`, error)
        return { ok: false, error: { message: errorMessage(error) } }
      }
    })
  }
}
