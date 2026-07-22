import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface DropdownOption {
  value: string | number
  label: string
}

interface DropdownProps {
  label: string
  options: Array<DropdownOption>
  selectedValue: string | number
  onSelect: (val: string | number) => void
}

export default function Dropdown({
  label,
  options,
  selectedValue,
  onSelect,
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selectedLabel =
    options.find((o) => o.value === selectedValue)?.label ?? ''

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={ref} className="relative">
      <label className="mb-1.5 block font-mono text-xs font-medium tracking-wider text-subtext0 uppercase">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="flex w-full items-center justify-between rounded-lg border border-overlay0 bg-surface0 px-4 py-2.5 text-sm text-text transition-[color,border-color,box-shadow] duration-200 hover:border-accent focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
      >
        <span className={selectedLabel ? 'text-text' : 'text-subtext0'}>
          {selectedLabel || `Select ${label.toLowerCase()}`}
        </span>
        <ChevronDown
          size={16}
          className={`text-subtext0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <div
        className={`absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-overlay0 bg-surface0 shadow-xl transition-[clip-path,opacity] duration-350 ease-[var(--spring-smooth)] ${
          open
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none border-transparent opacity-0'
        }`}
        style={{
          clipPath: open ? 'inset(0)' : 'inset(0 0 100% 0)',
        }}
      >
        <ul className="max-h-56 overflow-y-auto py-1">
          {options.map((opt) => (
            <li key={String(opt.value)}>
              <button
                type="button"
                onClick={() => {
                  onSelect(opt.value)
                  setOpen(false)
                }}
                className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                  opt.value === selectedValue
                    ? 'bg-accent/10 text-accent'
                    : 'text-text hover:bg-surface1'
                }`}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
