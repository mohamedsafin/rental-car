/**
 * components/BookingStatusBadge.tsx
 * ---------------------------------------------------------------------------
 * One badge, one meaning, everywhere. Shared styling means a customer and a
 * member of staff looking at the same booking see the same colour for the same
 * state. The small dot repeats the colour for anyone scanning a list quickly.
 */
import { BOOKING_STATUS_STYLE, type BookingStatus } from '../types/booking';

export default function BookingStatusBadge({
  status,
  label,
}: {
  status: BookingStatus;
  label?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${BOOKING_STATUS_STYLE[status]}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label ?? status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}
