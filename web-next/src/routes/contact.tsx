import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Camera, CheckCircle, Mail } from 'lucide-react'
import Dropdown from '@/components/Dropdown'
import Button from '@/components/Button'
import Reveal from '@/components/Reveal'
import { seo } from '@/lib/seo'

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

function ContactPage() {
  return (
    <div className="page-container">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-5">
        {/* Left — Info panel, slides from left */}
        <Reveal variant="left" className="lg:col-span-2">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-4 py-1.5">
              <Camera size={14} className="text-accent" />
              <span className="font-mono text-xs font-medium text-accent">
                Join the network
              </span>
            </div>
            <h1>Get Your Camera on NationCam</h1>
            <p>
              Fill out the form and our team will review your submission and get
              back to you about getting your camera live on the platform.
            </p>

            <div className="mt-8 space-y-4">
              <div className="flex items-start gap-3">
                <CheckCircle
                  size={18}
                  className="mt-0.5 shrink-0 text-accent"
                />
                <div>
                  <p className="mb-0 font-sans text-sm font-medium text-text">
                    Free to join
                  </p>
                  <p className="mb-0 text-sm text-subtext0">
                    No fees or hidden costs for camera hosts.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle
                  size={18}
                  className="mt-0.5 shrink-0 text-accent"
                />
                <div>
                  <p className="mb-0 font-sans text-sm font-medium text-text">
                    Quick setup
                  </p>
                  <p className="mb-0 text-sm text-subtext0">
                    We handle the technical integration for you.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle
                  size={18}
                  className="mt-0.5 shrink-0 text-accent"
                />
                <div>
                  <p className="mb-0 font-sans text-sm font-medium text-text">
                    Full support
                  </p>
                  <p className="mb-0 text-sm text-subtext0">
                    Our team is available to help with any questions.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8 flex items-center gap-2 text-subtext0">
              <Mail size={14} />
              <span className="font-mono text-sm">support@nationcam.com</span>
            </div>
          </div>
        </Reveal>

        {/* Right — Form, slides from right */}
        <Reveal variant="right" className="lg:col-span-3">
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

function ContactForm() {
  const [form, setForm] = useState<FormData>({
    firstName: '',
    lastName: '',
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
  const [error, setError] = useState('')

  const update = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const required: Array<keyof FormData> = [
      'firstName',
      'lastName',
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

    // TODO: Submit form data to server
    setSubmitted(true)
    setError('')
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
          We have received your submission. Our team will review it and get back
          to you soon.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="section-container space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="First Name"
          required
          value={form.firstName}
          onChange={(v) => update('firstName', v)}
        />
        <Input
          label="Last Name"
          required
          value={form.lastName}
          onChange={(v) => update('lastName', v)}
        />
      </div>

      <Input
        label="Number of Cameras"
        required
        value={form.cameras}
        onChange={(v) => update('cameras', v)}
        type="number"
      />

      <Dropdown
        label="Do you have internet access? *"
        options={internetOptions}
        selectedValue={form.internet}
        onSelect={(v) => update('internet', String(v))}
      />

      <Input
        label="Street Address"
        required
        value={form.street}
        onChange={(v) => update('street', v)}
      />
      <Input
        label="Address Line 2"
        value={form.street2}
        onChange={(v) => update('street2', v)}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Input
          label="City"
          required
          value={form.city}
          onChange={(v) => update('city', v)}
        />
        <Input
          label="State"
          required
          value={form.state}
          onChange={(v) => update('state', v)}
        />
        <Input
          label="Postal Code"
          required
          value={form.postalCode}
          onChange={(v) => update('postalCode', v)}
        />
      </div>

      <Input
        label="Country"
        required
        value={form.country}
        onChange={(v) => update('country', v)}
      />

      <Dropdown
        label="When are you looking to start? *"
        options={timelineOptions}
        selectedValue={form.timeline}
        onSelect={(v) => update('timeline', String(v))}
      />

      {error && <p className="mb-0 text-sm font-medium text-live">{error}</p>}

      <Button
        text="Submit Application"
        type="submit"
        className="w-full"
        size="lg"
      />

      <p className="mb-0 text-center text-xs text-overlay2">
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
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <div>
      <label className="mb-1.5 block font-sans text-sm font-medium text-subtext1">
        {label}
        {required && <span className="ml-0.5 text-accent">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-overlay0 bg-base px-4 py-3 font-sans text-sm text-text transition-[border-color,box-shadow] duration-200 placeholder:text-overlay1 focus:border-accent focus:ring-2 focus:ring-accent-glow focus:outline-none"
      />
    </div>
  )
}
