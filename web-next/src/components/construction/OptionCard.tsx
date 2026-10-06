import type { ReactNode } from 'react'

/**
 * The ruled panel that holds a step's options: one radius-xl card, cells
 * separated by hairlines. `className` carries the column classes.
 */
export function OptionGroup({
  className = '',
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={`grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-surface0 ${className}`}
    >
      {children}
    </div>
  )
}

/**
 * One selectable cell in the quote builder. A native radio or checkbox sits
 * inside the label (visually hidden), so arrow keys, Space and screen readers
 * all behave as they do for any radio group or checkbox.
 */
export default function OptionCard({
  type,
  name,
  value,
  checked,
  onChange,
  children,
}: {
  type: 'radio' | 'checkbox'
  name: string
  value: string
  checked: boolean
  onChange: () => void
  children: ReactNode
}) {
  return (
    <label
      className={`group/opt relative flex min-w-0 cursor-pointer flex-col p-5 pb-[18px] transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-4 has-[:focus-visible]:outline-accent-fg ${
        checked
          ? 'z-[1] bg-accent/5 shadow-[inset_0_0_0_1px_var(--color-accent),inset_0_0_0_4px_var(--color-accent-glow),1px_0_0_var(--color-border),0_1px_0_var(--color-border)]'
          : 'rule-cell hover:bg-surface1'
      }`}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="pointer-events-none absolute h-px w-px scroll-my-32 opacity-0"
      />
      <span
        aria-hidden="true"
        className={`absolute top-5 right-5 flex h-[18px] w-[18px] items-center justify-center border ${
          type === 'radio' ? 'rounded-full' : 'rounded-sm'
        } ${
          checked
            ? type === 'radio'
              ? 'border-accent bg-accent shadow-[inset_0_0_0_4px_var(--color-surface0),0_0_0_3px_var(--color-accent-glow)]'
              : 'border-accent bg-accent shadow-[0_0_0_3px_var(--color-accent-glow)]'
            : 'border-border-input bg-transparent'
        }`}
      >
        {checked && type === 'checkbox' && (
          <span className="-mt-px h-2.5 w-[5px] rotate-45 border-r-2 border-b-2 border-on-accent" />
        )}
      </span>
      {children}
    </label>
  )
}
