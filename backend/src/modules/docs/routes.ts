/**
 * modules/docs/routes.ts
 * ---------------------------------------------------------------------------
 * Serves the OpenAPI document.
 *
 * Built on request from the live router rather than read from the committed
 * `openapi.json`, so what this returns is always what the server actually
 * does. The committed file exists for clients and CI; this endpoint exists so
 * a developer poking at a running instance cannot be shown a stale spec.
 *
 * No documentation UI is served here. Rendering one would mean either bundling
 * a viewer or loading a script from a CDN - and the whole point of helmet's
 * `script-src 'self'` is that this origin does not execute third-party
 * JavaScript. Point any OpenAPI viewer at the JSON instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { buildOpenApiDocument } from '../../docs/openapi';

/**
 * Read once at boot. Reading package.json per request would be pointless
 * filesystem work, and a missing file must not take the endpoint down - the
 * version is a label, not a dependency.
 */
const VERSION = (() => {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

const router = Router();

/**
 * GET /docs
 *
 * Public. An API description is not a secret - every path in it is already
 * enforced by the guards it documents, and hiding it behind a token only
 * inconveniences the people integrating honestly.
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(buildOpenApiDocument(VERSION));
  }),
);

export const docsRoutes = router;
