/**
 * prisma/seed.ts
 * ---------------------------------------------------------------------------
 * Creates the first ADMIN account.
 *
 * This exists because of a genuine chicken-and-egg problem: only an admin can
 * create staff and admin accounts, and public registration always produces a
 * CUSTOMER. Without a seeded admin there is no way into the admin panel at all.
 *
 * The credentials come from environment variables, NOT from hardcoded values.
 * A hardcoded `admin@admin.com / admin123` in a repository is a live
 * vulnerability the moment the project is deployed - and every attacker knows
 * to try it first.
 *
 * Run with:  npm run prisma:seed --workspace backend
 * Safe to re-run: it updates the existing admin rather than creating duplicates.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { seedNotificationTemplates } from './notificationTemplates';

dotenv.config();

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const fullName = process.env.SEED_ADMIN_NAME ?? 'System Administrator';

  if (!email || !password) {
    console.error(
      '\nSEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in backend/.env before seeding.\n',
    );
    process.exit(1);
  }

  if (password.length < 12) {
    // The admin account can manage the whole fleet, every customer record and
    // every payment, so twelve characters is the floor WHERE IT MATTERS.
    //
    // Refusing outright on a developer's laptop was over-strict: it blocked
    // convenient local credentials while protecting nothing, since the whole
    // database is throwaway and rebuilt on demand. In production that same
    // weak password guards real customers' identity documents and real money,
    // so there it still stops the seed dead.
    if (process.env.NODE_ENV === 'production') {
      console.error('\nSEED_ADMIN_PASSWORD must be at least 12 characters in production.\n');
      process.exit(1);
    }

    console.warn(
      `\n  WARNING: SEED_ADMIN_PASSWORD is only ${password.length} characters.` +
        '\n  Fine for local development. This account must NOT reach production with it.\n',
    );
  }

  const passwordHash = await bcrypt.hash(password, Number(process.env.BCRYPT_SALT_ROUNDS ?? 12));

  const admin = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: { passwordHash, role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
    create: {
      email: email.toLowerCase(),
      passwordHash,
      fullName,
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  console.log(`Admin account ready: ${admin.email} (${admin.id})`);

  // --- Settings the BRD leaves to the client -----------------------------
  // Seeded with EMPTY or clearly-neutral values, never invented numbers. The
  // admin fills these in from the Admin Dashboard once the client confirms
  // them. `value: ''` means "not yet configured" and later phases must treat
  // it as such rather than defaulting silently.
  const settings = [
    { key: 'company.name', value: '', valueType: 'STRING', category: 'COMPANY', label: 'Company name' },
    { key: 'company.email', value: '', valueType: 'STRING', category: 'COMPANY', label: 'Contact email' },
    { key: 'company.phone', value: '', valueType: 'STRING', category: 'COMPANY', label: 'Contact phone' },
    { key: 'company.whatsapp', value: '', valueType: 'STRING', category: 'COMPANY', label: 'WhatsApp number' },
    { key: 'company.address', value: '', valueType: 'STRING', category: 'COMPANY', label: 'Registered address', description: 'Printed on every invoice.' },
    // BLANK, and it must stay blank until the client supplies it. An invoice
    // carrying an invented Tax Registration Number is not a formatting error,
    // it is a false tax document.
    { key: 'company.trn', value: '', valueType: 'STRING', category: 'COMPANY', label: 'Tax Registration Number (TRN)', description: 'Legally required on a UAE tax invoice. Invoices warn while this is empty.' },
    { key: 'company.operating_emirates', value: '[]', valueType: 'JSON', category: 'COMPANY', label: 'Operating Emirates' },

    { key: 'pricing.currency', value: 'AED', valueType: 'STRING', category: 'PRICING', label: 'Currency', description: 'BRD 49 fixes the primary currency as AED.' },
    { key: 'pricing.vat_percentage', value: '', valueType: 'NUMBER', category: 'PRICING', label: 'VAT percentage', description: 'To be confirmed by the client. Not applied until set.' },

    { key: 'rental.minimum_age', value: '', valueType: 'NUMBER', category: 'RENTAL_POLICY', label: 'Minimum rental age' },
    { key: 'rental.turnaround_buffer_hours', value: '0', valueType: 'NUMBER', category: 'RENTAL_POLICY', label: 'Turnaround buffer (hours)', description: 'Gap enforced between one rental ending and the next starting. 0 = back-to-back allowed. Confirm with client.' },
    { key: 'cancellation.free_window_hours', value: '', valueType: 'NUMBER', category: 'RENTAL_POLICY', label: 'Free cancellation window (hours)' },
    { key: 'cancellation.fee_percentage', value: '', valueType: 'NUMBER', category: 'RENTAL_POLICY', label: 'Cancellation fee (%)' },

    // Still seeded EMPTY. BRD 12 says the exact list is client-approved, and
    // requiring the wrong document would wrongly block a paying customer -
    // or, worse, wrongly let one through. Valid values are the DocumentType
    // enum, e.g. ["EMIRATES_ID","UAE_DRIVING_LICENCE"].
    { key: 'documents.required_uae_resident', value: '[]', valueType: 'JSON', category: 'DOCUMENTS', label: 'Required documents - UAE resident', description: 'JSON array of DocumentType values. Empty = nothing required yet.' },
    { key: 'documents.required_visitor', value: '[]', valueType: 'JSON', category: 'DOCUMENTS', label: 'Required documents - visitor', description: 'JSON array of DocumentType values. Empty = nothing required yet.' },

    // A reminder schedule, not a price. BRD 41 gives 30/15/7/0 as the
    // client's own example, and warning too early is harmless where inventing
    // a fee would not be - so this one is seeded with a working value.
    { key: 'fleet.expiry_reminder_days', value: '[30,15,7,0]', valueType: 'JSON', category: 'SYSTEM', label: 'Expiry reminder days', description: 'JSON array of day offsets before expiry to alert on (BRD 41).' },

    { key: 'rental.minimum_rental_hours', value: '1', valueType: 'NUMBER', category: 'RENTAL_POLICY', label: 'Minimum rental duration (hours)', description: 'Structural floor. Confirm the commercial minimum with the client.' },
    { key: 'rental.maximum_rental_days', value: '365', valueType: 'NUMBER', category: 'RENTAL_POLICY', label: 'Maximum rental duration (days)' },
    { key: 'rental.booking_hold_minutes', value: '30', valueType: 'NUMBER', category: 'RENTAL_POLICY', label: 'Unpaid booking hold (minutes)', description: 'How long an unpaid booking holds a vehicle before the hold lapses.' },
    // Return-charge policy (BRD 26, 30, 51). All EMPTY: late fees, fuel
    // charges and cleaning fees are commercial decisions the client makes.
    // Unset means the charge is skipped and a warning is surfaced - never a
    // guessed number appearing on a customer's bill.
    { key: 'rental.late_grace_hours', value: '', valueType: 'NUMBER', category: 'RENTAL_POLICY', label: 'Late return grace period (hours)', description: 'Hours after the due time before a late fee applies. Unset = no late fee is charged.' },
    { key: 'rental.late_fee_per_day', value: '', valueType: 'NUMBER', category: 'RENTAL_POLICY', label: 'Late return fee per day', description: "Unset falls back to the vehicle's own daily rate." },
    { key: 'rental.fuel_charge_per_percent', value: '', valueType: 'NUMBER', category: 'RENTAL_POLICY', label: 'Fuel charge per 1% missing', description: 'Unset = no fuel charge is applied.' },
    { key: 'rental.cleaning_fee', value: '', valueType: 'NUMBER', category: 'RENTAL_POLICY', label: 'Cleaning fee', description: 'Flat fee when a vehicle is returned needing cleaning. Unset = no charge.' },
    { key: 'reminders.expiry_days', value: '[30,15,7,0]', valueType: 'JSON', category: 'SYSTEM', label: 'Expiry reminder days', description: 'BRD 41 gives these as an example; admin-configurable.' },
  ] as const;

  for (const setting of settings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      // Only create. Never overwrite a value the admin has already set.
      update: {},
      create: setting as never,
    });
  }

  console.log(`Seeded ${settings.length} system settings (values left blank for the client to confirm).`);

  // --- Fleet reference data ----------------------------------------------
  // Categories and features come straight from the BRD's own examples (8 and
  // 9). They are STRUCTURE, not invented business values - the admin can
  // rename, reorder or deactivate any of them, and BRD 8 explicitly says the
  // final list comes from the client.
  const categories = [
    { name: 'Economy', slug: 'economy', displayOrder: 1 },
    { name: 'Sedan', slug: 'sedan', displayOrder: 2 },
    { name: 'SUV', slug: 'suv', displayOrder: 3 },
    { name: 'Luxury', slug: 'luxury', displayOrder: 4 },
    { name: 'Sports', slug: 'sports', displayOrder: 5 },
    { name: 'Electric', slug: 'electric', displayOrder: 6 },
    { name: 'Premium', slug: 'premium', displayOrder: 7 },
  ];

  for (const category of categories) {
    await prisma.vehicleCategory.upsert({
      where: { slug: category.slug },
      update: {},
      create: category,
    });
  }
  console.log(`Seeded ${categories.length} vehicle categories.`);

  const features = [
    { name: 'Bluetooth', slug: 'bluetooth' },
    { name: 'GPS Navigation', slug: 'gps-navigation' },
    { name: 'Apple CarPlay', slug: 'apple-carplay' },
    { name: 'Android Auto', slug: 'android-auto' },
    { name: 'Reverse Camera', slug: 'reverse-camera' },
    { name: 'Parking Sensors', slug: 'parking-sensors' },
    { name: 'Cruise Control', slug: 'cruise-control' },
    { name: 'Leather Seats', slug: 'leather-seats' },
  ];

  for (const feature of features) {
    await prisma.vehicleFeature.upsert({
      where: { slug: feature.slug },
      update: {},
      create: feature,
    });
  }
  console.log(`Seeded ${features.length} vehicle features.`);

  // No locations are seeded. BRD 51 says office addresses, delivery areas,
  // working hours and delivery charges all come from the client, and inventing
  // a plausible-looking "Dubai Airport, AED 50" would be exactly the kind of
  // fake data that quietly ships to production.
  const locationCount = await prisma.location.count();
  if (locationCount === 0) {
    console.log('No locations seeded - add real ones in the admin dashboard (BRD 38).');
  }

  // --- Additional services (BRD 17) --------------------------------------
  // The BRD's own list of examples. Prices are seeded at 0 and marked
  // INACTIVE, because BRD 17 says "the client will provide the available
  // services and prices" - a seeded "Child seat: AED 50" would be a made-up
  // number that ends up on a real invoice. The admin sets the price, then
  // activates the service.
  const services = [
    { name: 'Additional Driver', slug: 'additional-driver', chargeType: 'PER_BOOKING', maxQuantity: 3, displayOrder: 1 },
    { name: 'Child Seat', slug: 'child-seat', chargeType: 'PER_DAY', maxQuantity: 3, displayOrder: 2 },
    { name: 'GPS Navigation Device', slug: 'gps-device', chargeType: 'PER_DAY', maxQuantity: 1, displayOrder: 3 },
    { name: 'Vehicle Delivery', slug: 'vehicle-delivery', chargeType: 'PER_BOOKING', maxQuantity: 1, displayOrder: 4 },
    { name: 'Vehicle Collection', slug: 'vehicle-collection', chargeType: 'PER_BOOKING', maxQuantity: 1, displayOrder: 5 },
    { name: 'Additional Mileage Package', slug: 'additional-mileage', chargeType: 'PER_BOOKING', maxQuantity: 1, displayOrder: 6 },
  ] as const;

  for (const service of services) {
    await prisma.additionalService.upsert({
      where: { slug: service.slug },
      update: {},
      create: {
        name: service.name,
        slug: service.slug,
        chargeType: service.chargeType,
        maxQuantity: service.maxQuantity,
        displayOrder: service.displayOrder,
        price: 0,
        // Off until the client confirms a price. An active service priced at
        // zero would quietly give away child seats.
        isActive: false,
      },
    });
  }
  console.log(`Seeded ${services.length} additional services (inactive, price 0 - set these in the admin dashboard).`);

  // No pricing rules are seeded. Weekend surcharges, seasonal rates and
  // long-term discount tiers are commercial decisions (BRD 16), and the UAE
  // weekend itself varies by emirate. The admin creates these.
  const ruleCount = await prisma.pricingRule.count();
  if (ruleCount === 0) {
    console.log('No pricing rules seeded - weekend/seasonal/discount rates are yours to define (BRD 16).');
  }

  // Message wording, unlike prices, ships with a working default: a system
  // that silently sends nothing looks like it works. Existing templates are
  // never overwritten, so a re-run cannot undo the client's edits.
  const templates = await seedNotificationTemplates(prisma);
  console.log(`Seeded ${templates} notification templates (existing ones left untouched).`);

  // No legal documents are seeded. Terms, privacy and cancellation policy are
  // the client's words and carry legal weight (BRD 45-47); an invented
  // cancellation clause would be worse than an empty page, because an empty
  // page gets filled in and an invented one gets relied upon.
  const legalCount = await prisma.legalDocument.count();
  if (legalCount === 0) {
    console.log(`No legal documents seeded - terms, privacy and policies are the client's to write (BRD 45-47).`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
