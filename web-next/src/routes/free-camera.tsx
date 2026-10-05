import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Camera,
  CheckCircle,
  CloudSun,
  Code,
  LayoutTemplate,
  Wallet,
} from 'lucide-react'
import Dropdown from '@/components/Dropdown'
import Button from '@/components/Button'
import Reveal from '@/components/Reveal'
import { seo } from '@/lib/seo'
import { submitContact } from '@/lib/api'

export const Route = createFileRoute('/free-camera')({
  head: () =>
    seo({
      title: 'Free Camera | NationCam',
      description:
        'NationCam installs one of its cameras at a place worth watching, at no charge. In return the live view is public on NationCam. Apply for a camera at your site.',
      path: '/free-camera',
    }),
  component: FreeCameraPage,
})

const youGet = [
  {
    icon: Camera,
    title: 'A live camera on NationCam',
    text: 'At no charge to you.',
  },
  {
    icon: LayoutTemplate,
    title: 'Your own page',
    text: 'Customise it to advertise your business with your logo, a description and a link, as existing host locations have.',
  },
  {
    icon: CloudSun,
    title: 'Live weather and conditions',
    text: 'Shown on your page next to the camera.',
  },
  {
    icon: Code,
    title: 'An embed for your website',
    text: 'Put the camera on your own site.',
  },
  {
    icon: Wallet,
    title: 'A share of revenue',
    text: 'If your camera becomes popular, we share revenue with you. The terms are agreed with you.',
  },
]

const weNeed = [
  'A site worth viewing.',
  'Power at the mounting spot.',
  'An internet connection at the site.',
  'A place to mount the camera.',
]

const goodToKnow = [
  'The camera is owned by NationCam and stays NationCam’s property.',
  'The camera may not be new.',
  'We choose the camera for the site. We do not guarantee a resolution.',
  'The view is public. Anyone can watch it on NationCam.',
  'We choose which sites get a camera, so applying does not guarantee one.',
]

function FreeCameraPage() {
  return (
    <div className="page-container space-y-20">
      {/* 1. Hero */}
      <Reveal>
        <section className="mx-auto max-w-3xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-4 py-1.5">
            <Camera size={14} className="text-accent" />
            <span className="font-mono text-xs font-medium text-accent">
              Free camera
            </span>
          </div>
          <h1>Get a free camera for your site</h1>
          <p>
            NationCam installs one of its cameras at a place worth watching, and
            the live view is public on NationCam.
          </p>
          <a
            href="#apply"
            className="mt-2 inline-flex items-center justify-center rounded-lg bg-accent px-8 py-3 font-sans text-[1rem] font-semibold text-crust shadow-md transition-[scale,background-color,box-shadow] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] hover:bg-accent-hover hover:shadow-lg active:scale-[0.98]"
          >
            Apply for a camera
          </a>
        </section>
      </Reveal>

      {/* 2. What you get */}
      <section>
        <Reveal>
          <h2 className="text-center">What you get</h2>
        </Reveal>
        <Reveal stagger>
          <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {youGet.map(({ icon: Icon, title, text }) => (
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

      {/* 3. What we need from you */}
      <section className="mx-auto max-w-3xl">
        <Reveal>
          <h2 className="text-center">What we need from you</h2>
        </Reveal>
        <Reveal>
          <div className="section-container mt-8">
            <ul className="space-y-3">
              {weNeed.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <CheckCircle
                    size={18}
                    className="mt-0.5 shrink-0 text-accent"
                  />
                  <p className="!mb-0 !text-sm text-subtext0">{item}</p>
                </li>
              ))}
            </ul>
            <p className="!mt-5 !mb-0 !text-sm text-subtext0">
              Depending on where you are, we install it or you do, with our
              help.
            </p>
          </div>
        </Reveal>
      </section>

      {/* 4. Good to know */}
      <section className="mx-auto max-w-3xl">
        <Reveal>
          <h2 className="text-center">Good to know</h2>
        </Reveal>
        <Reveal>
          <div className="section-container mt-8">
            <ul className="space-y-3">
              {goodToKnow.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                  />
                  <p className="!mb-0 !text-sm !text-text">{item}</p>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </section>

      {/* 5. Construction pointer */}
      <Reveal>
        <p className="mx-auto max-w-3xl text-center !text-sm text-subtext0">
          Need a private camera for a job site?{' '}
          <Link
            to="/construction"
            className="font-medium text-accent underline underline-offset-2"
          >
            See construction cameras.
          </Link>
        </p>
      </Reveal>

      {/* 6. Application form */}
      <section id="apply" className="mx-auto max-w-3xl scroll-mt-24">
        <Reveal>
          <div className="mb-6 text-center">
            <h2>Apply for a camera</h2>
            <p className="mb-0">
              Tell us about your site. We will review it and get back to you.
            </p>
          </div>
        </Reveal>
        <ApplyForm />
      </section>
    </div>
  )
}

/* ──── Application form ──── */

const siteTypeOptions = [
  { value: 'waterfront', label: 'Waterfront or marina' },
  { value: 'downtown', label: 'Downtown or street' },
  { value: 'venue', label: 'Venue or attraction' },
  { value: 'construction', label: 'Construction site' },
  { value: 'other', label: 'Other' },
]

const yesNoOptions = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: 'Not sure' },
]

