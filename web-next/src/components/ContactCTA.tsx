import { Link } from '@tanstack/react-router'
import { Camera } from 'lucide-react'
import Reveal from '@/components/Reveal'

export default function ContactCTA() {
  return (
    <section className="relative overflow-hidden py-20">
      {/* Atmospheric gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-teal/5" />

      <Reveal variant="scale">
        <div className="relative mx-auto max-w-3xl px-6 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-4 py-1.5">
            <Camera size={14} className="text-accent" />
            <span className="font-mono text-xs font-medium text-accent">
              Join the network
            </span>
          </div>
          <h2>Want your camera on our site?</h2>
          <p className="mx-auto max-w-xl">
            We are building a nationwide network of live cameras. If you have a
            camera you would like to share, we would love to hear from you.
          </p>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-8 py-3 font-sans font-semibold text-crust transition-[scale,background-color,box-shadow] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] hover:bg-accent-hover hover:shadow-lg active:scale-[0.98]"
          >
            Get in touch
          </Link>
        </div>
      </Reveal>
    </section>
  )
}
