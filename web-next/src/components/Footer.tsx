import { Link } from '@tanstack/react-router'
import { Camera, Github, Mail } from 'lucide-react'

const footerSections = [
  {
    title: 'Explore',
    links: [
      { label: 'All Locations', to: '/locations' },
      { label: 'Louisiana', to: '/locations/louisiana' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Contact', to: '/contact' },
      { label: 'Add Your Camera', to: '/contact' },
    ],
  },
]

export default function Footer() {
  return (
    <footer className="border-t border-overlay0/40 bg-mantle">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand column */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2.5">
              <Camera size={20} className="text-accent" />
              <span className="font-display text-lg font-bold tracking-tight text-text">
                Nation<span className="text-accent">Cam</span>
              </span>
            </div>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-subtext0">
              Live cameras from across the United States. Explore cities,
              landmarks, and communities through real-time video feeds.
            </p>
            <div className="mt-4 flex gap-3">
              <a
                href="https://github.com/brandon-relentnet/nationcam"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg p-2 text-subtext0 transition-colors hover:text-accent hover:bg-surface0"
                aria-label="GitHub"
              >
                <Github size={18} />
              </a>
              <Link
                to="/contact"
                className="rounded-lg p-2 text-subtext0 transition-colors hover:text-accent hover:bg-surface0"
                aria-label="Contact"
              >
                <Mail size={18} />
              </Link>
            </div>
          </div>

          {/* Link columns */}
          {footerSections.map((section) => (
            <div key={section.title}>
              <h6 className="mb-3 font-mono text-xs font-semibold tracking-widest text-subtext0 uppercase">
                {section.title}
              </h6>
              <ul className="space-y-2">
                {section.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.to}
                      className="text-sm text-subtext1 transition-colors hover:text-accent"
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
        <div className="mt-10 border-t border-overlay0/30 pt-6">
          <p className="mb-0 font-mono text-xs text-subtext0">
            &copy; {new Date().getFullYear()} NationCam. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
