import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Camera,
  ChevronDown,
  Globe,
  Map,
  MonitorPlay,
  Radio,
} from 'lucide-react'
import StreamPlayer from '@/components/StreamPlayer'
import ContactCTA from '@/components/ContactCTA'
import Reveal from '@/components/Reveal'
import { seo } from '@/lib/seo'

export const Route = createFileRoute('/')({
  head: () =>
    seo({
      title: 'NationCam — Live Cameras Across America',
      description:
        'Watch live camera feeds from cities, landmarks, and communities across the United States. Free, real-time streams from coast to coast.',
      path: '/',
    }),
  component: HomePage,
})

function HomePage() {
  return (
    <div>
      <HomeHeroSection />
      <FeaturedStream />
      <StatsSection />
      <FAQSection />
      <ContactCTA />
    </div>
  )
}

/* ──────────────────── Hero ──────────────────── */

function HomeHeroSection() {
  return (
    <section className="relative overflow-hidden">
      {/* Background video */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
      >
        <source src="/videos/nc_default_hero.webm" type="video/webm" />
      </video>

      {/* Dual gradient overlays */}
      <div className="absolute inset-0 bg-crust/70" />
      <div className="absolute inset-0 bg-gradient-to-t from-base via-transparent to-transparent" />

      <div className="relative z-10 flex min-h-[85vh] flex-col items-center justify-center px-6 text-center">
        {/* Pill badge — blur-in entrance */}
        <div
          className="mb-8 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-4 py-1.5"
          style={{ animation: 'blur-in 600ms var(--spring-ease-out) forwards' }}
        >
          <Radio size={14} className="text-accent" />
          <span className="font-mono text-xs font-medium text-accent">
            Live cameras across America
          </span>
        </div>

        {/* Headline — float up with bounce spring */}
        <h1
          className="mx-auto max-w-4xl text-white drop-shadow-2xl"
          style={{
            opacity: 0,
            animation: 'float-up 800ms var(--spring-bounce) 100ms forwards',
          }}
        >
          See America{' '}
          <span className="bg-gradient-to-r from-accent to-amber-300 bg-clip-text text-transparent">
            in real time
          </span>
        </h1>

        {/* Subtitle — slide in from right with stagger */}
        <p
          className="mx-auto max-w-xl text-lg text-gray-300"
          style={{
            opacity: 0,
            animation:
              'slide-in-right 700ms var(--spring-smooth) 250ms forwards',
          }}
        >
          Explore cities, landmarks, and communities through live camera feeds
          from coast to coast.
        </p>

        {/* CTA buttons — scale-fade-in with poppy spring */}
        <div
          className="mt-4 flex flex-wrap items-center justify-center gap-4"
          style={{
            opacity: 0,
            animation: 'scale-fade-in 600ms var(--spring-poppy) 450ms forwards',
          }}
        >
          <Link
            to="/locations"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-8 py-3 font-sans font-semibold text-crust transition-[scale,background-color,box-shadow] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] hover:bg-accent-hover hover:shadow-lg active:scale-[0.98]"
          >
            <Map size={18} />
            Explore Locations
          </Link>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-8 py-3 font-sans font-semibold text-white backdrop-blur-sm transition-[scale,border-color,background-color] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] hover:border-white/40 hover:bg-white/10 active:scale-[0.98]"
          >
            Add Your Camera
          </Link>
        </div>

        {/* Scroll indicator — delayed fade in */}
        <div
          className="absolute bottom-8 flex flex-col items-center gap-2"
          style={{
            opacity: 0,
            animation: 'fade-in 1s ease 1.4s forwards',
          }}
        >
          <span className="font-mono text-[10px] tracking-widest text-white/40 uppercase">
            Scroll
          </span>
          <ChevronDown size={16} className="animate-bounce text-white/30" />
        </div>
      </div>

      {/* Bottom gradient fade */}
      <div className="absolute right-0 bottom-0 left-0 h-32 bg-gradient-to-t from-base to-transparent" />
    </section>
  )
}

/* ──────────────────── Featured Stream ──────────────────── */

