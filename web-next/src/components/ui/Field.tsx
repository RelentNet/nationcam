import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

/** Shared control look: 40px, base background, 3:1 input border, orange
 *  focus ring. Exported for controls that cannot use the components. */
export const controlClasses =
  'block w-full min-w-0 rounded-md border border-border-input bg-base px-3 font-sans text-sm text-text transition-[border-color,box-shadow] duration-150 placeholder:text-subtext0 focus:border-accent-fg focus:shadow-[0_0_0_1px_var(--color-accent-fg),0_0_0_4px_var(--color-accent-glow)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60'

interface FieldProps {
  label: ReactNode
  /** id of the control inside, for the label's htmlFor. */
  htmlFor?: string
  /** Adds a mono "Required" tag after the label. */
  required?: boolean
  /** Muted line under the control. */
  hint?: ReactNode
  /** Error line under the control (live red rule). */
  error?: ReactNode
  children: ReactNode
  className?: string
}

/** Label + control + optional hint/error, 6px apart. */
export default function Field({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  children,
  className = '',
}: FieldProps) {
  return (
    <div className={`grid min-w-0 gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-text">
        {label}
        {required && (
          <span className="ml-1.5 font-mono text-[11px] font-normal tracking-[0.02em] text-subtext1 uppercase">
            Required
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <span className="text-xs leading-normal text-subtext1">{hint}</span>
      )}
      {error && (
        <span
          role="alert"
          className="rounded-r-md border-l-2 border-live bg-live-glow px-3 py-2 text-sm font-medium text-text"
        >
          {error}
        </span>
      )}
    </div>
  )
}

export function Input({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${controlClasses} h-10 ${className}`} />
}

export function Select({
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`${controlClasses} h-10 appearance-none bg-[linear-gradient(45deg,transparent_50%,var(--color-subtext1)_50%),linear-gradient(135deg,var(--color-subtext1)_50%,transparent_50%)] bg-[length:5px_5px] bg-[position:calc(100%-18px)_50%,calc(100%-13px)_50%] bg-no-repeat pr-9 ${className}`}
    >
      {children}
    </select>
  )
}

export function Textarea({
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${controlClasses} min-h-[104px] resize-y py-2.5 leading-normal ${className}`}
    />
  )
}
