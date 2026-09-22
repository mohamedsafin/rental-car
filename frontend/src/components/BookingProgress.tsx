/**
 * components/BookingProgress.tsx
 * ---------------------------------------------------------------------------
 * Where this booking has got to, as a rail of steps rather than one badge.
 *
 * A badge answers "what state is it in". The customer's actual question is
 * "what has already happened, what is happening now, and what happens next" -
 * three questions a single word cannot answer. So each step carries the date
 * it completed, taken from the booking's own status history; nothing here is
 * guessed from the current status alone.
 *
 * The ORDER MATTERS and is not a design choice: it mirrors
 * `backend/src/modules/bookings/statusMachine.ts` -
 *
 *   documents ──► confirmed ──► payment ──► ready for pickup
 *
 * Confirmation is the company accepting the customer, not a receipt; payment
 * follows it. Drawing these in any other order would promise a sequence the
 * backend refuses to follow.
 *
 * Four situations the rail has to tell apart:
 *
 *   - horizontal rail from `sm` up, vertical list on phones. Seven circles
 *     across a 360px screen is a row of unreadable dots.
 *   - a cancelled booking stops the rail where it stopped in real life and
 *     ends in a red terminal. Greying out "Completed" on a booking that will
 *     never reach it implies it still might.
 *   - a step the booking legitimately skipped (cash customers never enter
 *     PAYMENT_PENDING) is drawn dashed and muted, not ticked. A tick on
 *     something that never happened is a small lie that costs trust.
 *   - but a step that ran BEFORE this booking existed - documents approved on
 *     an earlier visit - is done, not skipped. The two look identical in this
 *     booking's history and mean opposite things, so they are told apart by
 *     how the history OPENS rather than by what is missing from it.
 */
import {
  CarFront,
  Check,
  CircleCheck,
  CreditCard,
  Flag,
  KeyRound,
  ShieldCheck,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Booking, BookingStatus } from '../types/booking';

interface Step {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Every status that means "the booking is sitting on this step". */
  statuses: BookingStatus[];
}

const STEPS: Step[] = [
  /*
   * Documents lead, because verification is the gate to renting at all - it
   * either happened during this booking or before it, but it always happened
   * first. A "Booked" circle used to sit here and was dropped: it was complete
   * on every booking that could possibly be looked at, so it carried no
   * information the page header was not already showing.
   */
  { key: 'documents', label: 'Documents', icon: ShieldCheck, statuses: ['DOCUMENT_VERIFICATION'] },
  { key: 'confirmed', label: 'Confirmed', icon: CircleCheck, statuses: ['CONFIRMED'] },
  { key: 'payment', label: 'Payment', icon: CreditCard, statuses: ['PAYMENT_PENDING'] },
  { key: 'ready', label: 'Ready for pickup', icon: KeyRound, statuses: ['READY_FOR_PICKUP'] },
  {
    key: 'rental',
    label: 'On rental',
    icon: CarFront,
    // An extension is a detour off ACTIVE, not a stage of its own - the car is
    // still with the customer either way. It shows up as a note on this step.
    statuses: ['ACTIVE', 'EXTENSION_REQUESTED'],
  },
  { key: 'returned', label: 'Returned', icon: Undo2, statuses: ['RETURN_PENDING', 'RETURNED'] },
  { key: 'completed', label: 'Completed', icon: Flag, statuses: ['COMPLETED'] },
];

type StepState = 'done' | 'current' | 'skipped' | 'upcoming';

interface ResolvedStep extends Step {
  state: StepState;
  /** When this step was reached. Null if it never was. */
  at: string | null;
  /** A short line under the label - only where it earns its place. */
  note?: string;
}

function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Turn the booking into one state per step.
 *
 * Read from the history, not from the current status: a booking that jumped
 * straight from DOCUMENT_VERIFICATION to CONFIRMED (the cash path) must not
 * claim a payment step that never happened.
 */
