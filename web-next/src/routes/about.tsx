import { Link, createFileRoute } from '@tanstack/react-router'
import { seo } from '@/lib/seo'

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

function AboutPage() {
  return (
    <div className="page-container">
      <article className="mx-auto max-w-3xl">
        <h1>About NationCam</h1>
        <p>
          NationCam is a free network of live cameras across the United States.
          We put real-time views of marinas, waterfronts, landmarks, and
          communities online so anyone can see what a place looks like right
          now — not a stock photo, not last summer, but this moment.
        </p>

        <h2>Why we built it</h2>
        <p>
          Some of the most useful information about a place is simply what it
          looks like today. An angler wants to see the water at the marina
          before driving down. A family wants to check the beach before packing
          the car. Someone far from home wants a live window onto the town they
          grew up in. Broadcast weather and photos only get you so far — a live
          camera answers the question directly.
        </p>
        <p>
          NationCam exists to make those windows easy to find and free to watch.
          Every camera on the network streams live, around the clock, with no
          subscription and no sign-up.
        </p>

        <h2>Where we are</h2>
        <p>
          We started in Louisiana, on the Gulf, with cameras at Venice Marina —
          one of the most active sport-fishing marinas in the country. From
          there we are growing state by state, working directly with the
          marinas, hotels, restaurants, and attractions that host each camera.
          Our goal is a live view from every state, and eventually from every
          community that wants one.
        </p>

        <h2>How the cameras get here</h2>
        <p>
          Every feed is hosted by a real business or property owner who wants
          to share their view. Hosting is free. A host provides the camera and
          an internet connection; we handle the streaming, the page, and the
          audience. In return the host gets a live, public window onto their
          location that their own customers can check any time.
        </p>
        <p>
          If you run a marina, a waterfront restaurant, a hotel with a view, or
          any place worth watching, we would love to hear from you.
        </p>
        <p>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-sans font-semibold text-crust transition-[scale,background-color] duration-350 ease-[var(--spring-snappy)] hover:scale-[1.02] hover:bg-accent-hover active:scale-[0.98]"
          >
            Host a camera &rarr;
          </Link>
        </p>

        <h2>Get in touch</h2>
        <p>
          Questions, press, partnerships, or a camera you think belongs on the
          network — reach us through our{' '}
          <Link to="/contact" className="text-accent hover:underline">
            contact page
          </Link>
          .
        </p>
      </article>
    </div>
  )
}
