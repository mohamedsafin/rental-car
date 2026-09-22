/**
 * utils/editorialImages.ts
 * ---------------------------------------------------------------------------
 * The site's EDITORIAL photography: the hero, the category cards, the closing
 * section and the sign-in panels. Files live in /public/images/editorial, with
 * photographer credits in CREDITS.md beside them.
 *
 * The distinction matters. These are representative pictures of a KIND of
 * car - "SUV", "Luxury" - and are never presented as a particular vehicle in
 * the fleet. Anything that names a specific car (a vehicle card, a detail
 * page, the hero's "Featured vehicle" card) shows that car's own uploaded
 * photo, so the car a customer books is the car they saw.
 *
 * A category the client adds later simply has no entry here; the category card
 * falls back to the generated illustration rather than borrowing a photo of
 * something else.
 */
export interface EditorialImage {
  src: string;
  alt: string;
}

const BASE = '/images/editorial';

export const HERO_IMAGE: EditorialImage = {
  src: `${BASE}/hero.webp`,
  alt: 'A white sports coupé in a bright, softly lit studio',
};

export const CLOSING_IMAGE: EditorialImage = {
  src: `${BASE}/cta.webp`,
  alt: 'The rear wheel and flank of a white sports car against a white wall',
};

export const CATEGORY_IMAGES: Record<string, EditorialImage> = {
  economy: { src: `${BASE}/economy.webp`, alt: 'A white compact city car in an open car park' },
  sedan: { src: `${BASE}/sedan.webp`, alt: 'A black saloon driving along a city street' },
  suv: { src: `${BASE}/suv.webp`, alt: 'A white SUV on a desert highway outside Dubai' },
  luxury: { src: `${BASE}/luxury.webp`, alt: 'A black Rolls-Royce parked beneath tall palm trees' },
  sports: { src: `${BASE}/sports.webp`, alt: 'A silver Porsche 911 on a city street' },
  electric: { src: `${BASE}/electric.webp`, alt: 'Close-up of the badge on the nose of a white electric car' },
  premium: { src: `${BASE}/premium.webp`, alt: 'A silver Mercedes-Benz in a showroom' },
};