function FeaturedStream() {
  return (
    <section className="py-20">
      <Reveal variant="blur">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-4 py-1.5">
              <MonitorPlay size={14} className="text-accent" />
              <span className="font-mono text-xs font-medium text-accent">
                Featured camera
              </span>
            </div>
            <h2>Watch Now</h2>
            <p className="mx-auto max-w-lg">
              A live look from our network. Tune in to see what is happening
              right now.
            </p>
          </div>

          <div className="glow-accent overflow-hidden rounded-2xl">
            <StreamPlayer
              src="https://streamer.nationcam.com/memfs/4cdb363f-2bfa-4a0a-b954-ac9b16200665.m3u8"
              autoplay
              muted
              live
              fluid
              audioChannels
            />
          </div>
        </div>
      </Reveal>
    </section>
  )
}

/* ──────────────────── Stats ──────────────────── */

function StatsSection() {
  const stats = [
    {
      icon: Camera,
      value: '1,250',
      label: 'Cameras Planned',
    },
    {
      icon: Globe,
      value: '50',
      label: 'States',
    },
    {
      icon: Map,
      value: '25',
      label: 'Starting in Louisiana',
    },
  ]

  return (
    <section className="bg-surface0 py-20">
      <Reveal stagger>
        <div className="mx-auto max-w-5xl px-6 text-center">
          <h2>Our Planned Network</h2>
          <p className="mx-auto max-w-lg">
            Building a nationwide network of live cameras, starting with
            Louisiana and expanding across all 50 states.
          </p>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="reveal-scale section-container flex flex-col items-center gap-3 py-8 transition-[scale,border-color] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] hover:border-accent/30"
              >
                <stat.icon size={24} className="text-accent" />
                <div className="font-mono text-4xl font-bold text-accent">
                  {stat.value}
                </div>
                <div className="text-sm text-subtext0">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  )
}

/* ──────────────────── FAQ ──────────────────── */

const faqItems = [
  {
    question: 'What is NationCam?',
    answer:
      'NationCam is a platform that provides live camera feeds from locations across the United States, allowing you to explore different cities and landmarks in real time.',
  },
  {
    question: 'How can I add my camera?',
    answer:
      'Visit our Contact page and fill out the form with your camera details. Our team will review your submission and get back to you.',
  },
  {
    question: 'Is NationCam free to use?',
    answer:
      'Yes, viewing live camera feeds on NationCam is completely free for all users.',
  },
  {
    question: 'What kind of cameras are supported?',
    answer:
      'We support a variety of camera types including IP cameras, HLS streams, and DASH streams. Contact us for specific compatibility questions.',
  },
]

function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <section className="py-20">
      <Reveal variant="float">
        <div className="mx-auto max-w-3xl px-6">
          <div className="mb-10 text-center">
            <h2>Frequently Asked Questions</h2>
            <p className="mx-auto max-w-lg">
              Everything you need to know about NationCam.
            </p>
          </div>
          <Reveal stagger>
            <div className="space-y-3">
              {faqItems.map((item, index) => (
                <div
                  key={index}
                  className="reveal-left overflow-hidden rounded-xl border border-overlay0 bg-surface0 transition-colors duration-200"
                >
                  <button
                    onClick={() =>
                      setOpenIndex(openIndex === index ? null : index)
                    }
                    className="flex w-full items-center justify-between px-6 py-5 text-left text-text transition-colors hover:bg-mantle"
                  >
                    <span className="font-sans font-medium">
                      {item.question}
                    </span>
                    <ChevronDown
                      size={18}
                      className={`shrink-0 text-subtext0 transition-transform duration-350 ease-[var(--spring-snappy)] ${
                        openIndex === index ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  <div
                    className={`grid transition-[grid-template-rows,padding] duration-350 ease-[var(--spring-smooth)] ${
                      openIndex === index
                        ? 'grid-rows-[1fr] pb-5'
                        : 'grid-rows-[0fr]'
                    }`}
                  >
                    <div className="overflow-hidden px-6">
                      <p className="mb-0 text-subtext1">{item.answer}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </Reveal>
    </section>
  )
}
