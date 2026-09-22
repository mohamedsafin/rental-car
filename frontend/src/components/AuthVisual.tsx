/**
 * components/AuthVisual.tsx
 * ---------------------------------------------------------------------------
 * The photographic half of the sign-in and registration pages (desktop only).
 *
 * A form on its own reads as a hurdle; the same form beside a photograph and
 * three plain promises reads as the door into the product. The promises are
 * things the system genuinely does - no ratings, no customer counts.
 */
import { Check } from 'lucide-react';
import { CATEGORY_IMAGES } from '../utils/editorialImages';

const PROMISES = [
  'Only cars genuinely free for your dates',
  'The full price, deposit included, before you book',
  'Pickup across Dubai, Abu Dhabi and Sharjah',
];

export default function AuthVisual() {
  const image = CATEGORY_IMAGES.luxury;

  return (
    <div className="relative hidden min-h-[40rem] overflow-hidden rounded-[24px] bg-ink-900 lg:block">
      <img src={image.src} alt={image.alt} className="absolute inset-0 h-full w-full object-cover" />
      {/* Deep enough at the bottom that the white type never sits on bright foliage. */}
      <div aria-hidden className="absolute inset-0 bg-linear-to-t from-black/90 via-black/45 to-black/10" />

      <div className="absolute inset-x-0 bottom-0 p-10">
        <p className="max-w-sm text-[2rem] font-semibold leading-tight tracking-tight text-white">
          Drive something <span className="font-editorial">worth remembering.</span>
        </p>
        <ul className="mt-6 space-y-2.5">
          {PROMISES.map((promise) => (
            <li key={promise} className="flex items-center gap-2.5 text-sm text-white/85">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15">
                <Check aria-hidden className="h-3 w-3" strokeWidth={2.5} />
              </span>
              {promise}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
