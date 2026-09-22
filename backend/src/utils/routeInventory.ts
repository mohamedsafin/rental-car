/**
 * utils/routeInventory.ts
 * ---------------------------------------------------------------------------
 * Walks the API's routers and reports every route with the guards protecting
 * it.
 *
 * This exists so a security guarantee can be TESTED rather than reviewed.
 * "Every mutating endpoint requires authentication" is easy to be true today
 * and false in three months, when someone adds a route in a hurry and forgets
 * the guard. A code review catches that only if a human is looking; a test
 * that enumerates the live router catches it every time.
 *
 * Two decisions worth stating:
 *
 *  1. It walks the ROUTERS from the mount table, not the Express app. Express 5
 *     compiles a mounted router's path into a closure that cannot be read back,
 *     so recovering "/api/v1/fleet" from the app object is guesswork. The mount
 *     table is data we own, so the paths are exact.
 *
 *  2. Guards are identified by a `guardKind` PROPERTY, not by function name.
 *     Middleware gets wrapped, bound and minified; a guarantee that depends on
 *     a function still being called "authenticate" is one that breaks quietly.
 *
 * Used by tests and the OpenAPI generator. Never on a request path.
 */
import type { Role } from '@prisma/client';

export type GuardKind = 'authenticate' | 'optional' | 'authorize';

export interface RouteInfo {
  method: string;
  /** Full path as mounted, e.g. "/bookings/:id/cancel". */
  path: string;
  /** Guards applying to this route, whether set per-route or by router.use. */
  guards: GuardKind[];
  /** Roles demanded by any `authorize(...)` on the route. */
  allowedRoles: Role[];
  /** True when a real login is required (optionalAuthenticate does not count). */
  requiresAuth: boolean;
}

interface GuardFn {
  guardKind?: GuardKind;
  allowedRoles?: Role[];
}

interface LayerLike {
  handle?: unknown;
  route?: {
    path?: string | string[];
    methods?: Record<string, boolean>;
    stack?: LayerLike[];
  };
}

interface RouterLike {
  stack?: LayerLike[];
}

function guardOf(handle: unknown): GuardFn | null {
  if (typeof handle !== 'function') return null;
  const fn = handle as GuardFn;
  return fn.guardKind ? fn : null;
}

/**
 * Walk one router.
 *
 * `inherited` carries guards registered with `router.use(...)` earlier in the
 * same stack - which is how most modules protect themselves, so ignoring them
 * would report every staff route as wide open.
 */
function walk(
  router: RouterLike,
  prefix: string,
  inherited: GuardFn[],
  routes: RouteInfo[],
): void {
  // Copied, not shared: a `use` inside a nested router must not leak back out
  // to siblings mounted after it.
  const active = [...inherited];

  for (const layer of router.stack ?? []) {
    if (layer.route) {
      const own = (layer.route.stack ?? [])
        .map((entry) => guardOf(entry.handle))
        .filter((guard): guard is GuardFn => guard !== null);

      const all = [...active, ...own];
      const guards = all.map((guard) => guard.guardKind!);
      const allowedRoles = all.flatMap((guard) => guard.allowedRoles ?? []);

      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path ?? ''];

      for (const path of paths) {
        for (const [method, enabled] of Object.entries(layer.route.methods ?? {})) {
          if (!enabled || method === '_all') continue;

          routes.push({
            method: method.toUpperCase(),
            path: `${prefix}${path}` || '/',
            guards,
            allowedRoles: [...new Set(allowedRoles)],
            // optionalAuthenticate deliberately does NOT count: it populates
            // req.user when a token is present and waves anonymous callers
            // through, which is the opposite of a guard.
            requiresAuth: guards.includes('authenticate'),
          });
        }
      }
      continue;
    }

    const guard = guardOf(layer.handle);
    if (guard) {
      // router.use(authenticate) - applies to everything registered after it.
      active.push(guard);
      continue;
    }

    const nested = layer.handle as RouterLike | undefined;
    if (nested?.stack) {
      // A sub-router mounted without a path prefix (Express flattens those),
      // or a `use` of another router. Its own paths are already absolute
      // relative to this prefix.
      walk(nested, prefix, active, routes);
    }
  }
}

/** Every route across the mount table, with the guards protecting each one. */
export function listRoutes(mounts: Record<string, unknown>): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const [prefix, router] of Object.entries(mounts)) {
    walk(router as RouterLike, prefix, [], routes);
  }

  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
