import { Link, useLocation } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  Camera,
  HardHat,
  Home,
  Mail,
  MapPin,
  Menu,
  Moon,
  Search,
  Sun,
  X,
} from 'lucide-react'
import { useTheme } from '@/components/ThemeProvider'
import CameraSearch from '@/components/CameraSearch'
import Logo from '@/components/Logo'
import UserMenu from '@/components/UserMenu'

/** Elements Ctrl-K/Cmd-K should not hijack away from normal typing. */
function isEditableElement(node: Element | null): boolean {
  if (!node) return false
  const tag = node.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return node instanceof HTMLElement && node.isContentEditable
}

const navLinks = [
  { to: '/' as const, label: 'Home', icon: Home },
  { to: '/locations' as const, label: 'Locations', icon: MapPin },
  { to: '/construction' as const, label: 'Construction', icon: HardHat },
  { to: '/free-camera' as const, label: 'Free Camera', icon: Camera },
  { to: '/contact' as const, label: 'Contact', icon: Mail },
]

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const currentPath = location.pathname

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 16)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Sitewide Ctrl-K / Cmd-K quick-jump — ignored while typing anywhere else.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 'k' || !(e.ctrlKey || e.metaKey)) return
      if (isEditableElement(document.activeElement)) return
      e.preventDefault()
      setSearchOpen(true)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <nav
      aria-label="Main"
      className={`fixed top-0 right-0 left-0 z-40 border-b border-border transition-shadow duration-300 ${
        scrolled ? 'shadow-lg' : ''
      }`}
    >
      {/* Glass lives on its own layer: a backdrop-filter on the <nav> itself
          would become the containing block for the fixed CameraSearch dialog. */}
      <div aria-hidden="true" className="glass-dense absolute inset-0 -z-10" />
      <div className="measure flex h-(--nav-h) items-center gap-3 sm:gap-6">
        {/* Left: Logo */}
        <Logo />

        {/* Desktop nav links — orange underline marks the current page */}
        <ul className="ml-2 hidden items-center gap-1 lg:flex">
          {navLinks.map(({ to, label }) => {
            const isActive =
              to === '/' ? currentPath === '/' : currentPath.startsWith(to)
            return (
              <li key={to}>
                <Link
                  to={to}
                  aria-current={isActive ? 'page' : undefined}
                  className={`block px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors duration-150 ${
                    isActive
                      ? 'rounded-none font-medium text-accent-ink shadow-[inset_0_-2px_0_var(--color-accent)]'
                      : 'rounded-md text-subtext1 hover:bg-surface1 hover:text-accent-ink'
                  }`}
                >
                  {label}
                </Link>
              </li>
            )
          })}
        </ul>

        {/* Right: Actions */}
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center gap-2.5 sm:h-10 sm:w-10 rounded-md border border-border bg-surface0 text-sm text-subtext1 transition-colors duration-150 hover:border-accent hover:text-accent-ink lg:w-auto lg:justify-start lg:pr-2 lg:pl-3"
          >
            <Search size={16} />
            {/* Icon-only below lg: the name comes from this text, so a visible
                label is never missing from the accessible name. */}
            <span className="sr-only lg:hidden">Search cameras</span>
            <span className="hidden lg:inline">Search cameras</span>
            <kbd className="hidden rounded-sm border border-border px-1.5 py-[3px] font-mono text-[11px] leading-none text-label lg:inline">
              Ctrl K
            </kbd>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-text sm:h-10 sm:w-10 transition-colors duration-150 hover:border-accent hover:text-accent-ink"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* User avatar / sign-in — desktop */}
          <div className="hidden lg:block">
            <UserMenu />
          </div>

          {/* Mobile menu toggle */}
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-text sm:h-10 sm:w-10 transition-colors duration-150 hover:border-accent hover:text-accent-ink lg:hidden"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {/* Mobile menu — smooth spring slide. Collapses to zero height when
          closed (max-height, not clip-path) so the fixed <nav> shrinks back to
          just the top bar; clip-path only hid the paint, leaving a tall layout
          box that painted the scrolled glass background over the page. */}
      <div
        className={`overflow-hidden border-t transition-[max-height,opacity] duration-500 ease-[var(--spring-smooth)] lg:hidden ${
          menuOpen
            ? 'max-h-[32rem] border-border opacity-100'
            : 'max-h-0 border-transparent opacity-0'
        }`}
      >
        <div className="pb-3">
          <ul className="flex flex-col">
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
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-3 border-b border-border px-(--gutter) py-3.5 text-body transition-colors duration-150 ${
                      isActive
                        ? 'font-medium text-accent-ink shadow-[inset_2px_0_0_var(--color-accent)]'
                        : 'text-text hover:bg-surface1 hover:text-accent-ink'
                    }`}
                  >
                    <Icon size={18} className="text-subtext1" />
                    <span>{label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>

          {/* Mobile auth section */}
          <div className="px-(--gutter) pt-3">
            <UserMenu />
          </div>
        </div>
      </div>

      <CameraSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </nav>
  )
}
