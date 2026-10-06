import { Link } from '@tanstack/react-router'
import Reveal from '@/components/Reveal'
import { buttonClasses } from '@/components/Button'

export default function ContactCTA() {
  return (
    <section className="measure section-y pb-[var(--section-y)]">
      <Reveal variant="scale">
        <div className="grid items-center gap-4 rounded-xl border border-border bg-surface0 p-6 shadow-[inset_3px_0_0_var(--color-accent)] md:grid-cols-[1fr_auto] md:gap-8">
          <div>
            <p className="mono-label mb-2">Join the network</p>
            <h2 className="mb-2 font-display text-xl font-semibold">
              Want your camera on our site?
            </h2>
            <p className="mb-0 max-w-[60ch] text-subtext1">
              We are building a nationwide network of live cameras. If you have
              a camera you would like to share, we would love to hear from you.
            </p>
          </div>
          <Link to="/contact" className={buttonClasses({ variant: 'primary' })}>
            Get in touch
          </Link>
        </div>
      </Reveal>
    </section>
  )
}
