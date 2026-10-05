import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Building2,
  CheckCircle,
  CloudSun,
  Globe,
  HardHat,
  LayoutGrid,
  Lock,
  Timer,
  Users,
} from 'lucide-react'
import Dropdown from '@/components/Dropdown'
import Button from '@/components/Button'
import Reveal from '@/components/Reveal'
import { seo } from '@/lib/seo'
import { submitContact } from '@/lib/api'

export const Route = createFileRoute('/construction')({
  head: () =>
    seo({
      title: 'Construction Cameras | NationCam',
      description:
        'Live view, time-lapse and a private dashboard for your job site. Buy or rent the camera, bring your own internet or let us provide it, and request a quote.',
      path: '/construction',
    }),
  component: ConstructionPage,
})

const includedItems = [
  {
    icon: Lock,
    title: 'Private live view',
    text: 'Only your team can see the stream.',
  },
  {
    icon: LayoutGrid,
    title: 'Command center',
    text: 'Every one of your cameras on one screen.',
  },
  {
    icon: Timer,
    title: 'Time-lapse every 15 minutes',
    text: 'A still is captured every 15 minutes, with an archive you can browse by day.',
  },
  {
    icon: CloudSun,
    title: 'Site conditions',
    text: 'Weather, satellite-detected lightning and NWS alerts for your site. The lightning data is informational only.',
  },
  {
    icon: Users,
    title: 'Invite your team',
    text: 'Add the people who need to watch the site.',
  },
  {
    icon: Globe,
    title: 'Optional public page',
    text: 'If you want the exposure, your camera can also get a public page on NationCam.',
  },
]

type CameraKind = 'fixed' | 'fixed4k' | 'panoramic' | 'ptz'

const cameraTypes: Array<{
  kind: CameraKind
  title: string
  sees: string
  bestFor: string
  goodToKnow: string
}> = [
  {
    kind: 'fixed',
    title: 'Fixed',
    sees: 'One fixed view of your site, day and night.',
    bestFor: 'A single elevation, a gate or a laydown yard.',
    goodToKnow: 'The simplest and lowest-cost option.',
  },
  {
    kind: 'fixed4k',
    title: 'Fixed 4K',
    sees: 'The same fixed view with a 4K sensor for finer detail.',
    bestFor: 'Sites where you need to read detail at a distance.',
    goodToKnow: 'Streaming at full resolution needs a faster connection.',
  },
  {
    kind: 'panoramic',
    title: 'Panoramic',
    sees: 'A 180° view from one camera, stitched into a single image.',
    bestFor: 'Seeing the whole site from one pole or rooftop.',
    goodToKnow: 'One camera replaces several fixed ones.',
  },
  {
    kind: 'ptz',
    title: 'PTZ',
    sees: 'Pans, tilts and zooms optically up to 30x, moving between preset views of the site.',
    bestFor: 'Large sites with several areas to watch.',
    goodToKnow: 'Preset views are set up with you at install.',
  },
]

const cameraChoices = [
  {
    title: 'Buy',
    text: 'You own the hardware.',
  },
  {
    title: 'Rent',
    text: 'Pay monthly. If the camera fails, we swap it.',
  },
]

const internetChoices = [
  {
    title: 'We provide it',
    text: 'Cellular or satellite internet, managed and remotely supported by us.',
  },
  {
    title: 'You provide it',
    text: 'Use your site connection and pay only for the streaming service.',
  },
]

const plans = [
  {
    value: 'essential',
    name: 'Essential',
    price: '$129',
    featured: false,
    lead: null as string | null,
    features: [
      'Private live view and command center',
      'Unlimited team users',
      'Site conditions: weather, satellite-detected lightning, NWS alerts',
      'Time-lapse photo every 15 minutes',
      '7 days of recorded video',
      'Photos kept 1 year after the project',
    ],
  },
  {
    value: 'pro',
    name: 'Pro',
    price: '$229',
    featured: true,
    lead: 'Everything in Essential, plus:',
    features: [
      'Time-lapse photo every minute',
      '30 days of recorded video',
      'Photos kept 3 years',
    ],
  },
  {
    value: 'premium',
    name: 'Premium',
    price: '$349',
    featured: false,
    lead: 'Everything in Pro, plus:',
    features: [
      '90 days of recorded video',
      'Photos kept permanently',
      'On-site weather station service included',
      'Edited time-lapse film at project end',
    ],
  },
]

const steps = [
  {
    title: 'Tell us about the site',
    text: 'Send the quote request with where the job is, how many cameras you need and how long it runs.',
  },
  {
    title: 'We set up the camera',
    text: 'We agree the setup with you and get the camera streaming from your site.',
  },
  {
    title: 'Your team watches from anywhere',
    text: 'Open the private live view or the command center from any browser.',
  },
]

