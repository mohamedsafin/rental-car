/**
 * utils/slug.ts
 * ---------------------------------------------------------------------------
 * Turns "Luxury SUV" into "luxury-suv" for use in URLs.
 *
 * Generated on the server, never accepted from the client: a slug is part of a
 * URL and a unique key, so letting a client choose it invites collisions and
 * path-traversal-shaped input.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    // Strip accents, so "Café" becomes "cafe" rather than "caf".
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
