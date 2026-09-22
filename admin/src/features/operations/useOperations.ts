/**
 * features/operations/useOperations.ts
 * ---------------------------------------------------------------------------
 * Data hooks for the day-to-day boards: pickups, returns and inspections.
 *
 * Pickups and returns are the SAME endpoint with different filters. They are
 * two boards rather than one because they are two jobs done by different
 * people at different times of day, and merging them would mean every row
 * needing a badge to say which it was.
 *
 * WHY THESE FETCH SEVERAL STATUSES AT ONCE
 *
 * A booking sits at CONFIRMED until someone marks it ready, so a car that has
 * not been prepared yet is exactly the one the pickup board needs to show -
 * and this hook always said so in its comment while asking the API for
 * READY_FOR_PICKUP alone. The board was therefore blank on any morning where
 * nothing had been prepped, which is every morning before the first person
 * starts work. Returns had the same hole: a rental out on an approved
 * extension is still a car due back, and EXTENSION_REQUESTED was never asked
 * for.
 *
 * `status` on the list endpoint is a single enum, not a list, so "either of
 * these" is one request per status, merged here. That is two small requests on
 * a day board rather than a backend change to a shared contract, and the
 * results are deduplicated because a booking can only hold one status at a
 * time anyway.
 */
import { useQueries, useQuery } from '@tanstack/react-query';
import { getData } from '../../services/api';
import type { NormalisedApiError, PaginatedData } from '../../types/api';
import type { Booking } from '../../types/booking';
import type { Inspection } from '../../types/operations';

/**
 * A date as YYYY-MM-DD in the BROWSER's timezone.
 *
 * Not `toISOString().slice(0, 10)`, which is the UTC date. `dayBounds` below
 * reads these strings back as LOCAL midnight, so a UTC slice makes the two
 * disagree for exactly as long as the local offset: in the UAE (UTC+4) every
 * morning between midnight and 04:00 the boards defaulted to YESTERDAY - the
 * early shift, which is when they are opened first.
 */
export function localDate(value: Date = new Date()): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

/**
 * Start and end of a day, as the API expects.
 *
 * Local midnight to local end-of-day, converted to UTC for the query - the
 * staff looking at the board are standing in the local day, not in UTC.
 */
export function dayBounds(date: string): { from: string; to: string } {
  return {
    from: new Date(`${date}T00:00:00`).toISOString(),
    to: new Date(`${date}T23:59:59.999`).toISOString(),
  };
}

/** Cars going OUT: prepared, and confirmed-but-not-yet-prepared. */
export const PICKUP_STATUSES = ['READY_FOR_PICKUP', 'CONFIRMED'] as const;

/** Cars still OUT and therefore due back, extensions included. */
export const RETURN_STATUSES = ['ACTIVE', 'EXTENSION_REQUESTED'] as const;

export interface BoardResult {
  items: Booking[];
  isPending: boolean;
  isError: boolean;
  error: NormalisedApiError | null;
  refetch: () => void;
}

/**
 * One list per status, merged into a single board.
 *
 * `isPending` is true while ANY leg is still loading - showing half a board as
 * though it were the whole thing is worse than a moment more of the skeleton,
 * because staff would act on it.
 */
function useBookingBoard(
  key: string,
  range: { from: string; to: string },
  statuses: readonly string[],
  dateField: 'pickup' | 'return',
): BoardResult {
  const results = useQueries({
    queries: statuses.map((status) => ({
      queryKey: [key, range, status],
      queryFn: () =>
        getData<PaginatedData<Booking>>('/bookings', {
          ...range,
          dateField,
          status,
          limit: 100,
        }),
      placeholderData: (previous: PaginatedData<Booking> | undefined) => previous,
    })),
  });

  const seen = new Set<string>();
  const items: Booking[] = [];
  for (const result of results) {
    for (const booking of result.data?.items ?? []) {
      if (seen.has(booking.id)) continue;
      seen.add(booking.id);
      items.push(booking);
    }
  }

  return {
    items,
    isPending: results.some((result) => result.isPending),
    isError: results.some((result) => result.isError),
    error:
      (results.find((result) => result.isError)?.error as unknown as NormalisedApiError) ?? null,
    refetch: () => results.forEach((result) => void result.refetch()),
  };
}

/**
 * Cars going OUT: bookings whose pickup falls in range.
 *
 * `status` narrows to one of them; omitted, the board shows both.
 */
export function usePickups(range: { from: string; to: string }, status?: string): BoardResult {
  const statuses = status ? [status] : PICKUP_STATUSES;
  return useBookingBoard('pickups', range, statuses, 'pickup');
}

/** Cars coming BACK: rentals still out whose return time falls in range. */
export function useReturns(range: { from: string; to: string }): BoardResult {
  return useBookingBoard('returns', range, RETURN_STATUSES, 'return');
}

/**
 * The next day that has anything on it, looked up only when a board is empty.
 *
 * "Nothing due for collection on 2026-09-08" is true but useless: it leaves
 * staff clicking through dates one at a time to find out whether the board is
 * broken or the day is genuinely quiet. This answers that in the empty state.
 *
 * Deliberately `enabled`-gated so a busy board never pays for the extra
 * requests, and capped at 90 days because beyond that "nothing scheduled" is
 * the more useful answer than a date in the next financial year.
 */
export function useNextScheduledDay(
  after: string,
  statuses: readonly string[],
  dateField: 'pickup' | 'return',
  enabled: boolean,
): { date: string | null; isPending: boolean } {
  const from = new Date(`${after}T23:59:59`).toISOString();
  const to = new Date(new Date(`${after}T00:00:00`).getTime() + 90 * 86_400_000).toISOString();

  const results = useQueries({
    queries: statuses.map((status) => ({
      queryKey: ['next-scheduled', dateField, from, status],
      queryFn: () =>
        getData<PaginatedData<Booking>>('/bookings', {
          from,
          to,
          dateField,
          status,
          limit: 100,
        }),
      enabled,
      staleTime: 60_000,
    })),
  });

  const timestamps = results
    .flatMap((result) => result.data?.items ?? [])
    .map((booking) =>
      new Date(dateField === 'pickup' ? booking.period.pickupAt : booking.period.returnAt).getTime(),
    )
    .filter((time) => Number.isFinite(time));

  return {
    // Local, to match `dayBounds` - a UTC slice here can name a day whose
    // local bounds do not contain the booking, so the "go to" button would
    // land the user on another empty board.
    date: timestamps.length > 0 ? localDate(new Date(Math.min(...timestamps))) : null,
    isPending: enabled && results.some((result) => result.isPending),
  };
}

export function useInspections(filters: { page: number; limit: number; type?: string; withFindings?: boolean }) {
  return useQuery<PaginatedData<Inspection>, NormalisedApiError>({
    queryKey: ['inspections', filters],
    queryFn: () =>
      getData<PaginatedData<Inspection>>('/rentals/inspections', filters as Record<string, unknown>),
    placeholderData: (previous) => previous,
  });
}
