/**
 * modules/rentals/inspectionsService.ts
 * ---------------------------------------------------------------------------
 * Listing inspections across the whole fleet (BRD 25).
 *
 * Everything else about an inspection is reached through its booking, which is
 * right for doing the work - you inspect a car in front of you, from that
 * booking's page. This exists for the other question: "show me every
 * inspection", which is how a manager spots the handover nobody photographed
 * or the return with damage notes that never became a damage record.
 *
 * Read-only. Inspections are created at pickup and return, by the staff member
 * standing at the car, and there is deliberately no way to create one from a
 * list screen - an inspection recorded away from the vehicle is a fiction.
 */
import type { InspectionType, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';

export const inspectionsService = {
  async list(query: {
    page: number;
    limit: number;
    type?: InspectionType;
    /** Only inspections with damage or condition notes worth reviewing. */
    withFindings?: boolean;
  }) {
    const where: Prisma.VehicleInspectionWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.withFindings
        ? {
            OR: [
              { damageNotes: { not: null } },
              { conditionNotes: { not: null } },
            ],
          }
        : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.vehicleInspection.findMany({
        where,
        include: {
          photos: { select: { id: true } },
          inspectedBy: { select: { fullName: true } },
          rental: {
            select: {
              booking: {
                select: {
                  id: true,
                  bookingNumber: true,
                  customer: { select: { fullName: true } },
                  vehicle: { select: { brand: true, model: true, registrationNumber: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.vehicleInspection.count({ where }),
    ]);

    return {
      items: items.map((inspection) => ({
        id: inspection.id,
        type: inspection.type,
        mileage: inspection.mileage,
        fuelPercent: inspection.fuelPercent,
        conditionNotes: inspection.conditionNotes,
        cleanliness: inspection.cleanliness,
        damageNotes: inspection.damageNotes,
        photoCount: inspection.photos.length,
        inspectedBy: inspection.inspectedBy?.fullName ?? null,
        bookingId: inspection.rental.booking.id,
        bookingNumber: inspection.rental.booking.bookingNumber,
        customer: inspection.rental.booking.customer.fullName,
        vehicle: `${inspection.rental.booking.vehicle.brand} ${inspection.rental.booking.vehicle.model}`,
        registrationNumber: inspection.rental.booking.vehicle.registrationNumber,
        createdAt: inspection.createdAt.toISOString(),
      })),
      total,
    };
  },
};
