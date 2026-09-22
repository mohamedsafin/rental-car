/**
 * tests/settings.test.ts
 * ---------------------------------------------------------------------------
 * The values the client supplies, and the promise the code makes about them.
 *
 * ===========================================================================
 * THE ONE RULE WORTH PROTECTING
 * ===========================================================================
 * An unset setting returns NULL, never a plausible-looking default. That
 * single decision is what stops a 5% VAT rate nobody approved appearing on a
 * real invoice, or a minimum driving age of 21 being enforced in a country
 * that said 25.
 *
 * It is also a rule that is trivially easy to "fix" wrongly. Somebody hits a
 * null, adds `?? 5` to make a page render, and the system starts quietly
 * inventing business values again. That is what these tests are guarding
 * against - not the getters working, but the contract holding.
 *
 * Every test restores what it changed. This suite writes to settings the rest
 * of the suite reads.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma, disconnectPrisma } from '../src/config/prisma';
import { clearSettingsCache, settingsService, SettingKey } from '../src/modules/settings/service';
import { API, cleanupUsers, createUser, loginAndGetToken } from './helpers';

const app = createApp();
const createdEmails: string[] = [];

let adminToken: string;
let staffToken: string;
let customerToken: string;

/** Restored in afterAll, so this suite cannot change what others read. */
const originals = new Map<string, string>();

async function remember(key: string) {
  if (originals.has(key)) return;
  const setting = await prisma.systemSetting.findUnique({ where: { key } });
  originals.set(key, setting?.value ?? '');
}

async function setValue(key: string, value: string) {
  await remember(key);
  await prisma.systemSetting.update({ where: { key }, data: { value } });
  clearSettingsCache();
}

beforeAll(async () => {
  const admin = await createUser({ role: 'ADMIN' });
  const staff = await createUser({ role: 'STAFF' });
  const customer = await createUser({ role: 'CUSTOMER' });
  createdEmails.push(admin.email, staff.email, customer.email);

  adminToken = await loginAndGetToken(app, admin.email);
  staffToken = await loginAndGetToken(app, staff.email);
  customerToken = await loginAndGetToken(app, customer.email);
});

beforeEach(() => {
  clearSettingsCache();
});

afterAll(async () => {
  for (const [key, value] of originals) {
    await prisma.systemSetting.update({ where: { key }, data: { value } });
  }
  clearSettingsCache();
  await cleanupUsers(createdEmails);
  await disconnectPrisma();
});

describe('an unset setting is null, never a guess', () => {
  it('returns null for a blank value rather than zero', async () => {
    await setValue(SettingKey.VAT_PERCENTAGE, '');

    const vat = await settingsService.getNumber(SettingKey.VAT_PERCENTAGE);

    /*
     * Zero would be a defensible-looking answer and a catastrophic one: it
     * reads as "VAT is 0%", which is a tax position, not a missing value.
     */
    expect(vat).toBeNull();
  });

  it('treats whitespace as unset', async () => {
    await setValue(SettingKey.VAT_PERCENTAGE, '   ');
    expect(await settingsService.getNumber(SettingKey.VAT_PERCENTAGE)).toBeNull();
  });

  it('returns null for a value that is not a number, rather than NaN', async () => {
    await setValue(SettingKey.VAT_PERCENTAGE, 'five percent');

    // NaN propagates silently through arithmetic and surfaces as "AED NaN" on
    // a customer's invoice. Null stops at the first consumer.
    expect(await settingsService.getNumber(SettingKey.VAT_PERCENTAGE)).toBeNull();
  });

  it('returns null for a key that does not exist at all', async () => {
    expect(await settingsService.getString('nothing.like.this')).toBeNull();
  });

  it('reads a real value once it is set', async () => {
    await setValue(SettingKey.VAT_PERCENTAGE, '5');
    expect(await settingsService.getNumber(SettingKey.VAT_PERCENTAGE)).toBe(5);
  });

  it('only uses a fallback where one was explicitly asked for', async () => {
    await setValue(SettingKey.TURNAROUND_BUFFER_HOURS, '');

    // getNumberOr exists for STRUCTURAL defaults - zero buffer hours is the
    // absence of a policy, not a policy. VAT must never go through it.
    expect(await settingsService.getNumber(SettingKey.TURNAROUND_BUFFER_HOURS)).toBeNull();
    expect(await settingsService.getNumberOr(SettingKey.TURNAROUND_BUFFER_HOURS, 0)).toBe(0);
  });
});

