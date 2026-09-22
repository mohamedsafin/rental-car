/**
 * pages/HomePage.tsx
 * ---------------------------------------------------------------------------
 * The customer landing page (BRD 5).
 *
 * The page answers, in order, the six questions a visitor arrives with: what
 * the company does (hero), how to search (the booking bar, immediately under
 * it), why trust it (four plain promises), what cars there are (categories,
 * then real vehicles with real prices), how booking works, and where to
 * collect. Then one closing call to action.
 *
 * EVERY FACT ON THIS PAGE COMES FROM THE API.
 *
 * No "10,000 happy customers", no star ratings, no testimonials, no "most
 * requested" - the system cannot back any of them, and a landing page that
 * promises what the software does not do is how support tickets start. The
 * counts are the real fleet, categories and pickup points; each category card
 * carries its real number of cars; the hero's featured car is a real car at
 * its real rate. A stat that has not loaded is omitted rather than shown as a
 * zero, because "0 cars" flashing on first paint reads as an empty business.
 *
 * DESIGN
 *
 * Bright and editorial rather than a dark hero over a stack of boxes. Sections
 * are separated by typography, hairlines and whitespace; cards appear only
 * where something is genuinely a clickable object (a category, a car). Two
 * sections sit on a pale grey band to give the long page a rhythm.
 *
 * Imagery: category cards and the hero backdrop use EDITORIAL photography
 * (utils/editorialImages.ts) - representative of a category, never presented
 * as a specific fleet vehicle. Anything that names a car uses that car's own
 * photo.
 */
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CarFront,
  Hotel,
  MapPin,
  Plane,
  Receipt,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { useCategories, useLocations, useVehicles } from '../features/fleet/useFleet';
import VehicleCard, { VehicleCardSkeleton } from '../components/VehicleCard';
import VehicleArtwork from '../components/VehicleArtwork';
import SearchWidget from '../components/SearchWidget';
import SectionHeading from '../components/SectionHeading';
import Reveal from '../components/motion/Reveal';
import CountUp from '../components/motion/CountUp';
import { displayMoney } from '../utils/displayMoney';
import { CATEGORY_IMAGES, CLOSING_IMAGE, HERO_IMAGE } from '../utils/editorialImages';
import type { Location, VehicleCategory } from '../types/vehicle';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Staggered entrance for the hero's text, on page load. */
const rise = (delay: number) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, delay, ease: EASE },
});

/** Value propositions. Each one is something the system genuinely does. */
const VALUE_POINTS = [
  {
    icon: Receipt,
    title: 'Transparent pricing',
    body: 'Every quote is broken down line by line - rate, extras, VAT and deposit - before you commit.',
  },
  {
    icon: BadgeCheck,
    title: 'Verified vehicles',
    body: 'Professionally maintained, and photographed with you at the start and end of every rental.',
  },
  {
    icon: MapPin,
    title: 'Flexible pickup',
    body: 'Collect in Dubai, Abu Dhabi or Sharjah - and drop off somewhere else if it suits you better.',
  },
  {
    icon: ShieldCheck,
    title: 'Secure booking',
    body: 'Your deposit is a ledger you can read: what was held, what was taken and why, and what came back.',
  },
];

/**
 * The flow, as the backend enforces it. The licence check sits inside step 3
 * because that is where it happens: after the car is chosen, before any money
 * moves.
 */
const STEPS = [
  {
    title: 'Choose your car',
    body: 'Browse the fleet by category, or search your dates to see only the cars that are genuinely free.',
  },
  {
    title: 'Pick your dates',
    body: 'Set pick-up and return times and see the full price - rate, extras, VAT and refundable deposit - up front.',
  },
  {
    title: 'Pay and collect',
    body: 'Upload your licence once; it is checked before any payment is taken. Pay online or at the counter, then drive.',
  },
];

const LOCATION_LABEL: Record<string, string> = {
  OFFICE: 'Office',
  AIRPORT: 'Airport',
  HOTEL: 'Hotel',
  DELIVERY_AREA: 'Delivery area',
};

