# Database design

PostgreSQL, accessed only through Prisma. `backend/prisma/schema.prisma` is the
single source of truth; the SQL in `prisma/migrations/` is generated from it.

## Conventions

- **UUID primary keys** on every table. They are unguessable (a booking id in a
  URL leaks nothing about volume) and safe to generate before insert.
- **snake_case table names** via `@@map`, PascalCase models in Prisma.
- **`createdAt` / `updatedAt`** on every table.
- **Money as `Decimal(10, 2)`**, never `Float`. Floating point cannot represent
  AED 0.10 exactly, and rounding drift in a deposit settlement is a real dispute.
- **Enums in the database**, not free-text status columns.
- **Soft delete** (`deletedAt`) on records with financial or legal history —
  vehicles, customers, bookings. A completed rental must never disappear.
- **Restrictive foreign keys** on financial records: you cannot delete a vehicle
  that has bookings.

## Entities by phase

Tables are added in the phase that uses them, so no table sits empty and
untested.

### Phase 1 (done)
| Table | Purpose |
| --- | --- |
| `system_settings` | Every admin-configurable value from the BRD (VAT %, deposit rules, cancellation window, minimum age, required documents, reminder periods). |

### Phase 2 — identity (done)
| Table | Purpose |
| --- | --- |
| `users` | Login identity for all three roles. bcrypt hash only, never a password. Carries `failedLoginAttempts` / `lockedUntil` for brute-force lockout, and a `deletedAt` soft delete. |
| `refresh_tokens` | SHA-256 hashes of issued refresh tokens. Storing hashes (not tokens) means a leak of this table yields nothing replayable; storing them at all is what makes revocation possible, which a stateless JWT cannot do. |
| `audit_logs` | Who changed what, when, from where. |

Roles are an enum (`CUSTOMER`, `ADMIN`, `STAFF`) rather than a table — three
fixed roles do not need a join.

### Phase 3 — fleet (done)
| Table | Purpose |
| --- | --- |
| `vehicle_categories` | Economy, Sedan, SUV, ... (client-provided). |
| `vehicles` | The fleet. Unique `registrationNumber`. |
| `vehicle_images` | Typed shots per vehicle. Stores an opaque `storageKey`, never a URL — the URL is built at read time so the storage provider can change without rewriting rows. |
| `vehicle_features` + `vehicle_features_on_vehicles` | Bluetooth, GPS, CarPlay... A lookup table with an explicit join, so "filter by feature" is an index lookup rather than a text match, and the join can gain columns later. |
| `locations` | Offices, airports, delivery areas, working hours, delivery charge. |

### Phase 4 — money and availability (done)
| Table | Purpose |
| --- | --- |
| `pricing_rules` | Daily/weekly/monthly/weekend/seasonal rates and long-term discounts. |
| `additional_services` | Child seat, GPS, additional driver, delivery. |

Also added in Phase 4: `bookings` (core columns only — the full lifecycle is
Phase 6), because an availability engine with nothing to collide against cannot
be tested.

Availability still has **no table of its own** — it is derived from `bookings`,
`maintenance_records` and `vehicles.status`. A separate availability table would
be a second source of truth that drifts, which is exactly how double bookings
happen.

`bookings.pickupAt` / `returnAt` are `@db.Timestamptz(3)`, not Prisma's default
`timestamp without time zone`. A rental that starts at "10:00" must mean the
same instant everywhere, and `tstzrange()` is only IMMUTABLE — and therefore
indexable — over timezone-aware columns.

### Phase 5 — customers and documents (done)
| Table | Purpose |
| --- | --- |
| `customers` | Customer profile, 1:1 with a `users` row. |
| `customer_documents` | Emirates ID, licence, passport, visa, IDP. Status, rejection reason, expiry, reviewer. Stores a PRIVATE storage key, never a URL — there is no public path to the file. Superseded rows are kept: a rejected document and its replacement are the verification record. |

### Phase 6 — bookings
| Table | Purpose |
| --- | --- |
| `bookings` | The core record: vehicle, customer, dates, locations, status, price snapshot. |
| `booking_services` | Which add-ons, at the price charged **at the time of booking**. |
| `coupons` / `coupon_redemptions` | Offer definitions and usage tracking. |

The price breakdown is copied onto the booking, not looked up later. If the
admin raises the daily rate next month, last month's invoice must not change.

Critical indexes for the overlap query:
```
@@index([vehicleId, pickupAt, returnAt])
@@index([status])
```

### Phase 7 — payments
| Table | Purpose |
| --- | --- |
| `payments` | One row per gateway attempt. Provider reference, status, amount. No card data, ever. |
| `refunds` | Full and partial refunds, with status. |
| `security_deposits` | Held amount and its settlement. |
| `deposit_transactions` | Every hold, deduction and release, append-only. |

`deposit_transactions` is a ledger: the deposit balance is the sum of its rows,
never an edited number. When a customer disputes a deduction, the ledger is the
answer.

### Phase 8 — the rental itself
| Table | Purpose |
| --- | --- |
| `rentals` | The active rental created at pickup. |
| `vehicle_pickups` | Mileage, fuel, condition, accessories, staff, timestamp. |
| `vehicle_returns` | Same at return, plus cleaning condition. |
| `vehicle_inspections` / `inspection_photos` | Before/after photo sets. |
| `booking_extensions` | Extension requests, availability check result, extra charge. |

### Phase 9 — charges after return
| Table | Purpose |
| --- | --- |
| `damages` | Description, type, estimated vs approved amount, photos, approver. |
| `traffic_fines` | Fine number, date, amount, company fee, status. |
| `toll_charges` | Salik/toll amount, company fee, status. |
| `maintenance_records` | Service history; blocks availability for its date range. |
| `insurance_records` | Provider, policy number, validity dates. |
| `vehicle_documents` | Registration, insurance, inspection docs with expiry. |

Damages, fines and tolls are **separate tables**, not one "charges" table with a
type column. They have genuinely different fields, different approval paths and
different disputes.

### Phase 10 — output
| Table | Purpose |
| --- | --- |
| `invoices` / `invoice_line_items` | Immutable once issued. Corrections are credit notes. |
| `notifications` | Outbound message log: channel, template, status, retries. |
| `legal_documents` | Versioned T&C, privacy, rental/cancellation/refund policy. |

Legal content is versioned because the BRD requires proving *which* terms a
customer agreed to at booking time.

## The double-booking rule

Two periods overlap when:

```
existingStart < requestedEnd  AND  existingEnd > requestedStart
```

Strict `<` and `>` on both sides means touching periods do **not** overlap: a
booking ending 15 Sep 10:00 and one starting 15 Sep 10:00 are both valid. This
is deliberate and is written down here because the BRD does not state it.
**Confirm with the client** whether a turnaround buffer (e.g. 2 hours for
cleaning and inspection) should be added — that is a policy decision, and it
will be a `system_settings` value, not a hardcoded constant.

Correctness needs two layers:

1. An overlap check inside a `SERIALIZABLE` transaction at booking creation.
2. A PostgreSQL exclusion constraint as the last line of defence, so the
   database itself rejects an overlapping row even under a race.
