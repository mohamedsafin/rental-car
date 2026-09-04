/**
 * pages/HomePage.tsx
 * ---------------------------------------------------------------------------
 * The customer landing page (BRD 5).
 *
 * Structured around the one thing a visitor came to do: pick dates and see
 * what is free. So the search widget sits INSIDE the hero rather than below
 * it - a hero that only contains a slogan is a screenful the customer has to
 * scroll past before the site becomes useful.
 *
 * Everything on this page is real data from the API. The trust strip states
 * only facts the system can actually back up - live availability, a
 * server-side price breakdown, deposits held as a ledger - because a landing
 * page promising things the software does not do is how support tickets start.
 */
import { Link } from 'react-router-dom';
import { useCategories, useVehicles } from '../features/fleet/useFleet';
import VehicleCard from '../components/VehicleCard';
import VehicleArtwork from '../components/VehicleArtwork';
import SearchWidget from '../components/SearchWidget';
import { CalendarIcon, ShieldIcon, TagIcon } from '../components/icons';

const TRUST_POINTS = [
  {
    icon: CalendarIcon,
    title: 'Real availability',
    body: 'Dated search only returns cars actually free for your window - not a list you find out about at the counter.',
  },
  {
    icon: TagIcon,
    title: 'Priced before you commit',
    body: 'Every quote is broken down line by line - rate, extras, VAT and deposit - and calculated on the server, not in your browser.',
  },
  {
    icon: ShieldIcon,
    title: 'Deposits you can audit',
    body: 'Your security deposit is a ledger you can read: what was held, what was taken and why, and what came back.',
  },
];

export default function HomePage() {
  const { data: categoryData } = useCategories();
  const { data: featured, isPending } = useVehicles({ limit: 6, sort: 'newest' });

  return (
    <div className="space-y-16">
      {/* --- Hero + search ---------------------------------------------- */}
      <section className="relative overflow-hidden rounded-card bg-ink-900 px-6 py-12 sm:px-10 sm:py-16">
        {/* Decorative only: a soft light bloom so the panel is not a flat block. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-accent-500/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-ink-500/30 blur-3xl"
        />

        <div className="relative max-w-2xl">
          <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-accent-300">
            Across Dubai, Abu Dhabi and Sharjah
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl">
            Rent a car in the UAE, <span className="text-accent-400">priced up front.</span>
          </h1>
          <p className="mt-4 max-w-xl text-base text-ink-200 sm:text-lg">
            Pick your dates and we show only the cars genuinely free for them - with the full cost,
            including deposit, before you book.
          </p>
        </div>

        <div className="relative mt-8 rounded-xl bg-white p-4 shadow-card-hover sm:p-5">
          <SearchWidget />
        </div>

        <p className="relative mt-4 text-sm text-ink-300">
          Not sure of your dates yet?{' '}
          <Link to="/cars" className="font-medium text-white underline underline-offset-4">
            Browse the whole fleet
          </Link>
        </p>
      </section>

      {/* --- Categories --------------------------------------------------- */}
      {categoryData && categoryData.categories.length > 0 && (
        <section>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-ink-900">Browse by category</h2>
              <p className="mt-1 text-sm text-ink-500">
                From an economy runabout to something for the weekend.
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {categoryData.categories.map((category) => (
              <Link
                key={category.id}
                to={`/cars?category=${category.slug}`}
                className="group overflow-hidden rounded-xl border border-ink-100 bg-white shadow-card transition hover:-translate-y-0.5 hover:border-ink-200 hover:shadow-card-hover"
              >
                <VehicleArtwork
                  categorySlug={category.slug}
                  doors={category.slug === 'sports' ? 2 : 4}
                  seats={category.slug === 'suv' ? 7 : 5}
                  className="h-24 w-full"
                />
                <div className="flex items-center justify-between px-3.5 py-3">
                  <span className="text-sm font-semibold text-ink-900">{category.name}</span>
                  <span className="text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-ink-500">
                    &rarr;
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* --- Featured ----------------------------------------------------- */}
      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-ink-900">Popular right now</h2>
            <p className="mt-1 text-sm text-ink-500">A cross-section of the fleet.</p>
          </div>
          <Link
            to="/cars"
            className="shrink-0 rounded-lg border border-ink-200 px-3.5 py-2 text-sm font-medium text-ink-700 transition hover:border-ink-300 hover:bg-white"
          >
            View all
          </Link>
        </div>

        {isPending ? (
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-80 animate-pulse rounded-card border border-ink-100 bg-white"
              >
                <div className="aspect-16/10 rounded-t-card bg-ink-100" />
                <div className="space-y-3 p-4">
                  <div className="h-4 w-2/3 rounded bg-ink-100" />
                  <div className="h-3 w-1/3 rounded bg-ink-100" />
                  <div className="h-8 w-1/2 rounded bg-ink-100" />
                </div>
              </div>
            ))}
          </div>
        ) : featured && featured.items.length > 0 ? (
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.items.map((vehicle) => (
              <VehicleCard key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-card border border-dashed border-ink-200 bg-white p-10 text-center">
            <p className="font-medium text-ink-800">No vehicles published yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">
              Add vehicles from the admin dashboard and they appear here. For a populated demo fleet,
              run <code className="rounded bg-ink-50 px-1.5 py-0.5 text-xs">npm run seed:demo</code>{' '}
              in the backend.
            </p>
          </div>
        )}
      </section>

      {/* --- Trust strip --------------------------------------------------- */}
      <section className="grid gap-5 sm:grid-cols-3">
        {TRUST_POINTS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-xl border border-ink-100 bg-white p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink-900 text-accent-400">
              <Icon className="h-5 w-5" />
            </span>
            <h3 className="mt-3.5 text-sm font-semibold text-ink-900">{title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