describe('the cache cannot serve a stale price', () => {
  it('reflects a change as soon as the cache is cleared', async () => {
    await setValue(SettingKey.VAT_PERCENTAGE, '5');
    expect(await settingsService.getNumber(SettingKey.VAT_PERCENTAGE)).toBe(5);

    await setValue(SettingKey.VAT_PERCENTAGE, '7.5');

    // setValue clears it, which is what every write path does. Without that,
    // quotes would keep using the old rate for up to 30 seconds after an
    // admin changed it - during which two customers get two prices.
    expect(await settingsService.getNumber(SettingKey.VAT_PERCENTAGE)).toBe(7.5);
  });

  it('clears the cache when a setting is saved through the API', async () => {
    await remember(SettingKey.VAT_PERCENTAGE);
    await setValue(SettingKey.VAT_PERCENTAGE, '5');
    expect(await settingsService.getNumber(SettingKey.VAT_PERCENTAGE)).toBe(5);

    const res = await request(app)
      .patch(`${API}/settings/${SettingKey.VAT_PERCENTAGE}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: '9' });
    expect(res.status).toBe(200);

    expect(await settingsService.getNumber(SettingKey.VAT_PERCENTAGE)).toBe(9);
  });
});

describe('who can change what customers pay', () => {
  it('lets an ADMIN save a value', async () => {
    await remember(SettingKey.FINE_SERVICE_FEE);

    const res = await request(app)
      .patch(`${API}/settings/${SettingKey.FINE_SERVICE_FEE}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: '25' });

    expect(res.status).toBe(200);
  });

  it('REFUSES a STAFF member', async () => {
    const res = await request(app)
      .patch(`${API}/settings/${SettingKey.FINE_SERVICE_FEE}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ value: '999' });

    // Staff run the counter; they do not set the prices.
    expect(res.status).toBe(403);
  });

  it('REFUSES a customer outright, and lets them read nothing', async () => {
    const write = await request(app)
      .patch(`${API}/settings/${SettingKey.VAT_PERCENTAGE}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ value: '0' });

    const read = await request(app)
      .get(`${API}/settings`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(write.status).toBe(403);
    expect(read.status).toBe(403);
  });

  it('REFUSES a number setting given words', async () => {
    const res = await request(app)
      .patch(`${API}/settings/${SettingKey.VAT_PERCENTAGE}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 'five' });

    // Otherwise it sits in the database until the pricing engine trips over
    // it in the middle of a quote.
    expect(res.status).toBe(400);
  });

  it('REFUSES a setting that does not exist', async () => {
    const res = await request(app)
      .patch(`${API}/settings/made.up.key`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: '1' });

    expect(res.status).toBe(404);
  });

  it('accepts blank - clearing a setting is a legitimate decision', async () => {
    await remember(SettingKey.TOLL_SERVICE_FEE);

    const res = await request(app)
      .patch(`${API}/settings/${SettingKey.TOLL_SERVICE_FEE}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: '' });

    expect(res.status).toBe(200);
    expect(await settingsService.getNumber(SettingKey.TOLL_SERVICE_FEE)).toBeNull();
  });
});

describe('the setup checklist', () => {
  it('names an unset setting and what it is switching off', async () => {
    await setValue(SettingKey.MINIMUM_RENTAL_AGE, '');

    const res = await request(app)
      .get(`${API}/settings/readiness`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    const item = (res.body.data.items as { key: string; severity: string; consequence: string }[])
      .find((entry) => entry.key === SettingKey.MINIMUM_RENTAL_AGE);

    expect(item).toBeDefined();
    expect(item!.severity).toBe('blocking');
    // The whole point of the panel: not "this is empty" but "here is what is
    // not happening because it is empty".
    expect(item!.consequence).toMatch(/age/i);
  });

  it('stops naming it once it is set', async () => {
    await setValue(SettingKey.MINIMUM_RENTAL_AGE, '21');

    const res = await request(app)
      .get(`${API}/settings/readiness`)
      .set('Authorization', `Bearer ${staffToken}`);

    const keys = (res.body.data.items as { key: string }[]).map((entry) => entry.key);
    expect(keys).not.toContain(SettingKey.MINIMUM_RENTAL_AGE);
  });

  it('does not count an optional blank as a problem', async () => {
    await setValue(SettingKey.TOLL_AUTO_WRITE_OFF_BELOW, '');

    const res = await request(app)
      .get(`${API}/settings/readiness`)
      .set('Authorization', `Bearer ${staffToken}`);

    const item = (res.body.data.items as { key: string; severity: string }[]).find(
      (entry) => entry.key === SettingKey.TOLL_AUTO_WRITE_OFF_BELOW,
    );

    // Listed, so it is discoverable - but never counted, so the panel does
    // not spend its credibility nagging about a legitimate blank.
    expect(item?.severity).toBe('optional');
    expect(res.body.data.blocking).toBeTypeOf('number');
  });
});
