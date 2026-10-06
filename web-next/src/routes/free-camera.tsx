import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowRight, CheckCircle } from 'lucide-react'
import Button, { buttonClasses } from '@/components/Button'
import Eyebrow from '@/components/ui/Eyebrow'
import Field, { Input, Select, Textarea } from '@/components/ui/Field'
import Panel from '@/components/ui/Panel'
import RuledGrid, { RuledCell } from '@/components/ui/RuledGrid'
import SectionHead from '@/components/ui/SectionHead'
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
    title: 'A live camera on NationCam',
    text: 'At no charge to you.',
  },
  {
    title: 'Your own page',
    text: 'Customise it to advertise your business with your logo, a description and a link, as existing host locations have.',
  },
  {
    title: 'Live weather and conditions',
    text: 'Shown on your page next to the camera.',
  },
  {
    title: 'An embed for your website',
    text: 'Put the camera on your own site.',
  },
  {
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

const deal = [
  {
    k: 'You get',
    title: 'A live camera on NationCam',
    text: 'At no charge to you.',
    highlight: true,
  },
  {
    k: 'In return',
    title: 'The view is public',
    text: 'Anyone can watch it on NationCam.',
  },
  {
    k: 'The camera',
    title: 'Stays NationCam’s',
    text: 'The camera is owned by NationCam and stays NationCam’s property.',
  },
  {
    k: 'Selection',
    title: 'We choose the sites',
    text: 'Applying does not guarantee a camera.',
  },
]

const howItWorks = [
  {
    title: 'Tell us about your site',
    text: 'Fill in the form below: where it is and what the camera would look at.',
  },
  {
    title: 'We review it',
    text: 'We choose which sites get a camera, and we choose the camera for the site.',
  },
  {
    title: 'The camera goes up',
    text: 'Depending on where you are, we install it or you do, with our help.',
  },
]

const goodToKnow = [
  {
    k: 'Owner',
    text: 'The camera is owned by NationCam and stays NationCam’s property.',
  },
  { k: 'Condition', text: 'The camera may not be new.' },
  {
    k: 'Camera',
    text: 'We choose the camera for the site. We do not guarantee a resolution.',
  },
  {
    k: 'View',
    text: 'The view is public. Anyone can watch it on NationCam.',
  },
  {
    k: 'Selection',
    text: 'We choose which sites get a camera, so applying does not guarantee one.',
  },
]

const indexLabel = (i: number) => String(i + 1).padStart(2, '0')

const tick =
  "before:mr-2 before:inline-block before:h-0.5 before:w-3 before:align-middle before:bg-accent before:content-['']"

function FreeCameraPage() {
  return (
    <div className="page-container">
      {/* Hero */}
      <section aria-labelledby="fc-h1">
        <div className="grid grid-cols-1 items-center gap-12 min-[960px]:grid-cols-2 min-[960px]:gap-16">
          <div>
            <div
              aria-hidden="true"
              className="mb-7 h-[3px] w-16 bg-gradient-to-r from-accent to-accent-hover"
            />
            <Eyebrow variant="pill">Free camera</Eyebrow>
            <h1 id="fc-h1" className="text-h1">
              Get a <span className="text-accent-fg">free camera</span> for your
              site
            </h1>
            <p className="mt-5 max-w-[40ch] text-lede leading-normal text-subtext1">
              NationCam installs one of its cameras at a place worth watching,
              and the live view is public on NationCam.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 max-[480px]:[&>a]:w-full">
              <a
                href="#apply"
                className={buttonClasses({
                  variant: 'primary',
                  size: 'marketing',
                })}
              >
                Apply for a camera
                <ArrowRight size={16} aria-hidden="true" />
              </a>
              <Link
                to="/construction"
                className={buttonClasses({
                  variant: 'secondary',
                  size: 'marketing',
                })}
              >
                Need a private camera?
              </Link>
            </div>
          </div>

          <dl
            aria-label="The exchange"
            className="m-0 overflow-hidden rounded-xl bg-surface0 shadow-[0_0_0_1px_var(--color-border)]"
          >
            {deal.map((d) => (
              <div
                key={d.k}
                className={`grid grid-cols-1 gap-1.5 border-b border-border px-5 py-[18px] last:border-b-0 min-[520px]:grid-cols-[110px_1fr] min-[520px]:gap-4 ${
                  d.highlight
                    ? 'shadow-[inset_3px_0_0_var(--color-accent)]'
                    : ''
                }`}
              >
                <dt
                  className={`mono-label ${d.highlight ? 'font-semibold text-accent-ink' : ''}`}
                >
                  {d.k}
                </dt>
                <dd className="m-0 text-sm leading-normal text-subtext1">
                  <strong className="block font-display text-body leading-snug font-semibold tracking-tight text-text">
                    {d.title}
                  </strong>
                  {d.text}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* 01 What you get */}
      <section className="section-y" aria-labelledby="fc-get">
        <SectionHead
          number="01"
          eyebrow="What you get"
          id="fc-get"
          title="What you get"
          body="A camera, a page of your own, and a way onto your own website."
        />
        <RuledGrid
          as="ul"
          cols={2}
          className="lg:grid-cols-6 lg:[&>li]:col-span-2 lg:[&>li:nth-child(-n+2)]:col-span-3 max-lg:[&>li:first-child]:col-span-full"
        >
          {youGet.map((g, i) => (
            <RuledCell
              key={g.title}
              as="li"
              index={indexLabel(i)}
              title={g.title}
            >
              <p>{g.text}</p>
            </RuledCell>
          ))}
        </RuledGrid>
      </section>

      {/* 02 What we need */}
      <section className="section-y" aria-labelledby="fc-need">
        <SectionHead
          number="02"
          eyebrow="Requirements"
          id="fc-need"
          title="What we need from you"
          body="Four things at the site."
        />
        <div className="grid grid-cols-1 gap-8 min-[900px]:grid-cols-[7fr_5fr] min-[900px]:gap-16">
          <ol className="m-0 list-none border-t border-text p-0">
            {weNeed.map((item, i) => (
              <li
                key={item}
                className="grid grid-cols-[56px_1fr] items-baseline border-b border-border py-4"
              >
                <span className={`mono-label ${tick}`}>{indexLabel(i)}</span>
                <span className="font-display text-lg leading-snug font-semibold tracking-tight text-text">
                  {item}
                </span>
              </li>
            ))}
          </ol>
          <aside className="self-start rounded-xl border border-border bg-surface0 p-5 text-sm text-subtext1">
            <Eyebrow className="!mb-2.5">Installation</Eyebrow>
            <p className="mb-0 text-sm">
              Depending on where you are, we install it or you do, with our
              help.
            </p>
          </aside>
        </div>
      </section>

      {/* 03 How applying works */}
      <section className="section-y" aria-labelledby="fc-flow">
        <SectionHead
          number="03"
          eyebrow="Applying"
          id="fc-flow"
          title="How applying works"
          body="Three steps from application to a camera on site."
        />
        <ol className="m-0 grid list-none grid-cols-1 overflow-hidden rounded-xl border border-border bg-surface0 p-0 min-[768px]:grid-cols-3">
          {howItWorks.map((s, i) => (
            <li key={s.title} className="rule-cell min-w-0 px-6 py-5">
              <span className={`mono-label mb-4 flex items-center ${tick}`}>
                {indexLabel(i)}
              </span>
              <h3 className="mb-1.5">{s.title}</h3>
              <p className="mb-0 text-sm text-subtext1">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* 04 Apply */}
      <section
        id="apply"
        className="section-y scroll-mt-24"
        aria-labelledby="fc-app"
      >
        <SectionHead
          number="04"
          eyebrow="Application"
          id="fc-app"
          title="Apply for a camera"
          body="Tell us about your site. We will review it and get back to you."
        />
        <div className="grid grid-cols-1 gap-10 min-[960px]:grid-cols-[4fr_7fr] min-[960px]:gap-16">
          <aside aria-labelledby="fc-know" className="self-start">
            <Eyebrow>
              <span id="fc-know">Good to know</span>
            </Eyebrow>
            <dl className="m-0 border-t border-border">
              {goodToKnow.map((g) => (
                <div
                  key={g.k}
                  className="grid gap-1 border-b border-border py-3 text-sm"
                >
                  <dt className="mono-label">{g.k}</dt>
                  <dd className="m-0 text-text">{g.text}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 mb-0 text-body text-subtext1">
              Need a private camera for a job site?{' '}
              <Link
                to="/construction"
                className="font-medium text-accent-ink underline underline-offset-2"
              >
                See construction cameras.
              </Link>
            </p>
          </aside>
          <ApplyForm />
        </div>
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
        company: form.company.trim(),
        phone: form.phone.trim(),
        site_city: form.city.trim(),
        site_state: form.state.trim(),
        details: {
          view: form.views.trim(),
          site_type: labelFor(siteTypeOptions, form.siteType),
          power: labelFor(yesNoOptions, form.power),
          internet: labelFor(yesNoOptions, form.internet),
          installer: labelFor(installOptions, form.install),
        },
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
      <Panel
        accentTop
        padding="lg"
        className="flex flex-col items-center py-12 text-center"
      >
        <CheckCircle size={48} className="mb-4 text-accent-fg" />
        <h3>Thank you!</h3>
        <p className="mb-0 max-w-sm">
          We have received your application. Our team will review it and get
          back to you soon.
        </p>
      </Panel>
    )
  }

  const text = (field: TextField, id: string) => ({
    id,
    value: form[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      update(field, e.target.value),
  })
  const select = (field: TextField, id: string) => ({
    id,
    value: form[field],
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
      update(field, e.target.value),
  })
  const optionsOf = (options: Array<{ value: string; label: string }>) => (
    <>
      <option value="">Select…</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </>
  )

  return (
    <Panel accentTop padding="lg">
      <form onSubmit={handleSubmit} noValidate className="grid gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="fc-name" required>
            <Input
              {...text('name', 'fc-name')}
              maxLength={100}
              autoComplete="name"
            />
          </Field>
          <Field label="Business or organisation" htmlFor="fc-company" required>
            <Input
              {...text('company', 'fc-company')}
              maxLength={120}
              autoComplete="organization"
            />
          </Field>
          <Field label="Email" htmlFor="fc-email" required>
            <Input
              {...text('email', 'fc-email')}
              type="email"
              maxLength={200}
              autoComplete="email"
            />
          </Field>
          <Field label="Phone" htmlFor="fc-phone">
            <Input
              {...text('phone', 'fc-phone')}
              type="tel"
              maxLength={40}
              autoComplete="tel"
            />
          </Field>
          <Field label="Site city" htmlFor="fc-city" required>
            <Input {...text('city', 'fc-city')} maxLength={100} />
          </Field>
          <Field label="Site state" htmlFor="fc-state" required>
            <Input {...text('state', 'fc-state')} maxLength={60} />
          </Field>
        </div>

        <Field
          label="What the camera would look at"
          htmlFor="fc-views"
          required
        >
          <Input {...text('views', 'fc-views')} maxLength={300} />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Site type" htmlFor="fc-type" required>
            <Select {...select('siteType', 'fc-type')}>
              {optionsOf(siteTypeOptions)}
            </Select>
          </Field>
          <Field label="Who would install" htmlFor="fc-install" required>
            <Select {...select('install', 'fc-install')}>
              {optionsOf(installOptions)}
            </Select>
          </Field>
          <Field
            label="Power available at the mounting spot"
            htmlFor="fc-power"
            required
          >
            <Select {...select('power', 'fc-power')}>
              {optionsOf(yesNoOptions)}
            </Select>
          </Field>
          <Field
            label="Internet available at the site"
            htmlFor="fc-internet"
            required
          >
            <Select {...select('internet', 'fc-internet')}>
              {optionsOf(yesNoOptions)}
            </Select>
          </Field>
        </div>

        <Field label="Notes" htmlFor="fc-notes">
          <Textarea
            id="fc-notes"
            rows={4}
            maxLength={NOTES_MAX_CHARS}
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
          />
        </Field>

        {error && (
          <p
            role="alert"
            className="mb-0 rounded-r-md border-l-2 border-live bg-live-glow px-3 py-2.5 text-sm font-medium text-text"
          >
            {error}
          </p>
        )}

        <Button
          text={submitting ? 'Sending...' : 'Apply for a camera'}
          type="submit"
          size="marketing"
          block
          disabled={submitting}
        />

        <p className="mb-0 text-center text-xs text-subtext1">
          Your information is kept private and never shared with third parties.
        </p>
      </form>
    </Panel>
  )
}
