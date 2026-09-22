/**
 * utils/contentDisposition.ts
 * ---------------------------------------------------------------------------
 * Builds a Content-Disposition header from a user-supplied file name.
 *
 * HTTP header values are latin1. A customer who uploads `வீடு வாடகைக்கு.pdf` -
 * or any Arabic, Tamil or accented name, which in the UAE is the normal case,
 * not the edge case - produces a name Node cannot put in a header at all:
 * `res.setHeader` throws ERR_INVALID_CHAR and the download 500s.
 *
 * RFC 6266 solves this with two parameters in one header:
 *   - `filename=`  a mangled ASCII fallback, for ancient clients.
 *   - `filename*=` the real name, percent-encoded UTF-8 (RFC 5987), which
 *                  every current browser prefers when both are present.
 */

/**
 * RFC 5987 attr-char excludes some characters `encodeURIComponent` leaves
 * alone, so escape those by hand rather than shipping a header that is
 * *nearly* valid.
 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*!]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function contentDisposition(
  fileName: string,
  disposition: 'inline' | 'attachment' = 'inline',
): string {
  // Printable ASCII only, and no quote or backslash that could end the quoted
  // string early. An entirely non-ASCII name would mangle to nothing, so fall
  // back to something rather than emit `filename=""`.
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '') || 'download';

  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}