const LOCATION_ICON: Record<string, typeof MapPin> = {
  OFFICE: Building2,
  AIRPORT: Plane,
  HOTEL: Hotel,
  DELIVERY_AREA: Truck,
};

export default function HomePage() {
  const { data: categoryData } = useCategories();
  const { data: locationData } = useLocations();
  const { data: featured, isPending, isError, refetch } = useVehicles({ limit: 6, sort: 'newest' });
  const reduceMotion = useReducedMotion();

  const pickupPoints = (locationData?.locations ?? []).filter((l) => l.isPickupPoint);

  const stats = [
    { value: featured?.pagination.total, label: 'cars in the fleet' },
    { value: categoryData?.categories.length, label: 'categories' },
    { value: pickupPoints.length || undefined, label: 'pickup points' },
  ].filter((stat): stat is { value: number; label: string } => typeof stat.value === 'number');

  /* A real car at its real rate, with its own photo. Featured first. */
  const heroVehicle =
    featured?.items.find((vehicle) => vehicle.isFeatured && vehicle.primaryImageUrl) ??
    featured?.items.find((vehicle) => vehicle.primaryImageUrl);

  /* Pickup points grouped by emirate, busiest emirate first: the customer is
     choosing a city before a branch. */
  const byEmirate = Object.entries(
    pickupPoints.reduce<Record<string, Location[]>>((groups, location) => {
      const key = location.emirate ?? 'Other locations';
      (groups[key] ??= []).push(location);
      return groups;
    }, {}),
  ).sort((a, b) => b[1].length - a[1].length);

  /* The hero car drifts down slightly slower than the page scrolls. */
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroImageY = useTransform(scrollYProgress, [0, 1], [0, 70]);

  return (
    <>
      {/* --- Hero ------------------------------------------------------- */}
      <section ref={heroRef} aria-labelledby="hero-title" className="relative overflow-hidden">
        <HeroBackdrop />

        <div className="page-container relative grid items-center gap-8 pb-12 pt-10 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)] lg:gap-4 lg:pb-16 lg:pt-20">
          <div className="relative z-10 max-w-xl">
            <motion.p {...rise(0)} className="section-eyebrow">
              Premium car rentals in the UAE
            </motion.p>

            <motion.h1
              {...rise(0.08)}
              id="hero-title"
              className="display-heading mt-6 text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.95]"
            >
              Drive something <br className="hidden sm:block" />
              <span className="font-editorial pr-2 text-[1.06em] text-accent-500">worth remembering.</span>
            </motion.h1>

            <motion.p
              {...rise(0.16)}
              className="mt-7 max-w-md text-[17px] leading-relaxed text-ink-500 sm:text-lg"
            >
              Premium vehicles, transparent pricing and flexible pickup across Dubai, Abu Dhabi and
              Sharjah.
            </motion.p>

            <motion.div {...rise(0.24)} className="mt-9 flex flex-col gap-3 min-[420px]:flex-row">
              <Link to="/cars" className="btn btn-accent btn-lg">
                Browse Cars
                <ArrowRight aria-hidden className="btn-arrow h-4 w-4" />
              </Link>
              <Link to="/#how-it-works" className="btn btn-outline btn-lg">
                How It Works
              </Link>
            </motion.div>

            {stats.length > 0 && (
              <motion.dl
                {...rise(0.32)}
                className="mt-12 flex flex-wrap gap-x-10 gap-y-4 border-t border-ink-100 pt-6"
              >
                {stats.map((stat) => (
                  <div key={stat.label} className="flex flex-col-reverse">
                    <dt className="mt-1.5 text-[13px] text-ink-500">{stat.label}</dt>
                    <dd className="text-[1.75rem] font-semibold leading-none tracking-tight text-ink-950">
                      <CountUp value={stat.value} className="tabular" />
                    </dd>
                  </div>
                ))}
              </motion.dl>
            )}
          </div>

          {/* The showcase. No card around it: the studio photo is masked into
              the page and runs slightly past the column on wide screens. */}
          <div className="relative">
            <motion.div
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 1, delay: 0.15, ease: EASE }}
              style={{ y: reduceMotion ? 0 : heroImageY }}
              className="relative lg:-mr-16 xl:-mr-28"
            >
              <img
                src={HERO_IMAGE.src}
                alt={HERO_IMAGE.alt}
                width={2000}
                height={1125}
                fetchPriority="high"
                className="w-full mix-blend-multiply [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,black_62%,transparent_100%)]"
              />
            </motion.div>

            {heroVehicle && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.7, ease: EASE }}
                className="absolute -bottom-2 left-0 sm:left-4 lg:bottom-4 lg:left-2"
              >
                <Link
                  to={`/cars/${heroVehicle.id}`}
                  className="animate-float group flex items-center gap-3 rounded-2xl border border-ink-100 bg-white/95 p-2.5 pr-4 shadow-float backdrop-blur-md"
                >
                  <span className="image-stage block h-14 w-20 shrink-0 overflow-hidden rounded-xl">
                    <img
                      src={heroVehicle.primaryImageUrl as string}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                      Featured vehicle
                    </span>
                    <span className="mt-0.5 block max-w-[11rem] truncate text-sm font-semibold text-ink-950">
                      {heroVehicle.name}
                    </span>
                    <span className="tabular mt-0.5 block text-sm font-semibold text-accent-700">
                      {heroVehicle.pricing.currency} {displayMoney(heroVehicle.pricing.daily)}
                      <span className="font-medium text-ink-500"> / day</span>
                    </span>
                  </span>
                  <ArrowUpRight aria-hidden className="link-arrow-icon h-4 w-4 shrink-0 text-ink-400" />
                </Link>
              </motion.div>
            )}
          </div>
        </div>
      </section>

      {/* --- Booking bar ------------------------------------------------- */}
      <section id="book" aria-labelledby="book-title" className="page-container relative z-10">
        <h2 id="book-title" className="sr-only">
          Search available cars
        </h2>
        <Reveal y={16}>
          <SearchWidget />
        </Reveal>
        <p className="mt-4 flex items-start justify-center gap-2 text-center text-[13px] text-ink-500 sm:items-center">
          <BadgeCheck aria-hidden className="mt-px h-4 w-4 shrink-0 text-accent-600 sm:mt-0" />
          Every result is genuinely free for your dates, with the full price - deposit included -
          before you book.
        </p>
      </section>

      {/* --- Value ------------------------------------------------------- */}
      <section aria-labelledby="why-us" className="page-container pt-24 sm:pt-32">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,2fr)] lg:gap-16">
          <Reveal>
            <p className="section-eyebrow">Why book with us</p>
            <h2 id="why-us" className="display-heading mt-4 text-[2rem] sm:text-[2.75rem]">
              Rental, without the <span className="font-editorial">surprises.</span>
            </h2>
          </Reveal>

          <ol className="grid gap-x-10 sm:grid-cols-2">
            {VALUE_POINTS.map(({ icon: Icon, title, body }, index) => (
              <Reveal as="li" key={title} delay={index * 0.08} className="border-t border-ink-200 py-7">
                <div className="flex items-center justify-between">
                  <span className="tabular text-xs font-semibold tracking-[0.08em] text-ink-500">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <Icon aria-hidden className="h-5 w-5 text-ink-950" strokeWidth={1.5} />
                </div>
                <h3 className="mt-6 text-lg font-semibold tracking-tight text-ink-950">{title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-500">{body}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* --- Fleet categories ------------------------------------------- */}
      {categoryData && categoryData.categories.length > 0 && (
        <section id="fleet" aria-labelledby="fleet-title" className="pt-24 sm:pt-32">
          <div className="page-container">
            <Reveal>
              <SectionHeading
                id="fleet-title"
                eyebrow="The fleet"
                title="Find the right car for the"
                accent="road ahead."
                action={{ to: '/cars', label: 'View all cars' }}
                size="lg"
              />
            </Reveal>

            {/*
              Phones and tablets: a horizontal swipe rail, the next card peeking
              in as the affordance. Desktop: a four-column grid whose first
              card spans two columns, so the section opens with one large
              image rather than a row of equals.
            */}
            <Reveal delay={0.1} className="mt-10 sm:mt-14">
              <ul className="no-scrollbar -mx-(--gutter) flex snap-x snap-mandatory scroll-px-(--gutter) gap-4 overflow-x-auto px-(--gutter) pb-2 lg:mx-0 lg:grid lg:grid-cols-4 lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0">
                {categoryData.categories.map((category, index) => (
                  <li
                    key={category.id}
                    className={`w-[72vw] max-w-[20rem] shrink-0 snap-start sm:w-[42vw] lg:w-auto lg:max-w-none ${
                      index === 0 ? 'lg:col-span-2' : ''
                    }`}
                  >
                    <CategoryCard category={category} feature={index === 0} />
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>
      )}

      {/* --- Vehicles ----------------------------------------------------- */}
      <section aria-labelledby="popular-title" className="mt-24 bg-ink-50 py-24 sm:mt-32 sm:py-32">
        <div className="page-container">
          <Reveal>
            <SectionHeading
              id="popular-title"
              eyebrow="Available now"
              title="Cars worth"
              accent="choosing."
              description="Featured vehicles from across the fleet, with the refundable deposit shown up front."
              action={{ to: '/cars', label: 'View all cars' }}
              size="lg"
            />
          </Reveal>

          <div className="mt-10 sm:mt-14">
            {isPending ? (
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <VehicleCardSkeleton key={index} />
                ))}
                <p className="sr-only" role="status">
                  Loading vehicles
                </p>
              </div>
            ) : isError ? (
              <div className="rounded-card bg-white px-6 py-14 text-center">
                <CarFront aria-hidden className="mx-auto h-8 w-8 text-ink-400" strokeWidth={1.5} />
                <p className="mt-4 text-lg font-semibold text-ink-950">We could not load the fleet</p>
                <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-500">
                  The connection to our booking service dropped. Nothing is wrong with your search.
                </p>
                <button type="button" onClick={() => void refetch()} className="btn btn-primary mt-6">
                  Try again
                </button>
              </div>
            ) : featured && featured.items.length > 0 ? (
              <ul className="no-scrollbar -mx-(--gutter) flex snap-x snap-mandatory scroll-px-(--gutter) gap-4 overflow-x-auto px-(--gutter) pb-2 md:mx-0 md:grid md:grid-cols-2 md:gap-5 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-3">
                {featured.items.map((vehicle) => (
                  <li key={vehicle.id} className="w-[84vw] max-w-[22rem] shrink-0 snap-start md:w-auto md:max-w-none">
                    <VehicleCard vehicle={vehicle} />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-card border border-dashed border-ink-300 bg-white px-6 py-14 text-center">
                <CarFront aria-hidden className="mx-auto h-8 w-8 text-ink-400" strokeWidth={1.5} />
                <p className="mt-4 text-lg font-semibold text-ink-950">No vehicles published yet</p>
                <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-500">
                  Add vehicles from the admin dashboard and they appear here. For a populated demo
                  fleet, run{' '}
                  <code className="rounded bg-ink-100 px-1.5 py-0.5 text-xs">npm run seed:demo</code>{' '}
                  in the backend.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* --- How it works ------------------------------------------------ */}
      <section id="how-it-works" aria-labelledby="how-title" className="page-container pt-24 sm:pt-32">
        <Reveal>
          <SectionHeading
            id="how-title"
            eyebrow="How it works"
            title="Renting should be"
            accent="simple."
            size="lg"
          />
        </Reveal>

        <ol className="mt-12 grid gap-12 sm:mt-16 md:grid-cols-3 md:gap-0 md:divide-x md:divide-ink-200">
          {STEPS.map((step, index) => (
            <Reveal
              as="li"
              key={step.title}
              delay={index * 0.12}
              className="md:px-10 md:first:pl-0 md:last:pr-0"
            >
              <span
                aria-hidden
                className="tabular block text-[4.5rem] font-semibold leading-none tracking-[-0.05em] text-ink-200 sm:text-[5.5rem]"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <span aria-hidden className="mt-6 block h-px w-10 bg-accent-500" />
              <h3 className="mt-6 text-xl font-semibold tracking-tight text-ink-950">
                <span className="sr-only">Step {index + 1}: </span>
                {step.title}
              </h3>
              <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-ink-500">{step.body}</p>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* --- Locations --------------------------------------------------- */}
      {byEmirate.length > 0 && (
        <section id="locations" aria-labelledby="locations-title" className="page-container pt-24 sm:pt-32">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)] lg:gap-20">
            <Reveal className="lg:sticky lg:top-28 lg:self-start">
              <SectionHeading
                id="locations-title"
                eyebrow="Across the Emirates"
                title="Pick up"
                accent="where you need it."
                description="Convenient pickup locations across the UAE. Choose one to search from it - and drop off at another if that suits you better."
                size="lg"
              />
            </Reveal>

            <div className="divide-y divide-ink-200 border-y border-ink-200">
              {byEmirate.map(([emirate, points], index) => (
                <Reveal
                  key={emirate}
                  delay={index * 0.08}
                  className="py-8 sm:grid sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-8"
                >
                  <div>
                    <h3 className="text-2xl font-semibold tracking-tight text-ink-950">{emirate}</h3>
                    <p className="mt-1 text-sm text-ink-500">
                      {points.length} {points.length === 1 ? 'location' : 'locations'}
                    </p>
                  </div>

                  <ul className="mt-4 sm:mt-0">
                    {points.map((location) => {
                      const TypeIcon = LOCATION_ICON[location.type] ?? MapPin;
                      return (
                        <li key={location.id}>
                          <Link
                            to={`/search?pickupLocationId=${location.id}`}
                            className="group -mx-3 flex items-center gap-4 rounded-xl px-3 py-3.5 transition-colors duration-200 hover:bg-ink-50"
                          >
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-700 transition-colors group-hover:border-ink-950">
                              <TypeIcon aria-hidden className="h-4 w-4" strokeWidth={1.6} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[15px] font-medium text-ink-950">
                                {location.name}
                              </span>
                              <span className="mt-0.5 block text-[13px] text-ink-500">
                                {LOCATION_LABEL[location.type] ?? location.type}
                                {/* Only shown when it costs something - a
                                    charge met at checkout instead of here is
                                    the one that annoys people. */}
                                {location.deliveryCharge !== '0.00' &&
                                  ` · Delivery AED ${displayMoney(location.deliveryCharge)}`}
                              </span>
                            </span>
                            <ArrowRight
                              aria-hidden
                              className="link-arrow-icon h-4 w-4 shrink-0 text-ink-400 group-hover:text-ink-950"
                            />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* --- Closing ----------------------------------------------------- */}
      <section aria-labelledby="closing-title" className="mt-24 overflow-hidden bg-ink-50 sm:mt-32">
        <div className="page-container grid items-center gap-6 pt-20 sm:pt-24 lg:grid-cols-2 lg:gap-8 lg:pt-0">
          <Reveal className="lg:py-28">
            <p className="section-eyebrow">Ready when you are</p>
            <h2
              id="closing-title"
              className="display-heading mt-5 text-[2.5rem] sm:text-[3.25rem] lg:text-[3.75rem]"
            >
              Your next drive <span className="font-editorial">starts here.</span>
            </h2>
            <p className="mt-5 max-w-md text-[17px] leading-relaxed text-ink-500">
              Choose your car, select your dates and get a clear price before you book.
            </p>
            <Link to="/cars" className="btn btn-accent btn-lg mt-9">
              Browse the Fleet
              <ArrowRight aria-hidden className="btn-arrow h-4 w-4" />
            </Link>
          </Reveal>

          {/* A studio shot multiplied onto the grey band. The studio wall is a
              light grey rather than pure white, so multiply alone would leave
              a visible rectangle; the two intersecting masks fade its left,
              top and bottom edges into the band so the car sits directly on
              the section. On desktop it runs to the window's right edge. */}
          <div className="lg:-mr-[max(var(--gutter),calc(50vw-38rem))]">
            <img
              src={CLOSING_IMAGE.src}
              alt={CLOSING_IMAGE.alt}
              loading="lazy"
              decoding="async"
              className="w-full mix-blend-multiply"
              style={{
                maskImage:
                  'linear-gradient(to right, transparent 0%, black 22%), linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)',
                maskComposite: 'intersect',
                WebkitMaskImage:
                  'linear-gradient(to right, transparent 0%, black 22%), linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)',
                WebkitMaskComposite: 'source-in',
              }}
            />
          </div>
        </div>
      </section>
    </>
  );
}

/** A category as a large photographic tile. */
function CategoryCard({ category, feature }: { category: VehicleCategory; feature: boolean }) {
  const image = CATEGORY_IMAGES[category.slug];
  const count = category._count?.vehicles;

  return (
    <Link
      to={`/cars?category=${category.slug}`}
      className="group relative block aspect-[4/5] overflow-hidden rounded-card bg-ink-100 transition-[transform,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:shadow-card-hover lg:aspect-auto lg:h-[26rem]"
    >
      {image ? (
        <img
          src={image.src}
          alt={image.alt}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04]"
        />
      ) : (
        <div className="image-stage absolute inset-0 flex items-center">
          <VehicleArtwork
            categorySlug={category.slug}
            doors={category.slug === 'sports' ? 2 : 4}
            seats={category.slug === 'suv' ? 7 : 5}
            className="w-full transition-transform duration-[900ms] group-hover:scale-[1.04]"
          />
        </div>
      )}

      {/* A floor of shade for the white type, deepening slightly on hover. */}
      <div aria-hidden className="absolute inset-0 bg-linear-to-t from-black/75 via-black/15 to-transparent" />
      <div
        aria-hidden
        className="absolute inset-0 bg-black/0 transition-colors duration-500 group-hover:bg-black/15"
      />

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 sm:p-6">
        <div className="min-w-0">
          <h3
            className={`font-semibold tracking-tight text-white ${
              feature ? 'text-2xl sm:text-[1.75rem]' : 'text-xl'
            }`}
          >
            {category.name}
          </h3>
          {typeof count === 'number' && (
            <p className="mt-1 text-sm text-white/80">
              {count} {count === 1 ? 'vehicle' : 'vehicles'}
            </p>
          )}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-white">
          Explore
          <ArrowRight aria-hidden className="link-arrow-icon h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}

/**
 * The hero's background: a barely-there grid, a warm soft shape and two thin
 * curves. Each is faint enough to be felt rather than seen - the page should
 * read as white, with just enough texture that the white looks chosen.
 */
function HeroBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div
        className="absolute inset-0 opacity-70 [mask-image:radial-gradient(ellipse_70%_65%_at_75%_35%,black,transparent)]"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--color-ink-100) 1px, transparent 1px), linear-gradient(to bottom, var(--color-ink-100) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
      <div className="absolute -right-48 -top-48 h-[42rem] w-[42rem] rounded-full bg-sand-100/80 blur-3xl" />
      <svg
        className="absolute -left-24 top-40 h-[34rem] w-[64rem] text-ink-200"
        viewBox="0 0 1024 544"
        fill="none"
      >
        <path d="M-20 400 C 190 290, 430 500, 650 350 S 960 170, 1044 230" stroke="currentColor" />
        <path d="M-20 450 C 210 340, 450 550, 670 400 S 980 220, 1064 280" stroke="currentColor" opacity="0.6" />
      </svg>
    </div>
  );
}
