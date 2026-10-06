import { Link } from '@tanstack/react-router'
import Logo from '@/components/Logo'

const footerSections = [
  {
    title: 'Explore',
    links: [
      { label: 'All Locations', to: '/locations' },
      { label: 'Louisiana', to: '/locations/louisiana' },
      { label: 'Field Notes', to: '/notes' },
      { label: 'Events', to: '/events' },
      { label: 'Construction', to: '/construction' },
      { label: 'Free Camera', to: '/free-camera' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', to: '/about' },
      { label: 'Contact', to: '/contact' },
      { label: 'Add Your Camera', to: '/contact' },
      { label: 'Privacy Policy', to: '/privacy' },
      { label: 'Terms of Service', to: '/terms' },
    ],
  },
]

export default function Footer() {
  return (
    <footer className="border-t border-border bg-mantle">
      <div className="measure pt-14 pb-8">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-[2fr_1fr_1fr]">
          {/* Brand column */}
          <div>
            <Logo />
            <p className="mt-3.5 mb-0 font-mono text-[11px] leading-none tracking-[0.2em] text-subtext1 uppercase">
              Live views. Anywhere.
            </p>
            <p className="mt-3 mb-0 max-w-[40ch] text-sm leading-[1.55] text-subtext1">
              Live cameras from across the United States. Explore cities,
              landmarks, and communities through real-time video feeds.
            </p>
          </div>

          {/* Link columns */}
          {footerSections.map((section) => (
            <div key={section.title}>
              <h2 className="mono-label mb-3.5">{section.title}</h2>
              <ul className="grid gap-2.5">
                {section.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.to}
                      className="text-sm text-subtext1 underline-offset-[3px] transition-colors hover:text-accent-ink hover:underline hover:decoration-accent"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-12 flex flex-wrap justify-between gap-2 border-t border-border pt-5 font-mono text-xs leading-[1.4] text-subtext1">
          <span>
            &copy; {new Date().getFullYear()} NationCam. All rights reserved.
          </span>
          <Link
            to="/contact"
            className="underline-offset-[3px] transition-colors hover:text-accent-ink hover:underline hover:decoration-accent"
          >
            Contact us
          </Link>
        </div>
      </div>
    </footer>
  )
}
