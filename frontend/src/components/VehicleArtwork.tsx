/**
 * components/VehicleArtwork.tsx
 * ---------------------------------------------------------------------------
 * What a vehicle card shows when it has no photograph yet.
 *
 * The obvious alternatives were both worse. A grey "No image" box makes a real
 * fleet look broken, and pulling stock photography from the web would put a
 * picture of a car that is NOT the car on the page - which is the sort of thing
 * a customer notices at handover, and is a licensing problem besides.
 *
 * So this draws a body-style silhouette instead: clearly an illustration, never
 * mistakable for a photo of that specific vehicle, and consistent enough that a
 * grid of them looks deliberate. Real photos replace it the moment staff upload
 * any, because the card prefers `primaryImageUrl` whenever it exists.
 *
 * The body style is inferred from doors and category rather than stored, so no
 * schema change is needed to make the fleet look presentable.
 */

import { useId } from 'react';

type BodyStyle = 'coupe' | 'suv' | 'sedan' | 'hatch';

interface VehicleArtworkProps {
  categorySlug: string;
  doors: number;
  seats: number;
  /** Shown faintly behind the silhouette so cards in a grid stay distinguishable. */
  label?: string;
  className?: string;
}

/** Category tints, so a row of cards is not four identical grey rectangles. */
const TINTS: Record<string, { from: string; to: string; body: string }> = {
  economy: { from: '#eef2f7', to: '#dbe4ee', body: '#7c8ea3' },
  sedan: { from: '#e8eef8', to: '#d2ddee', body: '#6d82a0' },
  suv: { from: '#eaf1ec', to: '#d5e3d9', body: '#6f8b7a' },
  luxury: { from: '#f3eee6', to: '#e6dac6', body: '#8a7654' },
  sports: { from: '#f8ecec', to: '#eed4d4', body: '#a06d6d' },
  electric: { from: '#e8f2f5', to: '#cee4ec', body: '#5f8695' },
  premium: { from: '#efecf5', to: '#ded7ea', body: '#7a6f96' },
};

const FALLBACK_TINT = { from: '#eef1f5', to: '#dde3ea', body: '#7b8794' };

function bodyStyleFor(categorySlug: string, doors: number, seats: number): BodyStyle {
  if (doors <= 2 || categorySlug === 'sports') return 'coupe';
  if (categorySlug === 'suv' || seats >= 7) return 'suv';
  if (categorySlug === 'economy') return 'hatch';
  return 'sedan';
}

/**
 * Side profiles on a shared 200x84 baseline, so every card's car sits at the
 * same height and the grid does not visibly jump between styles.
 */
const SILHOUETTES: Record<BodyStyle, { body: string; roof: string; wheels: [number, number] }> = {
  sedan: {
    body: 'M14 62 C14 52 22 48 34 47 L58 34 C64 31 72 30 82 30 L124 30 C134 30 142 32 148 36 L166 47 C178 49 186 53 186 62 L186 66 C186 68 184 70 182 70 L18 70 C16 70 14 68 14 66 Z',
    roof: 'M62 45 L80 34 C84 32 90 31 96 31 L122 31 C130 31 136 33 140 36 L152 45 Z',
    wheels: [56, 146],
  },
  suv: {
    body: 'M12 60 C12 48 20 44 32 43 L48 26 C53 21 60 19 70 19 L132 19 C142 19 149 21 154 26 L170 43 C182 45 188 49 188 60 L188 66 C188 68 186 70 184 70 L16 70 C14 70 12 68 12 66 Z',
    roof: 'M52 41 L66 26 C69 23 74 22 80 22 L124 22 C130 22 135 23 138 26 L150 41 Z',
    wheels: [54, 148],
  },
  coupe: {
    body: 'M10 64 C10 55 18 50 30 48 L62 34 C70 30 80 28 92 28 L120 28 C132 28 142 31 150 36 L172 49 C184 51 190 55 190 64 L190 67 C190 69 188 71 186 71 L14 71 C12 71 10 69 10 67 Z',
    roof: 'M66 46 L86 34 C91 31 97 30 104 30 L118 30 C126 30 132 32 136 36 L148 46 Z',
    wheels: [54, 150],
  },
  hatch: {
    body: 'M18 62 C18 52 26 48 38 47 L58 33 C64 30 71 29 80 29 L120 29 C129 29 135 31 139 35 L156 52 C168 53 174 56 174 63 L174 66 C174 68 172 70 170 70 L22 70 C20 70 18 68 18 66 Z',
    roof: 'M62 45 L78 34 C82 32 87 31 92 31 L118 31 C124 31 128 32 131 35 L145 47 Z',
    wheels: [58, 142],
  },
};

export default function VehicleArtwork({
  categorySlug,
  doors,
  seats,
  label,
  className = '',
}: VehicleArtworkProps) {
  const tint = TINTS[categorySlug] ?? FALLBACK_TINT;
  const style = bodyStyleFor(categorySlug, doors, seats);
  const shape = SILHOUETTES[style];
  /*
   * The gradient id must be unique PER INSTANCE. It used to be derived from
   * the category and body style, which meant every SUV card in a twelve-card
   * grid emitted id="art-suv-suv" - a dozen duplicate DOM ids, which is
   * invalid HTML and leaves `url(#...)` resolving to whichever element the
   * browser happened to index first. It looked fine only because same-category
   * tints are identical; a per-vehicle tint would have exposed it immediately.
   *
   * useId gives React's own collision-free value, stable across re-renders and
   * consistent between server and client.
   */
  const reactId = useId();
  const gradientId = `art${reactId.replace(/:/g, '')}`;

  return (
    <svg
      viewBox="0 0 200 84"
      className={className}
      role="img"
      aria-label={label ? `Illustration of a ${label}` : 'Vehicle illustration'}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tint.from} />
          <stop offset="100%" stopColor={tint.to} />
        </linearGradient>
      </defs>

      <rect width="200" height="84" fill={`url(#${gradientId})`} />

      {label && (
        <text
          x="100"
          y="30"
          textAnchor="middle"
          fontSize="9"
          fontWeight="600"
          letterSpacing="2.5"
          fill={tint.body}
          opacity="0.28"
          style={{ textTransform: 'uppercase' }}
        >
          {label}
        </text>
      )}

      <g fill={tint.body}>
        <path d={shape.body} opacity="0.9" />
        <path d={shape.roof} fill="#ffffff" opacity="0.42" />
        {shape.wheels.map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="70" r="11" fill="#2b3440" opacity="0.88" />
            <circle cx={cx} cy="70" r="4.5" fill={tint.from} />
          </g>
        ))}
      </g>

      {/* A soft ground shadow, so the car is standing on something. */}
      <ellipse cx="100" cy="80" rx="78" ry="3.5" fill="#2b3440" opacity="0.1" />
    </svg>
  );
}