const installOptions = [
  { value: 'self', label: 'We can install it ourselves' },
  { value: 'nationcam', label: 'We need NationCam to install it' },
  { value: 'unsure', label: 'Not sure' },
]

const NOTES_MAX_CHARS = 1500
// The API caps the message at 5000 bytes, so free text is trimmed to fit even
// when it contains multi-byte characters.
const MESSAGE_MAX_BYTES = 4800

interface FormData {
  name: string
  company: string
  email: string
  phone: string
  city: string
  state: string
  views: string
  siteType: string
  power: string
  internet: string
  install: string
  notes: string
}

type TextField = keyof FormData

const emptyForm: FormData = {
  name: '',
  company: '',
  email: '',
  phone: '',
  city: '',
  state: '',
  views: '',
  siteType: '',
  power: '',
  internet: '',
  install: '',
  notes: '',
}

const labelFor = (
  options: Array<{ value: string; label: string }>,
  value: string,
) => options.find((o) => o.value === value)?.label ?? value

const byteLength = (s: string) => new TextEncoder().encode(s).length

// Pack the structured fields into one readable message body so the backend
// stays a generic name/email/message contact store. Rendered as plain text in
// the dashboard.
function buildMessage(form: FormData): string {
  const pack = (views: string, notes: string) =>
    [
      `Business or organisation: ${form.company.trim()}`,
      `Phone: ${form.phone.trim() || 'Not given'}`,
      `Site location: ${form.city.trim()}, ${form.state.trim()}`,
      `Site type: ${labelFor(siteTypeOptions, form.siteType)}`,
      `Power at the mounting spot: ${labelFor(yesNoOptions, form.power)}`,
      `Internet at the site: ${labelFor(yesNoOptions, form.internet)}`,
      `Who would install: ${labelFor(installOptions, form.install)}`,
      '',
      'What the camera would look at:',
      views,
      '',
      'Notes:',
      notes || 'None',
    ].join('\n')

  let views = form.views.trim().slice(0, 300)
  let notes = form.notes.trim().slice(0, NOTES_MAX_CHARS)
  let message = pack(views, notes)
  while (byteLength(message) > MESSAGE_MAX_BYTES && notes.length > 0) {
    notes = notes.slice(0, Math.floor(notes.length * 0.8))
    message = pack(views, notes)
  }
  while (byteLength(message) > MESSAGE_MAX_BYTES && views.length > 1) {
    views = views.slice(0, Math.floor(views.length * 0.8))
    message = pack(views, notes)
  }
  return message
}

function ApplyForm() {
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
      'views',
      'siteType',
      'power',
      'internet',
      'install',
    ]
    const missing = required.filter((f) => !form[f].trim())
    if (missing.length > 0) {
      setError('Please fill out all required fields.')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      await submitContact({
        name: form.name.trim(),
        email: form.email.trim(),
        message: buildMessage(form),
        kind: 'free-camera',
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
          We have received your application. Our team will review it and get
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
          label="Business or organisation"
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

      <Input
        label="What the camera would look at"
        required
        value={form.views}
        maxLength={300}
        onChange={(v) => update('views', v)}
      />

      <Dropdown
        label="Site type *"
        options={siteTypeOptions}
        selectedValue={form.siteType}
        onSelect={(v) => update('siteType', String(v))}
      />
      <Dropdown
        label="Power available at the mounting spot *"
        options={yesNoOptions}
        selectedValue={form.power}
        onSelect={(v) => update('power', String(v))}
      />
      <Dropdown
        label="Internet available at the site *"
        options={yesNoOptions}
        selectedValue={form.internet}
        onSelect={(v) => update('internet', String(v))}
      />
      <Dropdown
        label="Who would install *"
        options={installOptions}
        selectedValue={form.install}
        onSelect={(v) => update('install', String(v))}
      />

      <div>
        <label
          htmlFor="free-camera-notes"
          className="mb-1.5 block font-sans text-sm font-medium text-subtext1"
        >
          Notes
        </label>
        <textarea
          id="free-camera-notes"
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
        text={submitting ? 'Sending...' : 'Apply for a camera'}
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
