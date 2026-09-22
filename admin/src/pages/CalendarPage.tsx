/**
 * pages/CalendarPage.tsx
 * ---------------------------------------------------------------------------
 * What the whole fleet is committed to, at a glance.
 *
 * ===========================================================================
 * THE QUESTION THIS ANSWERS
 * ===========================================================================
 * Every other screen answers "is this car free on these dates?" one car at a
 * time. The question on the phone is the opposite one: "somebody wants
 * something for the 12th to the 15th - what have I got?" Answering that meant
 * opening each car in turn and holding the results in your head.
 *
 * Workshop time is drawn in the same row as hires, on purpose: a car in the
 * garage is exactly as unavailable as a car on hire, and a planner that shows
 * only one of them will happily double-book the other.
 *
 * Built as a CSS grid of day cells rather than with a calendar library. One
 * row per car, one column per day, at most 92 days - a scheduling library
 * would add a large dependency to draw rectangles this page can draw itself.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getData } from '../services/api';
import type { NormalisedApiError } from '../types/api';

interface Block {
  kind: 'BOOKING' | 'MAINTENANCE';
  id: string;
  from: string;
  to: string;
  label: string;
  detail: string;
  status: string;
}

interface CalendarVehicle {
  id: string;
  name: string;
  registrationNumber: string;
  category: string;
  status: string;
  blocks: Block[];
}

interface FleetCalendar {
  period: { from: string; to: string };
  vehicles: CalendarVehicle[];
}

const DAYS_SHOWN = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC for a date, so day maths never drifts with the local zone. */
function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export default function CalendarPage() {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');

  const from = useMemo(() => {
    const start = utcDay(new Date());
    return new Date(start.getTime() + offset * DAYS_SHOWN * DAY_MS);
  }, [offset]);

  const to = useMemo(() => new Date(from.getTime() + DAYS_SHOWN * DAY_MS), [from]);

  const { data, isPending, isError, error } = useQuery<FleetCalendar, NormalisedApiError>({
    queryKey: ['fleet-calendar', from.toISOString(), to.toISOString()],
    queryFn: () =>
      getData<FleetCalendar>('/availability/calendar', {
        from: from.toISOString(),
        to: to.toISOString(),
      }),
    placeholderData: (previous) => previous,
  });

  const days = useMemo(
    () => Array.from({ length: DAYS_SHOWN }, (_, index) => new Date(from.getTime() + index * DAY_MS)),
    [from],
  );

  const vehicles = (data?.vehicles ?? []).filter((vehicle) => {
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return (
      vehicle.name.toLowerCase().includes(needle) ||
      vehicle.registrationNumber.toLowerCase().includes(needle) ||
      vehicle.category.toLowerCase().includes(needle)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Fleet calendar</h2>
          <p className="text-sm text-slate-600">
            {days[0]?.toISOString().slice(0, 10)} to {days[days.length - 1]?.toISOString().slice(0, 10)}
            {data ? ` · ${data.vehicles.length} vehicles` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input max-w-[220px]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by make, plate or class"
          />
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setOffset((value) => value - 1)}
            aria-label="Previous 30 days"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={offset === 0}
            onClick={() => setOffset(0)}
          >
            Today
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setOffset((value) => value + 1)}
            aria-label="Next 30 days"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <Key className="bg-slate-900" label="On hire" />
        <Key className="bg-amber-500" label="Reserved, not collected" />
        <Key className="bg-slate-400" label="Workshop" />
      </div>

      {isError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error.message}
        </div>
      )}

      {isPending ? (
        <div className="skeleton h-96 rounded-xl" />
      ) : vehicles.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          {search ? 'No vehicle matches that.' : 'No vehicles in the fleet yet.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <div className="min-w-[900px]">
            {/* --- The day headings ---------------------------------------- */}
            <div
              className="grid border-b border-slate-200 bg-slate-50 text-[10px] text-slate-500"
              style={{ gridTemplateColumns: `200px repeat(${DAYS_SHOWN}, minmax(0, 1fr))` }}
            >
              <div className="px-3 py-2 font-medium uppercase tracking-wide">Vehicle</div>
              {days.map((day) => {
                const weekend = day.getUTCDay() === 5 || day.getUTCDay() === 6;
                return (
                  <div
                    key={day.toISOString()}
                    className={`py-2 text-center ${weekend ? 'bg-slate-100' : ''}`}
                    title={day.toISOString().slice(0, 10)}
                  >
                    {day.getUTCDate()}
                  </div>
                );
              })}
            </div>

            {/* --- One row per car ----------------------------------------- */}
            {vehicles.map((vehicle) => (
              <div
                key={vehicle.id}
                className="grid border-b border-slate-100 last:border-0"
                style={{ gridTemplateColumns: `200px repeat(${DAYS_SHOWN}, minmax(0, 1fr))` }}
              >
                <div className="px-3 py-2">
                  <Link
                    to={`/vehicles/${vehicle.id}`}
                    className="block truncate text-xs font-medium text-slate-900 hover:underline"
                  >
                    {vehicle.name}
                  </Link>
                  <p className="truncate text-[11px] text-slate-500">
                    {vehicle.registrationNumber} · {vehicle.category}
                  </p>
                </div>

                {days.map((day) => {
                  const dayEnd = new Date(day.getTime() + DAY_MS);
                  // A block covers this day if it overlaps it at all - half a
                  // day committed is a day the car cannot be promised to
                  // somebody else.
                  const block = vehicle.blocks.find(
                    (candidate) =>
                      new Date(candidate.from) < dayEnd && new Date(candidate.to) > day,
                  );
                  const weekend = day.getUTCDay() === 5 || day.getUTCDay() === 6;

                  return (
                    <div
                      key={day.toISOString()}
                      className={`h-9 border-l border-slate-100 p-[2px] ${weekend ? 'bg-slate-50' : ''}`}
                    >
                      {block && (
                        <div
                          className={`h-full w-full rounded-sm ${colourFor(block)}`}
                          title={`${block.label} — ${block.detail} (${block.from.slice(0, 10)} to ${block.to.slice(0, 10)})`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-500">
        A car shows as committed for any day it is even partly booked - half a day promised is a
        day it cannot be promised to somebody else. Hover a bar for the booking and the customer.
      </p>
    </div>
  );
}

function colourFor(block: Block): string {
  if (block.kind === 'MAINTENANCE') return 'bg-slate-400';
  // Out of the yard versus merely spoken for: the second can still be moved.
  return block.status === 'ACTIVE' ||
    block.status === 'EXTENSION_REQUESTED' ||
    block.status === 'RETURN_PENDING'
    ? 'bg-slate-900'
    : 'bg-amber-500';
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-3 w-5 rounded-sm ${className}`} aria-hidden />
      {label}
    </span>
  );
}
