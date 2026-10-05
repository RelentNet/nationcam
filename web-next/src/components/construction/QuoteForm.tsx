import { useState } from 'react'
import { CheckCircle } from 'lucide-react'
import type { QuoteConfig } from '@/lib/constructionPricing'
import {
  clampCameras,
  describeConfig,
  estimateMonthly,
  estimateUpfront,
  formatUSD,
  getInternet,
  getPlan,
  getResolution,
  getStyle,
} from '@/lib/constructionPricing'
import Dropdown from '@/components/Dropdown'
import Button from '@/components/Button'
import { submitContact } from '@/lib/api'

const startOptions = [
  { value: 'asap', label: 'As soon as possible' },
  { value: 'month', label: 'Within a month' },
  { value: '1-3', label: '1-3 months' },
  { value: 'later', label: 'Later' },
]

const NOTES_MAX_CHARS = 1500
// The API caps the message at 5000 bytes, so the notes are trimmed to fit even
// when they contain multi-byte characters.
const MESSAGE_MAX_BYTES = 4800

interface FormData {
  name: string
  company: string
  email: string
  phone: string
  city: string
  state: string
  start: string
  notes: string
}

const emptyForm: FormData = {
  name: '',
  company: '',
  email: '',
  phone: '',
  city: '',
  state: '',
  start: '',
  notes: '',
}

const byteLength = (s: string) => new TextEncoder().encode(s).length

// Pack the contact fields, the full configuration and the estimate into one
// readable message body, so the backend stays a generic name/email/message
// contact store. Rendered as plain text in the dashboard.
function buildMessage(form: FormData, config: QuoteConfig): string {
  const upfront = estimateUpfront(config)
  const pack = (notes: string) =>
    [
      `Company: ${form.company.trim()}`,
      `Phone: ${form.phone.trim() || 'Not given'}`,
      `Site location: ${form.city.trim()}, ${form.state.trim()}`,
      `Start: ${startOptions.find((o) => o.value === form.start)?.label ?? form.start}`,
      '',
      'Configuration:',
      ...describeConfig(config).map((l) => `${l.label}: ${l.value}`),
      '',
      `Estimated monthly: from ${formatUSD(estimateMonthly(config))}`,
      `Estimated upfront: ${upfront > 0 ? `from ${formatUSD(upfront)}` : 'none'}`,
      '',
      'Notes:',
      notes || 'None',
    ].join('\n')

  let notes = form.notes.trim().slice(0, NOTES_MAX_CHARS)
  let message = pack(notes)
  while (byteLength(message) > MESSAGE_MAX_BYTES && notes.length > 0) {
    notes = notes.slice(0, Math.floor(notes.length * 0.8))
    message = pack(notes)
  }
  return message
}

// The same answers as separate fields, stored beside the message so the admin
// view can show them as columns. Values are the readable labels, not ids.
function buildDetails(
  form: FormData,
  config: QuoteConfig,
): Record<string, string | number | boolean> {
  const own = config.acquisition === 'own'
  const resolution = getResolution(config.style, config.resolution)
  return {
    plan: getPlan(config.plan).name,
    camera: own
      ? 'Bring your own'
      : config.acquisition === 'buy'
        ? 'Buy'
        : 'Rent',
    ...(own
      ? {}
      : { style: getStyle(config.style).title, resolution: resolution.label }),
    internet: getInternet(config.internet).title,
    cameras: clampCameras(config.cameras),
    forever_video: config.foreverVideo,
    weather_station: config.weatherStation,
    start:
      startOptions.find((o) => o.value === form.start)?.label ?? form.start,
    est_monthly: estimateMonthly(config),
    est_upfront: estimateUpfront(config),
  }
}

type TextField = keyof FormData

export default function QuoteForm({ config }: { config: QuoteConfig }) {
  const [form, setForm] = useState<FormData>(emptyForm)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const update = (field: TextField, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const required: Array<TextField> = [
      'name',
      'company',
      'email',
      'city',
      'state',
      'start',
    ]
    if (required.some((f) => !form[f].trim())) {
      setError('Please fill out all required fields.')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      await submitContact({
        name: form.name.trim(),
        email: form.email.trim(),
        message: buildMessage(form, config),
        kind: 'construction',
        company: form.company.trim(),
        phone: form.phone.trim(),
        site_city: form.city.trim(),
        site_state: form.state.trim(),
        details: buildDetails(form, config),
      })
      setSubmitted(true)
    } catch {
      setError('Something went wrong sending your request. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div
        className="section-container flex flex-col items-center py-12 text-center"
        style={{
          animation: 'scale-fade-in 500ms var(--spring-poppy) forwards',
        }}
      >
        <CheckCircle size={48} className="mb-4 text-accent" />
        <h3>Thank you!</h3>
        <p className="mb-0 max-w-sm">
          We have received your quote request with your configuration. Our team
          will review it and get back to you soon.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="section-container space-y-5"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Name"
          required
          value={form.name}
          maxLength={100}
          onChange={(v) => update('name', v)}
        />
        <Input
          label="Company"
          required
          value={form.company}
          maxLength={120}
          onChange={(v) => update('company', v)}
        />
        <Input
          label="Email"
          required
          type="email"
          value={form.email}
          maxLength={200}
          onChange={(v) => update('email', v)}
        />
        <Input
          label="Phone"
          type="tel"
          value={form.phone}
          maxLength={40}
          onChange={(v) => update('phone', v)}
        />
        <Input
          label="Site city"
          required
          value={form.city}
          maxLength={100}
          onChange={(v) => update('city', v)}
        />
        <Input
          label="Site state"
          required
          value={form.state}
          maxLength={60}
          onChange={(v) => update('state', v)}
        />
      </div>

      <Dropdown
        label="When do you want to start *"
        options={startOptions}
        selectedValue={form.start}
        onSelect={(v) => update('start', String(v))}
      />

      <div>
        <label
          htmlFor="construction-notes"
          className="mb-1.5 block font-sans text-sm font-medium text-subtext1"
        >
          Notes
        </label>
        <textarea
          id="construction-notes"
          rows={4}
          maxLength={NOTES_MAX_CHARS}
          value={form.notes}
          onChange={(e) => update('notes', e.target.value)}
          className="w-full rounded-lg border border-overlay0 bg-base px-4 py-3 font-sans text-sm text-text transition-[border-color,box-shadow] duration-200 placeholder:text-overlay1 focus:border-accent focus:ring-2 focus:ring-accent-glow focus:outline-none"
        />
      </div>

      {error && (
        <p role="alert" className="!mb-0 !text-sm font-medium text-live">
          {error}
        </p>
      )}

      <Button
        text={submitting ? 'Sending...' : 'Send my quote request'}
        type="submit"
        className="w-full"
        size="lg"
        disabled={submitting}
      />

      <p className="!mb-0 text-center !text-xs text-overlay2">
        Your configuration and estimate are sent with your details. Your
        information is kept private and never shared with third parties.
      </p>
    </form>
  )
}

/* ──── Styled text input ──── */

function Input({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  maxLength,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  required?: boolean
  maxLength?: number
}) {
  return (
    <div className="min-w-0">
      <label className="mb-1.5 block font-sans text-sm font-medium text-subtext1">
        {label}
        {required && <span className="ml-0.5 text-accent">*</span>}
        <input
          type={type}
          value={value}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-overlay0 bg-base px-4 py-3 font-sans text-sm font-normal text-text transition-[border-color,box-shadow] duration-200 placeholder:text-overlay1 focus:border-accent focus:ring-2 focus:ring-accent-glow focus:outline-none"
        />
      </label>
    </div>
  )
}
