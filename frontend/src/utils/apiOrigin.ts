/**
 * utils/apiOrigin.ts
 * ---------------------------------------------------------------------------
 * The API's origin (scheme + host + port), for turning the relative image
 * paths some booking endpoints return ("/uploads/...") into absolute URLs.
 *
 * Derived from VITE_API_BASE_URL rather than hardcoded, so a deployed build
 * loads images from the deployed API instead of from localhost.
 */
export const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(
  /\/api\/v1$/,
  '',
);
