import { useEffect, useRef } from 'react'
import type { AppEventName, AppEvents, IpcChannel, IpcInput, IpcOutput } from '@shared/ipc'

type Args<C extends IpcChannel> = IpcInput<C> extends void | undefined ? [] : [input: IpcInput<C>]

/** Calls a main-process handler and unwraps its {ok, data | error} envelope, throwing on failure. */
export async function call<C extends IpcChannel>(channel: C, ...args: Args<C>): Promise<IpcOutput<C>> {
  const result = await window.qaHub.invoke(channel, args[0])
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

/** Subscribes to a main-process push event for the lifetime of the component. */
export function useAppEvent<E extends AppEventName>(event: E, listener: (payload: AppEvents[E]) => void): void {
  const latest = useRef(listener)
  useEffect(() => {
    latest.current = listener
  })
  useEffect(() => window.qaHub.on(event, (payload) => latest.current(payload)), [event])
}