function resolve(booking: Booking): { steps: ResolvedStep[]; cancelledAt: string | null } {
  const history = booking.statusHistory;
  const isCash = booking.paymentMethod === 'CASH_ON_PICKUP';

  const reachedAt = (step: Step): string | null => {
    const hit = history.find((entry) => step.statuses.includes(entry.to));
    return hit?.at ?? null;
  };

  /*
   * Were this customer's documents already approved when they booked?
   *
   * The backend creates a booking straight into CONFIRMED only when
   * `verification.isVerified` is true, so a history that opens on CONFIRMED
   * with no prior status is proof that verification had already happened -
   * just before this booking existed, which is why there is no timestamp for
   * it here.
   *
   * This matters because the step would otherwise be drawn as SKIPPED, which
   * says "this never happened". For a verified customer the opposite is true:
   * it happened, and it is the reason they were confirmed on the spot.
   */
  const preVerified = history[0]?.from == null && history[0]?.to === 'CONFIRMED';
  const documentsDoneEarlier = (step: Step) => step.key === 'documents' && preVerified;

  /*
   * Some bookings carry no history at all - rows imported or seeded straight
   * into the database, from before the history was kept.
   *
   * "Skipped" has to be an EVIDENCE-BASED claim: we say a step did not happen
   * because the history covers this booking and that step is missing from it.
   * With no history there is no evidence either way, and a completed rental
   * marked "Documents - not required, Payment - not required" is the rail
   * inventing a story about a booking it knows nothing about. So when the
   * record is empty, earlier steps are shown as done with no timestamp: that
   * much is implied by where the booking ended up.
   */
  const hasRecord = history.length > 0;

  const cancelled = booking.status === 'CANCELLED';
  const cancelledAt = cancelled
    ? (history.find((entry) => entry.to === 'CANCELLED')?.at ??
      booking.cancellation?.cancelledAt ??
      null)
    : null;

  // Where the rail stops. For a live booking that is the current status; for a
  // cancelled one it is the furthest step it managed to reach before stopping.
  const currentIndex = cancelled
    ? STEPS.reduce(
        (furthest, step, index) =>
          reachedAt(step) || documentsDoneEarlier(step) ? index : furthest,
        0,
      )
    : STEPS.findIndex((step) => step.statuses.includes(booking.status));

  const steps = STEPS.map((step, index): ResolvedStep => {
    const at = reachedAt(step);

    let state: StepState;
    if (index < currentIndex) {
      // Verified-before-booking counts as done even with no timestamp of its
      // own, and so does everything behind the current step on a booking with
      // no record. Only a step missing from a history that exists is a skip.
      state = at || documentsDoneEarlier(step) || !hasRecord ? 'done' : 'skipped';
    } else if (index === currentIndex) {
      // COMPLETED and CANCELLED are terminal: nothing is in progress, so they
      // get a tick rather than the "you are here" halo. A pulsing ring on a
      // rental that finished last month reads as an outstanding action.
      state = cancelled || booking.status === 'COMPLETED' ? 'done' : 'current';
    } else {
      state = 'upcoming';
    }

    let note: string | undefined;
    if (documentsDoneEarlier(step)) {
      // Stands in for the timestamp, which belongs to an approval made before
      // this booking and is not on this booking's record.
      note = 'Already verified';
    } else if (step.key === 'payment' && isCash) {
      // Never "paid at the counter" - a cash booking skips this step whether
      // or not the notes have actually been handed over, and the rail must
      // not settle that question on the counter's behalf.
      note = 'Due at the counter';
    } else if (step.key === 'rental' && booking.status === 'EXTENSION_REQUESTED') {
      note = 'Extension requested';
    } else if (state === 'skipped') {
      note = 'Not required';
    }

    return { ...step, state, at, note };
  });

  return { steps, cancelledAt };
}

/* -------------------------------------------------------------------------
 * The circle. One component so the rail and the phone list cannot drift.
 * ---------------------------------------------------------------------- */

const CIRCLE: Record<StepState, string> = {
  done: 'border-accent-500 bg-accent-500 text-white',
  current: 'border-accent-500 bg-white text-accent-600',
  skipped: 'border-dashed border-ink-300 bg-white text-ink-300',
  upcoming: 'border-ink-200 bg-ink-50 text-ink-400',
};

function Marker({ step }: { step: ResolvedStep }) {
  const Icon = step.icon;

  return (
    <span className="relative block h-10 w-10 shrink-0">
      {/* A halo on the live step only, and only for people who want motion. */}
      {step.state === 'current' && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-accent-500/25 motion-safe:animate-ping"
        />
      )}
      <span
        className={`relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors ${CIRCLE[step.state]}`}
      >
        <Icon aria-hidden className="h-4.5 w-4.5" strokeWidth={2} />
      </span>
      {step.state === 'done' && (
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border-2 border-white bg-ink-950 text-white"
        >
          <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
        </span>
      )}
    </span>
  );
}

