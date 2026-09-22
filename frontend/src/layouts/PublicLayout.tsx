/**
 * layouts/PublicLayout.tsx
 * ---------------------------------------------------------------------------
 * Shared chrome for every public customer page. Pages render into <Outlet />,
 * so navigating does not re-render the header.
 *
 * HEADER
 *
 * White, compact and sticky. Flush with the page at the top; once you scroll
 * it turns translucent with a backdrop blur and a hairline, so the content
 * passing under it stays faintly visible - the header recedes instead of
 * sitting on the page like a toolbar.
 *
 * "Locations" and "How It Works" are sections of the home page, linked as
 * `/#locations` and `/#how-it-works`. React Router does not scroll to a hash on
 * its own, so this layout does it (and scrolls to the top on a normal page
 * change, which the router also leaves to us). The target sections render
 * after their data arrives, so the scroll retries briefly rather than giving
 * up on the first frame.
 *
 * The primary action is "Rent a Car" (phones: "Book"). On the home page it
 * jumps to the booking bar; everywhere else it opens the search page, which
 * carries the same form.
 *
 * Below `lg` the links collapse into a disclosure menu - plain state and a
 * <nav>, closed on route change and on Escape.
 *
 * FOOTER
 *
 * Deliberately has no phone number, address or social links. The company's
 * real contact details are a Settings value the client supplies (BRD 51);
 * inventing a plausible Dubai landline is exactly the kind of fake data that
 * survives into production. Contact and FAQ links are left out for the same
 * reason - there are no such pages yet, and a footer of dead links is worse
 * than a short one.
 */
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { ArrowRight, ArrowUpRight, Menu, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import BrandMark from '../components/BrandMark';

interface NavItem {
  label: string;
  to: string;
  /** Set for links to a section of the home page. */
  hash?: string;
}

const NAV: NavItem[] = [
  { label: 'Browse Cars', to: '/cars' },
  { label: 'Locations', to: '/#locations', hash: '#locations' },
  { label: 'How It Works', to: '/#how-it-works', hash: '#how-it-works' },
  { label: 'My Bookings', to: '/account/bookings' },
];

const FOOTER_COLUMNS: { title: string; links: { label: string; to: string }[] }[] = [
  {
    title: 'Explore',
    links: [
      { label: 'Browse cars', to: '/cars' },
      { label: 'Categories', to: '/#fleet' },
      { label: 'Locations', to: '/#locations' },
      { label: 'How it works', to: '/#how-it-works' },
    ],
  },
  {
    title: 'Support',
    links: [
      { label: 'My bookings', to: '/account/bookings' },
      { label: 'My documents', to: '/account/documents' },
      { label: 'Cancellation policy', to: '/legal/cancellation' },
      { label: 'Refunds', to: '/legal/refunds' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms of rental', to: '/legal/terms' },
      { label: 'Privacy', to: '/legal/privacy' },
      { label: 'Rental agreement', to: '/legal/rental-agreement' },
    ],
  },
];

function isActive(item: NavItem, pathname: string, hash: string): boolean {
  if (item.hash) return pathname === '/' && hash === item.hash;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export default function PublicLayout() {
  const appName = import.meta.env.VITE_APP_NAME ?? 'UAE Car Rental';
  const { user, isAuthenticated, isLoading } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  const bookHref = location.pathname === '/' ? '/#book' : '/search';

  // Navigating with the menu open would leave it hanging over the new page.
  useEffect(() => setMenuOpen(false), [location.pathname, location.hash]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  /*
   * A new page starts at the top. Keyed on the PATHNAME only: changing a
   * filter on /cars rewrites the query string, and jumping the customer back
   * to the top every time they tick a filter would be maddening.
   */
  useEffect(() => {
    if (!location.hash) window.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  /*
   * In-page anchors. Keyed on `location.key` so clicking "Locations" a second
   * time scrolls there again. Retries for up to two seconds because the target
   * section may still be waiting on its data.
   */
  useEffect(() => {
    if (!location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let attempts = 0;
    let timer: number | undefined;

    const tryScroll = () => {
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
        return;
      }
      if (attempts++ < 20) timer = window.setTimeout(tryScroll, 100);
    };

    tryScroll();
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const elevated = scrolled || menuOpen;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-full flex-col bg-white">
        {/* A keyboard user should not have to tab through the header on every page. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink-950 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          Skip to content
        </a>

        <header
          className={`sticky top-0 z-40 border-b transition-[background-color,border-color,box-shadow] duration-300 ${
            elevated
              ? 'border-ink-100 bg-white/80 shadow-[0_10px_30px_-24px_rgb(16_18_22/0.35)] backdrop-blur-xl backdrop-saturate-150'
              : 'border-transparent bg-white'
          }`}
        >
          <div className="page-container flex h-16 items-center justify-between gap-6 sm:h-[72px]">
            <Link to="/" aria-label={`${appName} home`} className="shrink-0 rounded-full">
              <BrandMark name={appName} tagline />
            </Link>

            <nav aria-label="Main" className="hidden items-center gap-9 lg:flex">
              {NAV.map((item) => {
                const active = isActive(item, location.pathname, location.hash);
                return (
                  <Link
                    key={item.label}
                    to={item.to}
                    aria-current={active ? 'page' : undefined}
                    className={`relative py-2 text-sm font-medium transition-colors duration-200 after:absolute after:inset-x-0 after:bottom-0.5 after:h-px after:origin-left after:transition-transform after:duration-300 after:ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      active
                        ? 'text-ink-950 after:scale-x-100 after:bg-accent-500'
                        : 'text-ink-600 after:scale-x-0 after:bg-ink-950 hover:text-ink-950 hover:after:scale-x-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden items-center lg:flex">
                {isLoading ? null : isAuthenticated ? (
                  <Link
                    to="/account"
                    className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-sm font-medium transition-colors ${
                      location.pathname === '/account'
                        ? 'border-ink-950 text-ink-950'
                        : 'border-ink-200 text-ink-700 hover:border-ink-950 hover:text-ink-950'
                    }`}
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-950 text-xs font-semibold text-white">
                      {user?.fullName?.trim().charAt(0).toUpperCase() ?? '?'}
                    </span>
                    <span className="max-w-28 truncate">
                      {user?.fullName?.trim().split(' ')[0] ?? 'Account'}
                    </span>
                  </Link>
                ) : (
                  <Link
                    to="/login"
                    className="rounded-full px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:text-ink-950"
                  >
                    Sign in
                  </Link>
                )}
              </div>

              <Link to={bookHref} className="btn btn-accent btn-sm">
                <span className="lg:hidden">Book</span>
                <span className="hidden lg:inline">Rent a Car</span>
                <ArrowRight aria-hidden className="btn-arrow h-3.5 w-3.5" />
              </Link>

              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-controls="mobile-nav"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-ink-200 text-ink-900 transition-colors hover:border-ink-950 lg:hidden"
              >
                {menuOpen ? <X className="h-[18px] w-[18px]" /> : <Menu className="h-[18px] w-[18px]" />}
              </button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {menuOpen && (
              <motion.nav
                id="mobile-nav"
                aria-label="Main"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden border-t border-ink-100 lg:hidden"
              >
                <div className="page-container pb-8 pt-4">
                  <ul className="divide-y divide-ink-100">
                    {NAV.map((item) => (
                      <li key={item.label}>
                        <Link
                          to={item.to}
                          className="group flex items-center justify-between py-4 text-[1.375rem] font-semibold tracking-tight text-ink-950"
                        >
                          {item.label}
                          <ArrowRight aria-hidden className="link-arrow-icon h-5 w-5 text-ink-400" />
                        </Link>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-6 grid grid-cols-2 gap-2">
                    {isAuthenticated ? (
                      <>
                        <Link to="/account" className="btn btn-outline">
                          Account
                        </Link>
                        <Link to="/account/documents" className="btn btn-outline">
                          My documents
                        </Link>
                      </>
                    ) : (
                      <>
                        <Link to="/login" className="btn btn-outline">
                          Sign in
                        </Link>
                        <Link to="/register" className="btn btn-primary">
                          Create account
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              </motion.nav>
            )}
          </AnimatePresence>
        </header>

        <main id="main" className="flex-1">
          {/* Keyed on the pathname so each page fades in; a query-string change
              (filters, pagination) keeps the page mounted and does not flash. */}
          <div key={location.pathname} className="animate-page">
            <Outlet />
          </div>
        </main>

        <footer className="mt-24 border-t border-ink-100 bg-ink-50">
          <div className="page-container pb-10 pt-16 sm:pt-20">
            <div className="grid gap-12 sm:grid-cols-3 lg:grid-cols-[1.5fr_repeat(3,1fr)]">
              <div className="sm:col-span-3 lg:col-span-1">
                <BrandMark name={appName} tagline />
                <p className="mt-6 max-w-xs text-sm leading-relaxed text-ink-500">
                  Premium vehicles, transparent pricing and flexible pickup across Dubai, Abu
                  Dhabi and Sharjah.
                </p>
                <Link to="/cars" className="link-arrow mt-6">
                  Browse the fleet
                  <ArrowUpRight aria-hidden className="h-4 w-4" />
                </Link>
              </div>

              {FOOTER_COLUMNS.map((column) => (
                <div key={column.title}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                    {column.title}
                  </p>
                  <ul className="mt-5 space-y-3">
                    {column.links.map((link) => (
                      <li key={link.label}>
                        <Link
                          to={link.to}
                          className="text-sm text-ink-700 transition-colors hover:text-ink-950"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="mt-16 flex flex-col gap-3 border-t border-ink-200 pt-6 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between">
              <p>
                &copy; {new Date().getFullYear()} {appName}. All prices in UAE dirhams (AED).
              </p>
              <p>Dubai · Abu Dhabi · Sharjah</p>
            </div>
          </div>

          {/* The wordmark, set huge and nearly invisible - the editorial sign-off. */}
          <div aria-hidden className="pointer-events-none select-none overflow-hidden">
            <p className="page-container -mb-[0.2em] whitespace-nowrap text-[11.5vw] font-bold leading-none tracking-[-0.05em] text-ink-100 lg:text-[9.25rem]">
              {appName}
            </p>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}
