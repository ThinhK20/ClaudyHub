/** An expected, user-facing failure (bad state, missing resource). Its message is shown as-is. */
export class UserError extends Error {
  override readonly name = 'UserError'
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'Unexpected error'
}
