# Security review

Phase 11. What was checked, what was found, what was fixed, and what was
deliberately accepted.

The point of writing this down is that a review nobody recorded is a review
nobody can repeat. Every "we checked X" below should be re-checkable by the
next person, which is why most of them are now tests rather than paragraphs.

---

## What is enforced by a test, not by a promise

`tests/security.test.ts` walks the **live router** and asserts these. They fail
the build if they stop being true — which is the only kind of guarantee worth
having, because "we reviewed it in September" protects nothing in March.

| Guarantee | How it is proven |
| --- | --- |
| Every mutating endpoint requires authentication | Route inventory vs an explicit allowlist |
| Every back-office prefix demands a role | Inventory: `/reports`, `/notifications`, `/coupons`, `/damages`, `/fleet`, `/admin/*` |
| No `authorize()` ever admits a CUSTOMER | Inventory |
| A customer token gets 403 on staff endpoints | Live requests |
| A staff token gets 403 on admin endpoints | Live request |
| A forged JWT is refused | Live request |
| Registration cannot self-promote to ADMIN | Posts `role: 'ADMIN'`, asserts CUSTOMER |
| A client-supplied total is ignored | Posts `totalAmount`, asserts it is not honoured |
| Login reveals nothing about which accounts exist | Same message and status for both cases |
| No stack trace ever reaches a client | Asserts absence in the body |
| Brute-force logins are rate limited | 14 attempts, asserts 429 |
| Health checks survive rate limiting | Asserts 200 while limited |

The inventory is the load-bearing piece. It reads the routers rather than a
hand-kept list, so a route added next year without a guard fails the test
without anyone remembering to update it.

### The allowlist

Six endpoints are public on purpose. Adding to this list is a visible security
decision, which is the intent:

| Endpoint | Why |
| --- | --- |
| `POST /auth/register` | Creating an account cannot require an account |
| `POST /auth/login` | Same |
| `POST /auth/refresh` | Authenticated by the httpOnly refresh cookie |
| `POST /auth/logout` | Must work with an expired access token, or sessions cannot be ended |
| `POST /payments/webhook` | Authenticated by HMAC over the raw body, not by a user |
| `POST /pricing/quote` | BRD 14: the customer reviews the price before signing in |

---

## Found and fixed

### 1. Vehicle photos were unloadable cross-origin

Helmet sets `Cross-Origin-Resource-Policy: same-origin` globally. That is right
for a JSON API and **wrong** for `/uploads`: the customer site runs on a
different origin, so a browser would have refused to render every vehicle photo
the API served.

It was invisible because no vehicle had a photo yet — the demo fleet falls back
to a drawn silhouette. The first real upload would have broken it.

Relaxed to `cross-origin` **for that mount only**. Private documents are never
served from that directory; they go through an authorised streaming route.

### 2. `trust proxy` was hardcoded on

`app.set('trust proxy', 1)` was unconditional. With no proxy actually in front,
any client can send `X-Forwarded-For: <anything>` and get a fresh rate-limit
quota on every request — the limiter buckets by the address it is told to
trust.

Now `TRUST_PROXY_HOPS`, defaulting to **0**. Set it to the real hop count in
production; a wrong value silently disables rate limiting rather than failing
loudly, which is why it is documented at the variable.

### 3. Oversized and malformed bodies returned 500

`body-parser` failures fell through to the generic handler, so a 2MB body or
malformed JSON produced `500 Something went wrong`. That reads as our fault,
fills error monitoring with noise nobody can act on, and tells the caller
nothing about what to fix.

Now mapped by body-parser's own `type` field — 413 too large, 400 not JSON,
415 bad encoding — rather than by matching message text, which changes between
versions.

### 4. The rate limiters were never tested

They were skipped with a hardcoded `isTest`, so the one control standing
between the login endpoint and a credential-stuffing script had never been
observed working. "It is configured, so presumably it works" is a hope.

Limiting is now a runtime switch that the main suite leaves off (it makes
dozens of deliberate login attempts from one address) and `security.test.ts`
turns on to prove the limiter fires, returns `RATE_LIMITED`, and still lets
health checks through.

### 5. Orphaned files were never reclaimed

