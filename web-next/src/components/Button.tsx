import type { ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'ink'
/** `lg` and `marketing` are the same 48px hero/CTA size. */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'marketing'

interface ButtonProps {
  /** Label. Either `text` or `children` (children wins when both are set). */
  text?: string
  children?: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  variant?: ButtonVariant
  size?: ButtonSize
  /** Full width. */
  block?: boolean
  className?: string
  disabled?: boolean
}

const base =
  'inline-flex items-center justify-center gap-2 border font-sans font-semibold leading-none whitespace-nowrap no-underline cursor-pointer transition-[scale,color,background-color,border-color,box-shadow] duration-[350ms,150ms,150ms,150ms,150ms] ease-(--spring-snappy) hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100'

const variants: Record<ButtonVariant, string> = {
  primary:
    'border-accent bg-accent text-on-accent shadow-md hover:border-accent-hover hover:bg-accent-hover hover:text-on-accent hover:shadow-[0_0_0_1px_var(--color-accent-glow),0_0_24px_-4px_var(--color-accent-glow),0_10px_15px_-3px_rgba(0,0,0,0.1)]',
  secondary:
    'border-border-input bg-surface0 text-text hover:border-accent hover:text-accent-ink',
  ghost:
    'border-transparent bg-transparent text-subtext1 hover:bg-surface1 hover:text-accent-ink',
  ink: 'border-text bg-text text-(--color-base) hover:border-subtext1 hover:bg-subtext1',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 rounded-md px-3 text-[13px]',
  md: 'h-10 rounded-lg px-4 text-sm',
  lg: 'h-12 rounded-lg px-6 text-[15px]',
  marketing: 'h-12 rounded-lg px-6 text-[15px]',
}

/**
 * The button classes on their own, for a `<Link>` or `<a>` that should look
 * like a Button: `<Link className={buttonClasses({ variant: 'primary' })}>`.
 */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  block = false,
  className = '',
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  className?: string
} = {}): string {
  return `${base} ${variants[variant]} ${sizes[size]} ${block ? 'w-full' : ''} ${className}`
}

export default function Button({
  text,
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  size = 'md',
  block = false,
  className = '',
  disabled = false,
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={buttonClasses({ variant, size, block, className })}
    >
      {children ?? text}
    </button>
  )
}
