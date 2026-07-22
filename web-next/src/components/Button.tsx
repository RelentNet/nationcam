interface ButtonProps {
  text: string
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  disabled?: boolean
}

const variants = {
  primary:
    'bg-accent text-crust hover:bg-accent-hover shadow-md hover:shadow-lg',
  secondary:
    'border border-overlay0 bg-transparent text-text hover:border-accent hover:text-accent',
  ghost: 'bg-transparent text-subtext1 hover:text-accent hover:bg-surface0',
}

const sizes = {
  sm: 'px-4 py-1.5 text-sm',
  md: 'px-6 py-2.5 text-sm',
  lg: 'px-8 py-3 text-base',
}

export default function Button({
  text,
  onClick,
  type = 'button',
  variant = 'primary',
  size = 'md',
  className = '',
  disabled = false,
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-lg font-sans font-semibold transition-[scale,color,background-color,border-color,box-shadow,opacity] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {text}
    </button>
  )
}