Deferred from Phase 5. Uploads are cleaned up when the row that would reference
them fails to save, but files were still stranded by cascade deletes, a process
killed mid-upload, or a delete that failed and was only logged.

For a vehicle photo that is wasted disk. For a passport scan it is a
data-retention problem: a customer who asks to be forgotten is not forgotten
while their document sits in `private/`.

`npm run storage:sweep --workspace backend` reports them; `-- --delete` removes
them. Two safety rules, because deleting files is not reversible:

- a **grace period** (default 24h) so a sweep cannot race an upload whose row
  is still committing;
- **reporting is the default** — the first thing anyone runs cannot do damage.

It is a command, not an endpoint. A bulk-delete route is one compromised admin
session away from wiping every identity document on file.

---

## Checked and already correct

Recorded because "we looked" is worth knowing, and because the next reviewer
should not have to rediscover it.

- **Password storage** — bcrypt, cost 12. No password, hash, or reset token is
  ever returned by any endpoint.
- **Account enumeration** — login answers identically for an unknown email and
  a wrong password, including a dummy bcrypt comparison so the timing matches.
- **Token theft** — refresh tokens are stored as SHA-256 hashes, rotated on
  every use, and reuse revokes the whole family.
- **Ownership leaks** — bookings, documents and invoices return **404, not
  403**, to a non-owner. A 403 confirms the record exists.
- **Mass assignment** — `validate` replaces `req.body` with the parsed output,
  so unknown keys never reach a handler.
- **Card data** — none. The payment provider interface has no card fields at
  all, so there is nothing to leak.
- **Webhook forgery** — HMAC over raw bytes with `timingSafeEqual`, plus
  idempotency and an amount check against our own record.
- **File uploads** — type verified by reading the leading bytes, not the
  declared MIME type, which the client controls. Filenames are generated;
  a browser-supplied `../../../.env` never reaches the filesystem.
- **Path traversal** — every resolved storage path is checked to be inside the
  storage root.
- **SQL injection** — Prisma parameterises everything. The one raw query is
  `SELECT 1` in the health check.
- **Secrets** — all from `.env`, validated by Zod at boot; the process exits
  rather than starting half-configured. `.dockerignore` excludes `.env` so it
  cannot be baked into an image layer.
- **Error detail** — stack traces are logged, never sent. In production a 500
  returns a generic line plus a request id.

---

## Accepted, with reasons

### `deepmerge-ts` — 3 high-severity findings

`npm audit` reports [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx):
stack exhaustion when merging recursive object graphs.

**Not fixed, deliberately.** The reasoning:

- The chain is `prisma` → `@prisma/config` → `deepmerge-ts@7.1.5`.
- `@prisma/config` is loaded by the **Prisma CLI**, to read `prisma.config.ts`.
- `@prisma/client` — the only Prisma package the running server loads — has
  **no dependencies**; `prisma` is a peer. Verified, not assumed.
- The only thing merged is our own config file. It is not attacker-controlled,
  and it is not parsed at runtime.
- The fix requires Prisma 8, which is currently a release candidate. Forcing a
  major upgrade to an RC during a hardening phase is a larger risk than a
  denial-of-service in a code path the server never executes.

An `overrides` entry pinning `deepmerge-ts@^8` was tried and does not take
effect in this tree, so it was removed rather than left in place looking like a
fix.

**Revisit when Prisma 8 is stable.** `npm run audit:prod` is the check.

### Rate limits are per-instance

`express-rate-limit` counts in memory. Behind more than one API instance, each
holds its own counters, so the effective limit multiplies by the instance
count. Fine for a single instance; needs a shared store before scaling out.

### Local storage does not survive scaling

`STORAGE_DRIVER=local` writes to one container's volume. A second API instance
would serve 404s for half the images. The storage abstraction exists precisely
so this is a config change — switch to S3 **before** scaling out, not after.

---

## Re-running this review

```bash
npm test --workspace backend                 # includes tests/security.test.ts
npm run test:coverage --workspace backend    # thresholds fail the build
npm run audit:prod                           # production dependency tree only
npm run storage:sweep --workspace backend    # orphaned file report
npm run openapi:check --workspace backend    # spec has not drifted from the router
```
