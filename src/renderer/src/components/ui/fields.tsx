import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const control =
  'w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(control, 'h-8', className)} {...props} />
))
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, rows = 3, ...props }, ref) => (
  <textarea ref={ref} rows={rows} className={cn(control, 'resize-y py-1.5 leading-normal', className)} {...props} />
))
Textarea.displayName = 'Textarea'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(control, 'h-8 pr-7', className)} {...props} />
))
Select.displayName = 'Select'

interface FieldProps {
  label: string
  hint?: ReactNode
  error?: string
  className?: string
  children: (id: string) => ReactNode
}

/** Label + control + hint, wired together with a generated id. */
export function Field({ label, hint, error, className, children }: FieldProps): React.JSX.Element {
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-[12px] font-medium text-muted">
        {label}
      </label>
      {children(id)}
      {error ? <p className="text-[12px] text-fail">{error}</p> : hint ? <p className="text-[12px] text-faint">{hint}</p> : null}
    </div>
  )
}
