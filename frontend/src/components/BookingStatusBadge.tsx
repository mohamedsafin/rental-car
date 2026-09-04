/**
 * components/BookingStatusBadge.tsx
 * ---------------------------------------------------------------------------
 * One badge, one meaning, everywhere. Shared styling means a customer and a
 * member of staff looking at the same booking see the same colour for the same
 * state.
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
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BOOKING_STATUS_STYLE[status]}`}
    >
      {label ?? status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}
