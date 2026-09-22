/**
 * components/BrandMark.tsx
 * ---------------------------------------------------------------------------
 * The logo: a near-black roundel with a front-on car, a single orange dot, and
 * the wordmark beside it. Shared by the header and the footer so the two can
 * never drift apart.
 *
 * Still a placeholder for the client's real logo (BRD 51) - which is exactly
 * why it lives in one component: swapping it is one file, not a hunt.
 */
import { CarFront } from 'lucide-react';

interface BrandMarkProps {
  name: string;
  /** Show the "Rent · Drive · Explore" line under the name. */
  tagline?: boolean;
}

export default function BrandMark({ name, tagline = false }: BrandMarkProps) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-950 text-white">
        <CarFront aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.75} />
        <span aria-hidden className="absolute right-[5px] top-[5px] h-1.5 w-1.5 rounded-full bg-accent-500" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight text-ink-950">{name}</span>
        {tagline && (
          <span className="mt-1 hidden text-[9.5px] font-medium uppercase tracking-[0.24em] text-ink-500 sm:block">
            Rent · Drive · Explore
          </span>
        )}
      </span>
    </span>
  );
}