function ConstructionPage() {
  return (
    <div className="page-container space-y-20">
      {/* 1. Hero */}
      <Reveal>
        <section className="mx-auto max-w-3xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-4 py-1.5">
            <HardHat size={14} className="text-accent" />
            <span className="font-mono text-xs font-medium text-accent">
              Construction cameras
            </span>
          </div>
          <h1>See your job site from anywhere</h1>
          <p>Live view, time-lapse and a private dashboard for your team.</p>
          <a
            href="#quote"
            className="mt-2 inline-flex items-center justify-center rounded-lg bg-accent px-8 py-3 font-sans text-[1rem] font-semibold text-crust shadow-md transition-[scale,background-color,box-shadow] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] hover:bg-accent-hover hover:shadow-lg active:scale-[0.98]"
          >
            Request a quote
          </a>
        </section>
      </Reveal>

      {/* 2. Every camera includes */}
      <section>
        <Reveal>
          <h2 className="text-center">Every camera includes</h2>
        </Reveal>
        <Reveal stagger>
          <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {includedItems.map(({ icon: Icon, title, text }) => (
              <li
                key={title}
                className="section-container reveal-scale flex items-start gap-3"
              >
                <Icon size={20} className="mt-0.5 shrink-0 text-accent" />
                <div className="min-w-0">
                  <h3 className="!mb-1 !text-[1rem]">{title}</h3>
                  <p className="!mb-0 !text-sm text-subtext0">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>
      </section>

      {/* 3. Choose your camera */}
      <section>
        <Reveal>
          <h2 className="text-center">Choose your camera</h2>
          <p className="mx-auto max-w-2xl text-center">
            All four are Axis network cameras. We help you pick on the quote
            call.
          </p>
        </Reveal>
        <Reveal stagger>
          <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {cameraTypes.map((c) => (
              <li
                key={c.kind}
                className="section-container reveal-scale flex flex-col"
              >
                <FieldOfView kind={c.kind} />
                <h3 className="!mt-4 !mb-1 !text-lg">{c.title}</h3>
                <p className="!mb-3 !text-sm text-subtext0">{c.sees}</p>
                <p className="!mb-2 !text-sm text-subtext0">
                  <span className="font-medium text-text">Best for:</span>{' '}
                  {c.bestFor}
                </p>
                <p className="!mb-0 !text-sm text-subtext0">
                  <span className="font-medium text-text">Good to know:</span>{' '}
                  {c.goodToKnow}
                </p>
              </li>
            ))}
          </ul>
        </Reveal>
      </section>

      {/* 4. Choose your setup */}
      <section>
        <Reveal>
          <h2 className="text-center">Choose your setup</h2>
          <p className="mx-auto max-w-2xl text-center">
            Two independent choices. Pick any combination.
          </p>
        </Reveal>
        <div className="mx-auto mt-8 grid max-w-4xl grid-cols-1 gap-10">
          <ChoiceGroup heading="Camera" choices={cameraChoices} />
          <ChoiceGroup heading="Internet" choices={internetChoices} />
        </div>
      </section>

      {/* 5. Plans */}
      <section>
        <Reveal>
          <h2 className="text-center">Plans</h2>
          <p className="mx-auto max-w-2xl text-center">
            Priced per camera, per month.
          </p>
        </Reveal>
        <Reveal stagger>
          <ul className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {plans.map((p) => (
              <li
                key={p.value}
                className={`section-container reveal-scale flex flex-col ${
                  p.featured ? '!border-accent ring-2 ring-accent' : ''
                }`}
              >
                <h3 className="!mb-2 !text-lg">{p.name}</h3>
                <div className="mb-4 flex flex-wrap items-baseline gap-x-2">
                  <span className="font-display text-5xl leading-none font-extrabold text-text">
                    {p.price}
                  </span>
                  <span className="text-sm text-subtext0">
                    per camera / month
                  </span>
                </div>
                {p.lead && (
                  <p className="!mb-3 !text-sm font-medium text-text">
                    {p.lead}
                  </p>
                )}
                <ul className="mb-6 space-y-3">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-3">
                      <CheckCircle
                        size={18}
                        className="mt-0.5 shrink-0 text-accent"
                      />
                      <p className="!mb-0 !text-sm text-subtext0">{f}</p>
                    </li>
                  ))}
                </ul>
                <a
                  href="#quote"
                  className="mt-auto inline-flex items-center justify-center rounded-lg bg-accent px-6 py-2.5 font-sans text-sm font-semibold text-crust shadow-md transition-[scale,background-color,box-shadow] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] hover:bg-accent-hover hover:shadow-lg active:scale-[0.98]"
                >
                  Request a quote
                </a>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal>
          <p className="mx-auto mt-6 max-w-3xl text-center !text-xs text-overlay2">
            Camera hardware, internet and installation are quoted for your site.
            The on-site weather station is available as an add-on on Essential
            and Pro; the station hardware is separate on every plan.
          </p>
        </Reveal>
      </section>

      {/* 6. How it works */}
      <section>
        <Reveal>
          <h2 className="text-center">How it works</h2>
        </Reveal>
        <Reveal stagger>
          <ol className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {steps.map((step, i) => (
              <li key={step.title} className="section-container reveal-scale">
                <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 font-mono text-sm font-semibold text-accent">
                  {i + 1}
                </span>
                <h3 className="!mb-1 !text-[1rem]">{step.title}</h3>
                <p className="!mb-0 !text-sm text-subtext0">{step.text}</p>
              </li>
            ))}
          </ol>
        </Reveal>
      </section>

      {/* 7. Quote form */}
      <section id="quote" className="mx-auto max-w-3xl scroll-mt-24">
        <Reveal>
          <div className="mb-6 text-center">
            <div className="mb-3 inline-flex items-center gap-2 text-accent">
              <Building2 size={18} />
            </div>
            <h2>Request a quote</h2>
            <p className="mb-0">
              Tell us about your project and we will get back to you with a
              quote.
            </p>
          </div>
        </Reveal>
        <QuoteForm />
      </section>
    </div>
  )
}

// Top-down field-of-view sketch: the camera is the dot, the shaded shape is
// what it covers. Purely decorative, so it is hidden from assistive tech.
function FieldOfView({ kind }: { kind: CameraKind }) {
  const wedge = 'M60 68 L42 18 L78 18 Z'
  return (
    <svg
      viewBox="0 0 120 80"
      aria-hidden="true"
      focusable="false"
      className="mx-auto aspect-[3/2] w-full max-w-[9rem] text-text"
    >
      {kind === 'fixed4k' && (
        <defs>
          <pattern
            id="fov-fine-grid"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M5 0H0V5"
              fill="none"
              className="stroke-accent"
              strokeWidth="0.6"
            />
          </pattern>
        </defs>
      )}
      {kind === 'ptz' && (
        <defs>
          <marker
            id="fov-sweep-head"
            viewBox="0 0 6 6"
            refX="5"
            refY="3"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0L6 3L0 6z" fill="currentColor" />
          </marker>
        </defs>
      )}
      <path
        d={kind === 'panoramic' ? 'M60 68 L10 68 A50 50 0 0 1 110 68 Z' : wedge}
        className="fill-accent/20 stroke-accent"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {kind === 'fixed4k' && <path d={wedge} fill="url(#fov-fine-grid)" />}
      {kind === 'ptz' && (
        <path
          d="M27 40 A44 44 0 0 1 93 40"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          markerStart="url(#fov-sweep-head)"
          markerEnd="url(#fov-sweep-head)"
        />
      )}
      <circle cx="60" cy="68" r="4" fill="currentColor" />
    </svg>
  )
}

function ChoiceGroup({
  heading,
  choices,
}: {
  heading: string
  choices: Array<{ title: string; text: string }>
}) {
  return (
    <Reveal>
      <div>
        <h3 className="!mb-4 text-center font-mono !text-xs font-semibold tracking-widest text-subtext0 uppercase">
          {heading}
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {choices.map((c) => (
            <div key={c.title} className="section-container">
              <h4 className="!mb-1 !text-lg">{c.title}</h4>
              <p className="!mb-0 !text-sm text-subtext0">{c.text}</p>
            </div>
          ))}
        </div>
      </div>
    </Reveal>
  )
}

/* ──── Quote form ──── */

const cameraOptions = [
  { value: 'buy', label: 'Buy' },
  { value: 'rent', label: 'Rent' },
  { value: 'unsure', label: 'Not sure' },
]

const cameraTypeOptions = [...cameraTypes.map((c) => c.title), 'Not sure']

const internetOptions = [
  { value: 'nationcam', label: 'NationCam provides it' },
  { value: 'onsite', label: 'We have internet on site' },
  { value: 'unsure', label: 'Not sure' },
]

const lengthOptions = [
  { value: 'under-3', label: 'Under 3 months' },
  { value: '3-6', label: '3-6 months' },
  { value: '6-12', label: '6-12 months' },
  { value: 'over-12', label: 'Over a year' },
]

const planOptions = [
  ...plans.map((p) => ({ value: p.value, label: p.name })),
  { value: 'unsure', label: 'Not sure' },
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
  cameras: string
  cameraTypes: Array<string>
  camera: string
  internet: string
  length: string
  plan: string
  weatherStation: boolean
  notes: string
}

type ListField = 'cameraTypes'
type TextField = Exclude<keyof FormData, ListField | 'weatherStation'>

const emptyForm: FormData = {
  name: '',
  company: '',
  email: '',
  phone: '',
  city: '',
  state: '',
  cameras: '',
  cameraTypes: [],
  camera: '',
  internet: '',
  length: '',
  plan: '',
  weatherStation: false,
  notes: '',
}

const labelFor = (
  options: Array<{ value: string; label: string }>,
  value: string,
) => options.find((o) => o.value === value)?.label ?? value

const byteLength = (s: string) => new TextEncoder().encode(s).length

// Pack the structured quote fields into one readable message body so the
// backend stays a generic name/email/message contact store. Rendered as plain
// text in the dashboard.
function buildMessage(form: FormData): string {
  const pack = (notes: string) =>
    [
      `Company: ${form.company.trim()}`,
      `Phone: ${form.phone.trim() || 'Not given'}`,
      `Project location: ${form.city.trim()}, ${form.state.trim()}`,
      `Number of cameras: ${form.cameras.trim()}`,
      `Camera types: ${form.cameraTypes.length > 0 ? form.cameraTypes.join(', ') : 'Not specified'}`,
      `Camera: ${labelFor(cameraOptions, form.camera)}`,
      `Internet: ${labelFor(internetOptions, form.internet)}`,
      `Project length: ${labelFor(lengthOptions, form.length)}`,
      `Plan: ${form.plan ? labelFor(planOptions, form.plan) : 'Not specified'}`,
      `Weather station: ${form.weatherStation ? 'Yes' : 'No'}`,
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

function QuoteForm() {
  const [form, setForm] = useState<FormData>(emptyForm)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const update = (field: TextField, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const toggleChoice = (field: ListField, value: string) => {
    setForm((prev) => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter((v) => v !== value)
        : [...prev[field], value],
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const required: Array<TextField> = [
      'name',
      'company',
      'email',
      'city',
      'state',
      'cameras',
      'camera',
      'internet',
      'length',
    ]
    const missing = required.filter((f) => !form[f].trim())
    if (missing.length > 0) {
      setError('Please fill out all required fields.')
      return
    }
    const count = Number(form.cameras)
    if (!Number.isInteger(count) || count < 1) {
      setError('Number of cameras must be a whole number, 1 or more.')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      await submitContact({
        name: form.name.trim(),
        email: form.email.trim(),
        message: buildMessage(form),
        kind: 'construction',
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
          We have received your quote request. Our team will review it and get
          back to you soon.
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
          label="Project city"
          required
          value={form.city}
          maxLength={100}
          onChange={(v) => update('city', v)}
        />
        <Input
          label="Project state"
          required
          value={form.state}
          maxLength={60}
          onChange={(v) => update('state', v)}
        />
      </div>

      <Input
        label="Number of cameras"
        required
        type="number"
        min={1}
        value={form.cameras}
        onChange={(v) => update('cameras', v)}
      />

      <Dropdown
        label="Camera *"
        options={cameraOptions}
        selectedValue={form.camera}
        onSelect={(v) => update('camera', String(v))}
      />
      <Dropdown
        label="Internet *"
        options={internetOptions}
        selectedValue={form.internet}
        onSelect={(v) => update('internet', String(v))}
      />
      <Dropdown
        label="Project length *"
        options={lengthOptions}
        selectedValue={form.length}
        onSelect={(v) => update('length', String(v))}
      />
      <Dropdown
        label="Plan"
        options={planOptions}
        selectedValue={form.plan}
        onSelect={(v) => update('plan', String(v))}
      />

      <fieldset>
        <legend className="mb-1.5 block font-sans text-sm font-medium text-subtext1">
          Camera types of interest
        </legend>
        <div className="space-y-2">
          {cameraTypeOptions.map((name) => (
            <label
              key={name}
              className="flex cursor-pointer items-center gap-3 text-sm text-text"
            >
              <input
                type="checkbox"
                checked={form.cameraTypes.includes(name)}
                onChange={() => toggleChoice('cameraTypes', name)}
                className="h-4 w-4 shrink-0 accent-accent"
              />
              {name}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex cursor-pointer items-center gap-3 text-sm text-text">
        <input
          type="checkbox"
          checked={form.weatherStation}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, weatherStation: e.target.checked }))
          }
          className="h-4 w-4 shrink-0 accent-accent"
        />
        Interested in an on-site weather station
      </label>

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
        text={submitting ? 'Sending...' : 'Request a quote'}
        type="submit"
        className="w-full"
        size="lg"
        disabled={submitting}
      />

      <p className="!mb-0 text-center !text-xs text-overlay2">
        Your information is kept private and never shared with third parties.
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
  min,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  required?: boolean
  maxLength?: number
  min?: number
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
          min={min}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-overlay0 bg-base px-4 py-3 font-sans text-sm font-normal text-text transition-[border-color,box-shadow] duration-200 placeholder:text-overlay1 focus:border-accent focus:ring-2 focus:ring-accent-glow focus:outline-none"
        />
      </label>
    </div>
  )
}
