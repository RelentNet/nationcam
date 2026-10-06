import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { CheckCircle, Mail } from 'lucide-react'
import type { ReactNode } from 'react'
import Button from '@/components/Button'
import Reveal from '@/components/Reveal'
import Panel from '@/components/ui/Panel'
import SectionHead from '@/components/ui/SectionHead'
import Field, { Input, Select } from '@/components/ui/Field'
import { seo } from '@/lib/seo'
import { submitContact } from '@/lib/api'

export const Route = createFileRoute('/contact')({
  head: () =>
    seo({
      title: 'Add Your Camera | NationCam',
      description:
        'Get your live camera on NationCam. Free to join, quick setup, and full support — tell us about your camera and our team will get it live.',
      path: '/contact',
    }),
  component: ContactPage,
})

const perks = [
  {
    title: 'Free to join',
    body: 'No fees or hidden costs for camera hosts.',
  },
  {
    title: 'Quick setup',
    body: 'We handle the technical integration for you.',
  },
  {
    title: 'Full support',
    body: 'Our team is available to help with any questions.',
  },
]

function ContactPage() {
  return (
    <div className="page-container">
      <div className="grid grid-cols-1 gap-10 min-[960px]:grid-cols-[4fr_7fr] min-[960px]:gap-16">
        <Reveal variant="left">
          <div>
            <SectionHead
              as="h1"
              eyebrow="Join the network"
              title="Get Your Camera on NationCam"
              body="Fill out the form and our team will review your submission and get back to you about getting your camera live on the platform."
              stacked
              className="mb-8"
            />
            <ul className="border-t border-border">
              {perks.map((p) => (
                <li
                  key={p.title}
                  className="flex items-start gap-3 border-b border-border py-4"
                >
                  <CheckCircle
                    size={18}
                    className="mt-0.5 shrink-0 text-accent-fg"
                  />
                  <div>
                    <p className="mb-0 font-sans text-sm font-medium text-text">
                      {p.title}
                    </p>
                    <p className="mb-0 text-sm text-subtext1">{p.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex items-center gap-2 text-subtext1">
              <Mail size={14} />
              <span className="font-mono text-sm">support@nationcam.com</span>
            </div>
          </div>
        </Reveal>

        <Reveal variant="blur">
          <div>
            <ContactForm />
          </div>
        </Reveal>
      </div>
    </div>
  )
}

const internetOptions = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: 'Unsure' },
]

const timelineOptions = [
  { value: 'asap', label: 'As soon as possible' },
  { value: '1-3months', label: '1-3 months' },
  { value: '3-6months', label: '3-6 months' },
  { value: '6months+', label: '6+ months' },
]

interface FormData {
  firstName: string
  lastName: string
  email: string
  cameras: string
  internet: string
  street: string
  street2: string
  city: string
  state: string
  postalCode: string
  country: string
  timeline: string
}

const labelFor = (
  options: Array<{ value: string; label: string }>,
  value: string,
) => options.find((o) => o.value === value)?.label ?? value

// Pack the structured application fields into one readable message body so the
// backend stays a generic name/email/message contact store. Rendered as plain
// text in the dashboard.
function buildMessage(form: FormData): string {
  const address = [
    form.street,
    form.street2,
    `${form.city}, ${form.state} ${form.postalCode}`,
    form.country,
  ]
    .filter((line) => line.trim())
    .join('\n')

  return [
    `Number of cameras: ${form.cameras}`,
    `Internet access: ${labelFor(internetOptions, form.internet)}`,
    `Timeline: ${labelFor(timelineOptions, form.timeline)}`,
    '',
    'Address:',
    address,
  ].join('\n')
}

function ContactForm() {
  const [form, setForm] = useState<FormData>({
    firstName: '',
    lastName: '',
    email: '',
    cameras: '',
    internet: '',
    street: '',
    street2: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
    timeline: '',
  })
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const update = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const required: Array<keyof FormData> = [
      'firstName',
      'lastName',
      'email',
      'cameras',
      'internet',
      'street',
      'city',
      'state',
      'postalCode',
      'country',
      'timeline',
    ]
    const missing = required.filter((f) => !form[f])
    if (missing.length > 0) {
      setError('Please fill out all required fields.')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      await submitContact({
        name: `${form.firstName} ${form.lastName}`.trim(),
        email: form.email,
        message: buildMessage(form),
        kind: 'camera',
        // Structured copies of the answers; trimmed to the API's caps so a long
        // entry can never turn a submission that used to work into a 400.
        site_city: form.city.trim().slice(0, 100),
        site_state: form.state.trim().slice(0, 60),
        details: {
          cameras: Number.isFinite(Number(form.cameras))
            ? Number(form.cameras)
            : form.cameras.trim().slice(0, 500),
          internet: labelFor(internetOptions, form.internet),
          timeline: labelFor(timelineOptions, form.timeline),
          street: form.street.trim().slice(0, 500),
          street2: form.street2.trim().slice(0, 500),
          postal_code: form.postalCode.trim().slice(0, 500),
          country: form.country.trim().slice(0, 500),
        },
      })
      setSubmitted(true)
    } catch {
      setError(
        'Something went wrong submitting your application. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <Panel
        accentTop
        padding="lg"
        className="flex flex-col items-center text-center"
      >
        <CheckCircle size={48} className="mb-4 text-accent-fg" />
        <h3 className="mb-2 text-xl">Thank you!</h3>
        <p className="mb-0 max-w-sm text-subtext1">
          We have received your submission. Our team will review it and get back
          to you soon.
        </p>
      </Panel>
    )
  }

  const text = (
    id: keyof FormData,
    label: string,
    opts: { required?: boolean; type?: string } = {},
  ) => (
    <Field label={label} htmlFor={id} required={opts.required}>
      <Input
        id={id}
        type={opts.type ?? 'text'}
        value={form[id]}
        onChange={(e) => update(id, e.target.value)}
      />
    </Field>
  )

  const choice = (
    id: keyof FormData,
    label: string,
    options: Array<{ value: string; label: string }>,
  ) => (
    <Field label={label} htmlFor={id} required>
      <Select
        id={id}
        value={form[id]}
        onChange={(e) => update(id, e.target.value)}
      >
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  )

  return (
    <Panel accentTop padding="lg">
      <form onSubmit={handleSubmit} className="grid gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {text('firstName', 'First Name', { required: true })}
          {text('lastName', 'Last Name', { required: true })}
        </div>
        {text('email', 'Email', { required: true, type: 'email' })}
        {text('cameras', 'Number of Cameras', {
          required: true,
          type: 'number',
        })}
        {choice('internet', 'Do you have internet access?', internetOptions)}
        {text('street', 'Street Address', { required: true })}
        {text('street2', 'Address Line 2')}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {text('city', 'City', { required: true })}
          {text('state', 'State', { required: true })}
          {text('postalCode', 'Postal Code', { required: true })}
        </div>
        {text('country', 'Country', { required: true })}
        {choice('timeline', 'When are you looking to start?', timelineOptions)}

        {error && (
          <p
            role="alert"
            className="mb-0 rounded-r-md border-l-2 border-live bg-live-glow px-3 py-2.5 text-sm font-medium text-text"
          >
            {error}
          </p>
        )}

        <Button
          text={submitting ? 'Submitting...' : 'Submit Application'}
          type="submit"
          block
          size="lg"
          disabled={submitting}
        />

        <p className="mb-0 text-center text-xs text-subtext1">
          Your information is kept private and never shared with third parties.
        </p>
      </form>
    </Panel>
  )
}
