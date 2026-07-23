import { Link, useLocation } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Github, Home, Mail, MapPin, Menu, Moon, Sun, X } from 'lucide-react'
import { useTheme } from '@/components/ThemeProvider'
import Logo from '@/components/Logo'
import UserMenu from '@/components/UserMenu'

const navLinks = [
  { to: '/' as const, label: 'Home', icon: Home },
  { to: '/locations' as const, label: 'Locations', icon: MapPin },
  { to: '/contact' as const, label: 'Contact', icon: Mail },
]

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const currentPath = location.pathname

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 16)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <nav
      className={`fixed top-0 right-0 left-0 z-40 border-b transition-[background,border-color,box-shadow] duration-300 ${
        scrolled
          ? 'glass-dense border-overlay0/50 shadow-lg'
          : 'border-transparent bg-transparent'
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        {/* Left: Logo */}
        <Logo />

        {/* Center: Desktop nav links with hover pill effect */}
        <ul className="hidden items-center gap-1 md:flex">
          {navLinks.map(({ to, label }) => {
            const isActive =
              to === '/' ? currentPath === '/' : currentPath.startsWith(to)
            return (
              <li key={to}>
                <Link
                  to={to}
                  className={`relative rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-300 ease-[var(--spring-smooth)] ${
                    isActive
                      ? 'bg-accent/10 text-accent'
                      : 'text-subtext1 hover:text-text hover:bg-surface0/50'
                  }`}
                >
                  {label}
                  {/* Active underline indicator */}
                  <span
                    className={`absolute right-2 bottom-0.5 left-2 h-0.5 rounded-full bg-accent transition-[transform,opacity] duration-350 ease-[var(--spring-snappy)] ${
                      isActive
                        ? 'scale-x-100 opacity-100'
                        : 'scale-x-0 opacity-0'
                    }`}
                  />
                </Link>
              </li>
            )
          })}
        </ul>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          <a
            href="https://github.com/brandon-relentnet/nationcam"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg p-2 text-subtext0 transition-[scale,color,background-color] duration-200 ease-[var(--spring-gentle)] hover:scale-110 hover:text-text hover:bg-surface0/50"
            aria-label="GitHub"
          >
            <Github size={18} />
          </a>
          <button
            onClick={toggleTheme}
            className="rounded-lg p-2 text-subtext0 transition-[scale,color,background-color] duration-200 ease-[var(--spring-gentle)] hover:scale-110 hover:text-accent hover:bg-surface0/50"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* User avatar / sign-in — desktop */}
          <div className="hidden md:block">
            <UserMenu />
          </div>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="rounded-lg p-2 text-subtext0 transition-[scale,color,background-color] duration-200 ease-[var(--spring-gentle)] hover:scale-110 hover:text-text hover:bg-surface0/50 md:hidden"
            aria-label="Toggle menu"
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile menu — smooth spring slide. Collapses to zero height when
          closed (max-height, not clip-path) so the fixed <nav> shrinks back to
          just the top bar; clip-path only hid the paint, leaving a tall layout
          box that painted the scrolled glass background over the page. */}
      <div
        className={`overflow-hidden border-t transition-[max-height,opacity] duration-500 ease-[var(--spring-smooth)] md:hidden ${
          menuOpen
            ? 'max-h-96 border-overlay0/30 opacity-100'
            : 'max-h-0 border-transparent opacity-0'
        }`}
      >
        <div className="glass-dense px-4 pb-4 pt-2">
          <ul className="flex flex-col gap-1">
            {navLinks.map(({ to, label, icon: Icon }, index) => {
              const isActive =
                to === '/' ? currentPath === '/' : currentPath.startsWith(to)
              return (
                <li
                  key={to}
                  style={{
                    opacity: menuOpen ? 1 : 0,
                    transform: menuOpen ? 'translateX(0)' : 'translateX(-12px)',
                    transition: `opacity 300ms ease ${index * 60}ms, transform 400ms var(--spring-smooth) ${index * 60}ms`,
                  }}
                >
                  <Link
                    to={to}
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors duration-200 ${
                      isActive
                        ? 'bg-accent/10 text-accent'
                        : 'text-subtext1 hover:text-text hover:bg-surface0/50'
                    }`}
                  >
                    <Icon size={18} />
                    <span>{label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>

          {/* Mobile auth section */}
          <div className="mt-2 border-t border-overlay0/30 pt-2">
            <UserMenu />
          </div>
        </div>
      </div>
    </nav>
  )
}
