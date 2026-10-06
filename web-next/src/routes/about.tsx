import { Link, createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { seo } from '@/lib/seo'
import SectionHead from '@/components/ui/SectionHead'
import { buttonClasses } from '@/components/Button'

export const Route = createFileRoute('/about')({
  head: () =>
    seo({
      title: 'About NationCam',
      description:
        'NationCam is a free network of live cameras across the United States — real-time views of marinas, waterfronts, landmarks, and communities, hosted by the businesses and people who know them best.',
      path: '/about',
    }),
  component: AboutPage,
})

function AboutSectionBlock({
  number,
  title,
  children,
}: {
  number: string
  title: string
  children: ReactNode
}) {
  return (
    <section className="section-y">
      <SectionHead eyebrow="About" number={number} title={title} stacked />
      <div className="max-w-[65ch] [&_p]:text-subtext1">{children}</div>
    </section>
  )
}

function AboutPage() {
  return (
    <div className="page-container">
      <article>
        <SectionHead as="h1" eyebrow="About" title="About NationCam" stacked />
        <div className="max-w-[65ch]">
          <p className="text-lede text-subtext1">
            NationCam is a free network of live cameras across the United
            States. We put real-time views of marinas, waterfronts, landmarks,
            and communities online so anyone can see what a place looks like
            right now — not a stock photo, not last summer, but this moment.
          </p>
        </div>

        <AboutSectionBlock number="01" title="Why we built it">
          <p>
            Some of the most useful information about a place is simply what it
            looks like today. An angler wants to see the water at the marina
            before driving down. A family wants to check the beach before
            packing the car. Someone far from home wants a live window onto the
            town they grew up in. Broadcast weather and photos only get you so
            far — a live camera answers the question directly.
          </p>
          <p>
            NationCam exists to make those windows easy to find and free to
            watch. Every camera on the network streams live, around the clock,
            with no subscription and no sign-up.
          </p>
        </AboutSectionBlock>

        <AboutSectionBlock number="02" title="Where we are">
          <p>
            We started in Louisiana, on the Gulf, with cameras at Venice Marina
            — one of the most active sport-fishing marinas in the country. From
            there we are growing state by state, working directly with the
            marinas, hotels, restaurants, and attractions that host each camera.
            Our goal is a live view from every state, and eventually from every
            community that wants one.
          </p>
        </AboutSectionBlock>

        <AboutSectionBlock number="03" title="How the cameras get here">
          <p>
            Every feed is hosted by a real business or property owner who wants
            to share their view. Hosting is free. NationCam supplies the camera;
            the host provides an internet connection to plug it into and a spot
            to mount it. We handle the streaming, the page, and the audience. In
            return the host gets a unique public page for their location &mdash;
            a live window their own customers can check any time, and one they
            can share and embed wherever they like.
          </p>
          <p>
            If you run a marina, a waterfront restaurant, a hotel with a view,
            or any place worth watching, we would love to hear from you.
          </p>
          <p className="mb-0">
            <Link
              to="/contact"
              className={buttonClasses({ variant: 'primary' })}
            >
              Host a camera &rarr;
            </Link>
          </p>
        </AboutSectionBlock>

        <AboutSectionBlock number="04" title="Get in touch">
          <p className="mb-0">
            Questions, press, partnerships, or a camera you think belongs on the
            network — reach us through our{' '}
            <Link
              to="/contact"
              className="text-accent-ink underline-offset-2 hover:underline"
            >
              contact page
            </Link>
            .
          </p>
        </AboutSectionBlock>
      </article>
    </div>
  )
}