function Label({ step }: { step: ResolvedStep }) {
  return (
    <>
      <span
        className={`text-[13px] font-medium leading-tight ${
          step.state === 'upcoming' || step.state === 'skipped' ? 'text-ink-400' : 'text-ink-950'
        }`}
      >
        {step.label}
      </span>
      {(step.at || step.note) && (
        <span className="mt-1 block text-[11px] leading-tight text-ink-400">
          {step.note ?? (step.at ? formatStamp(step.at) : null)}
        </span>
      )}
      {/* Said once, for screen readers, so the visual states carry meaning. */}
      <span className="sr-only">
        {step.state === 'done' && ' - completed'}
        {step.state === 'current' && ' - current step'}
        {step.state === 'skipped' && ' - skipped'}
        {step.state === 'upcoming' && ' - not yet reached'}
      </span>
    </>
  );
}

/** The terminal node on a cancelled booking. */
function CancelledMarker() {
  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-red-500 bg-red-500 text-white">
      <X aria-hidden className="h-4.5 w-4.5" strokeWidth={2.5} />
    </span>
  );
}

export default function BookingProgress({ booking }: { booking: Booking }) {
  const { steps, cancelledAt } = resolve(booking);
  const cancelled = booking.status === 'CANCELLED';

  // A cancelled booking shows only the ground it actually covered.
  const lastIndex = cancelled
    ? steps.reduce((furthest, step, index) => (step.state === 'done' ? index : furthest), 0)
    : steps.length - 1;
  const visible = steps.slice(0, lastIndex + 1);

  /**
   * Is the segment leading into column `index` behind us?
   *
   * Anything that is not still ahead counts - including a SKIPPED step. The
   * booking travelled that stretch of track; it just did not stop at the
   * station. Leaving the segment grey makes the rail look broken in the middle.
   */
  const travelled = (index: number) => Boolean(visible[index]) && visible[index].state !== 'upcoming';

  return (
    <section
      aria-label="Booking progress"
      className="surface mt-8 px-5 py-6 sm:px-7 sm:py-7"
    >
      {/* ---- Phones: a vertical list ---------------------------------- */}
      <ol className="space-y-0 sm:hidden">
        {visible.map((step, index) => (
          <li
            key={step.key}
            className="relative flex gap-4 pb-5 last:pb-0"
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            {index < visible.length - 1 && (
              <span
                aria-hidden
                className={`absolute left-5 top-10 h-[calc(100%-2.5rem)] w-0.5 -translate-x-1/2 ${
                  travelled(index + 1) ? 'bg-accent-500' : 'bg-ink-200'
                }`}
              />
            )}
            <Marker step={step} />
            <span className="min-w-0 pt-2">
              <Label step={step} />
            </span>
          </li>
        ))}

        {cancelled && (
          <li className="relative flex gap-4">
            <span
              aria-hidden
              className="absolute left-5 -top-5 h-5 w-0.5 -translate-x-1/2 bg-red-300"
            />
            <CancelledMarker />
            <span className="min-w-0 pt-2">
              <span className="text-[13px] font-medium leading-tight text-red-700">Cancelled</span>
              {cancelledAt && (
                <span className="mt-1 block text-[11px] leading-tight text-ink-400">
                  {formatStamp(cancelledAt)}
                </span>
              )}
            </span>
          </li>
        )}
      </ol>

      {/* ---- sm and up: a horizontal rail ------------------------------ */}
      <ol
        className="hidden sm:grid"
        style={{
          gridTemplateColumns: `repeat(${visible.length + (cancelled ? 1 : 0)}, minmax(0, 1fr))`,
        }}
      >
        {visible.map((step, index) => (
          <li
            key={step.key}
            className="relative flex flex-col items-center px-1 text-center"
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            {index > 0 && (
              <span
                aria-hidden
                className={`absolute right-1/2 top-5 h-0.5 w-full -translate-y-1/2 ${
                  travelled(index) ? 'bg-accent-500' : 'bg-ink-200'
                }`}
              />
            )}
            <span className="relative z-10">
              <Marker step={step} />
            </span>
            <span className="mt-3 block">
              <Label step={step} />
            </span>
          </li>
        ))}

        {cancelled && (
          <li className="relative flex flex-col items-center px-1 text-center">
            <span
              aria-hidden
              className="absolute right-1/2 top-5 h-0.5 w-full -translate-y-1/2 bg-red-300"
            />
            <span className="relative z-10">
              <CancelledMarker />
            </span>
            <span className="mt-3 block">
              <span className="text-[13px] font-medium leading-tight text-red-700">Cancelled</span>
              {cancelledAt && (
                <span className="mt-1 block text-[11px] leading-tight text-ink-400">
                  {formatStamp(cancelledAt)}
                </span>
              )}
            </span>
          </li>
        )}
      </ol>
    </section>
  );
}
