/**
 * modules/availability/searchService.ts
 * ---------------------------------------------------------------------------
 * "Show me the cars I can actually book for these dates" (BRD 6).
 *
 * The naive version - fetch every vehicle, then check each one - runs one
 * availability query per car. On a 200-car fleet that is 200 round trips for a
 * single search, and searches are the most-hit endpoint on the site.
 *
 * Instead we invert it: ONE query finds every vehicle that IS blocked in the
 * window, and the listing excludes that set. Two queries total, regardless of
 * fleet size.
 */
import { prisma } from '../../config/prisma';
import { SettingKey, settingsService } from '../settings/service';
import { vehiclesRepository } from '../vehicles/repository';
import { toPublicVehicle, type PublicVehicle } from '../vehicles/types';
import { assertValidPeriod, blockingBookingsWhere } from './service';
import { BLOCKING_STATUSES, UNBOOKABLE_VEHICLE_STATUSES, type RentalPeriod } from './types';
import type { ListVehiclesQuery } from '../vehicles/validation';

export interface SearchParams extends RentalPeriod {
  pickupLocationId?: string;
  dropoffLocationId?: string;
  filters: ListVehiclesQuery;
}

export interface SearchResult {
  items: PublicVehicle[];
  total: number;
  /** How many were excluded purely because they were already booked. */
  unavailableCount: number;
}

export const searchService = {
  /**
   * Find vehicles bookable for the requested window.
   *
   * Location handling is deliberately soft: a vehicle whose home branch is the
   * requested pickup point is included, and so is one with no branch assigned.
   * Rental companies move cars between branches daily, and hard-filtering on
   * `locationId` would hide most of the fleet from most searches. Whether
   * delivery is free, paid or unavailable per area is a client policy (BRD 18)
   * that lands with the booking module.
   */
  async search(params: SearchParams): Promise<SearchResult> {
    await assertValidPeriod(params);

    const bufferHours = await settingsService.getNumberOr(SettingKey.TURNAROUND_BUFFER_HOURS, 0);

    // Query 1: every vehicle blocked during the window.
    const blocked = await prisma.booking.findMany({
      where: blockingBookingsWhere(params, bufferHours),
      select: { vehicleId: true },
      distinct: ['vehicleId'],
    });
    const blockedIds = blocked.map((row) => row.vehicleId);

    // Query 2: the listing, minus the blocked set and minus cars whose own
    // status rules them out.
    const { items, total } = await vehiclesRepository.list(
      {
        ...params.filters,
        // Search is a customer-facing feature: never widen it to unpublished
        // vehicles, whoever is calling.
        includeUnpublished: false,
      },
      false,
      {
        id: blockedIds.length > 0 ? { notIn: blockedIds } : undefined,
        status: { notIn: [...UNBOOKABLE_VEHICLE_STATUSES] },
        ...(params.pickupLocationId
          ? { OR: [{ locationId: params.pickupLocationId }, { locationId: null }] }
          : {}),
      },
    );

    const vehicles = await Promise.all(items.map((item) => toPublicVehicle(item, false)));

    return { items: vehicles, total, unavailableCount: blockedIds.length };
  },

  /**
   * Dates in the next N days on which a vehicle is NOT free.
   *
   * Powers a "grey out unavailable dates" calendar on the car details page,
   * which is a far better experience than letting someone pick dates and only
   * then telling them no.
   */
  async getBlockedDates(vehicleId: string, days = 180): Promise<string[]> {
    const from = new Date();
    const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

    const bookings = await prisma.booking.findMany({
      where: {
        vehicleId,
        pickupAt: { lt: to },
        returnAt: { gt: from },
        OR: [
          { status: { in: BLOCKING_STATUSES } },
          { status: 'PENDING', holdExpiresAt: { gt: new Date() } },
        ],
      },
      select: { pickupAt: true, returnAt: true },
    });

    const blocked = new Set<string>();

    for (const booking of bookings) {
      // Walk each calendar day the booking touches. The return DAY is included
      // even though the return instant is not - a car coming back at 18:00 is
      // not realistically available from 09:00 that morning, and the calendar
      // should not imply otherwise.
      const cursor = new Date(booking.pickupAt);
      cursor.setUTCHours(0, 0, 0, 0);

      while (cursor <= booking.returnAt) {
        blocked.add(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    return [...blocked].sort();
  },
};
