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
import Eyebrow from '@/components/ui/Eyebrow'
import Field, { Input, Select, Textarea } from '@/components/ui/Field'
import Panel from '@/components/ui/Panel'
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

  const monthly = estimateMonthly(config)
  const upfront = estimateUpfront(config)
  const sent: Array<[string, string]> = [
    ...describeConfig(config).map((l): [string, string] => [l.label, l.value]),
    ['Estimated monthly', `from ${formatUSD(monthly)}`],
    ['Estimated upfront', upfront > 0 ? `from ${formatUSD(upfront)}` : 'None'],
  ]

  if (submitted) {
    return (
      <Panel
        accentTop
        padding="lg"
        className="flex flex-col items-center py-12 text-center"
      >
        <CheckCircle size={48} className="mb-4 text-accent-fg" />
        <h3 className="mb-2">Thank you!</h3>
        <p className="mb-0 max-w-sm text-subtext1">
          We have received your quote request with your configuration. Our team
          will review it and get back to you soon.
        </p>
      </Panel>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-10 min-[960px]:grid-cols-[4fr_7fr] min-[960px]:gap-16">
      <div className="min-w-0">
        <Eyebrow>Sent with your request</Eyebrow>
        <dl className="m-0 border-t border-border">
          {sent.map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between gap-3 border-b border-border py-2.5 text-sm"
            >
              <dt className="font-mono text-[11px] leading-[1.6] tracking-[0.02em] text-label uppercase">
                {k}
              </dt>
              <dd className="m-0 text-right [overflow-wrap:anywhere] text-text tabular-nums">
                {v}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 mb-0 text-body text-subtext1">
          Estimate only. Installation is quoted for your site; final pricing is
          confirmed on the quote call.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="min-w-0">
        <Panel accentTop padding="lg">
          <div className="grid gap-5">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="Name" htmlFor="q-name" required>
                <Input
                  id="q-name"
                  value={form.name}
                  maxLength={100}
                  autoComplete="name"
                  onChange={(e) => update('name', e.target.value)}
                />
              </Field>
              <Field label="Company" htmlFor="q-company" required>
                <Input
                  id="q-company"
                  value={form.company}
                  maxLength={120}
                  autoComplete="organization"
                  onChange={(e) => update('company', e.target.value)}
                />
              </Field>
              <Field label="Email" htmlFor="q-email" required>
                <Input
                  id="q-email"
                  type="email"
                  value={form.email}
                  maxLength={200}
                  autoComplete="email"
                  onChange={(e) => update('email', e.target.value)}
                />
              </Field>
              <Field label="Phone" htmlFor="q-phone">
                <Input
                  id="q-phone"
                  type="tel"
                  value={form.phone}
                  maxLength={40}
                  autoComplete="tel"
                  onChange={(e) => update('phone', e.target.value)}
                />
              </Field>
              <Field label="Site city" htmlFor="q-city" required>
                <Input
                  id="q-city"
                  value={form.city}
                  maxLength={100}
                  onChange={(e) => update('city', e.target.value)}
                />
              </Field>
              <Field label="Site state" htmlFor="q-state" required>
                <Input
                  id="q-state"
                  value={form.state}
                  maxLength={60}
                  onChange={(e) => update('state', e.target.value)}
                />
              </Field>
            </div>

            <Field label="When do you want to start" htmlFor="q-start" required>
              <Select
                id="q-start"
                value={form.start}
                onChange={(e) => update('start', e.target.value)}
              >
                <option value="">Select…</option>
                {startOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Notes" htmlFor="q-notes">
              <Textarea
                id="q-notes"
                rows={4}
                maxLength={NOTES_MAX_CHARS}
                value={form.notes}
                onChange={(e) => update('notes', e.target.value)}
              />
            </Field>

            {error && (
              <p
                role="alert"
                className="mb-0 rounded-r-md border-l-2 border-live bg-live-glow px-3 py-2 text-sm font-medium text-text"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              size="marketing"
              block
              disabled={submitting}
              text={submitting ? 'Sending...' : 'Send my quote request'}
            />

            <p className="mb-0 text-center text-xs text-subtext1">
              Your configuration and estimate are sent with your details. Your
              information is kept private and never shared with third parties.
            </p>
          </div>
        </Panel>
      </form>
    </div>
  )
}
