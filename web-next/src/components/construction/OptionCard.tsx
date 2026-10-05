import { Check } from 'lucide-react'

/**
 * One selectable card in the quote builder. A native radio or checkbox sits
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
  children: React.ReactNode
}) {
  return (
    <label
      className={`relative flex h-full min-w-0 cursor-pointer flex-col rounded-xl border bg-surface0 p-4 pr-10 shadow-md transition-[border-color,box-shadow] duration-200 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent sm:p-5 sm:pr-11 ${
        checked
          ? 'border-accent ring-2 ring-accent'
          : 'border-overlay0 hover:border-accent/60'
      }`}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only scroll-my-32"
      />
      <span
        aria-hidden="true"
        className={`absolute top-4 right-4 flex h-5 w-5 items-center justify-center border transition-colors ${
          type === 'radio' ? 'rounded-full' : 'rounded-md'
        } ${
          checked
            ? 'border-accent bg-accent text-crust'
            : 'border-overlay1 bg-transparent'
        }`}
      >
        {checked && <Check size={13} strokeWidth={3} />}
      </span>
      {children}
    </label>
  )
}
