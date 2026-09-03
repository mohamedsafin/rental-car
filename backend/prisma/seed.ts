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
    // every payment. Twelve characters is the floor, not a suggestion.
    console.error('\nSEED_ADMIN_PASSWORD must be at least 12 characters.\n');
    process.exit(1);
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
    { key: 'company.operating_emirates', value: '[]', valueType: 'JSON', category: 'COMPANY', label: 'Operating Emirates' },

    { key: 'pricing.currency', value: 'AED', valueType: 'STRING', category: 'PRICING', label: 'Currency', description: 'BRD 49 fixes the primary currency as AED.' },
    { key: 'pricing.vat_percentage', value: '', valueType: 'NUMBER', category: 'PRICING', label: 'VAT percentage', description: 'To be confirmed by the client. Not applied until set.' },

    { key: 'rental.minimum_age', value: '', valueType: 'NUMBER', category: 'RENTAL_POLICY', label: 'Minimum rental age' },
    { key: 'rental.turnaround_buffer_hours', value: '0', valueType: 'NUMBER', category: 'RENTAL_POLICY', label: 'Turnaround buffer (hours)', description: 'Gap enforced between one rental ending and the next starting. 0 = back-to-back allowed. Confirm with client.' },
    { key: 'cancellation.free_window_hours', value: '', valueType: 'NUMBER', category: 'RENTAL_POLICY', label: 'Free cancellation window (hours)' },
    { key: 'cancellation.fee_percentage', value: '', valueType: 'NUMBER', category: 'RENTAL_POLICY', label: 'Cancellation fee (%)' },

    { key: 'documents.required_uae_resident', value: '[]', valueType: 'JSON', category: 'DOCUMENTS', label: 'Required documents - UAE resident' },
    { key: 'documents.required_visitor', value: '[]', valueType: 'JSON', category: 'DOCUMENTS', label: 'Required documents - visitor' },

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
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
