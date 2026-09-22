/**
 * components/EraseCustomer.tsx
 * ---------------------------------------------------------------------------
 * Honouring a "delete everything about me" request.
 *
 * ===========================================================================
 * WHY IT SAYS "ERASE DETAILS" AND NOT "DELETE CUSTOMER"
 * ===========================================================================
 * It does not delete the customer, and a button that claimed to would be
 * lying. UAE tax law requires invoices and payments to survive for five years,
 * so what goes is everything that identifies the person - name, email, phone,
 * address, date of birth, licence, and the scans of their Emirates ID and
 * passport. What stays is a nameless record of what was rented and paid.
 *
 * Typing the customer's name to confirm is not ceremony. This cannot be
 * undone and there is no second chance to read the warning, so the gesture has
 * to be one nobody performs by accident.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import { postData } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import type { NormalisedApiError } from '../types/api';

export default function EraseCustomer({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  const erase = useMutation<unknown, NormalisedApiError, void>({
    mutationFn: () => postData(`/customers/${customerId}/erase`),
    onSuccess: () => navigate('/customers'),
  });

  // The server enforces this too; hiding it keeps a button nobody can use off
  // everybody else's screen.
  if (user?.role !== 'ADMIN') return null;

  const confirmed = typed.trim().toLowerCase() === customerName.trim().toLowerCase();

  return (
    <section className="rounded-lg border border-red-200 bg-red-50/50 p-5">
      <div className="flex items-start gap-3">
        <ShieldOff className="mt-0.5 h-5 w-5 text-red-500" aria-hidden />
        <div className="flex-1">
          <h3 className="font-semibold text-red-900">Erase personal details</h3>
          <p className="mt-1 text-sm text-red-800">
            Removes their name, contact details, address, date of birth, licence details and every
            uploaded identity document. Bookings, invoices and payments stay, without a name on
            them, because tax law requires them for five years.
          </p>

          {error && (
            <p role="alert" className="mt-2 text-sm font-medium text-red-900">
              {error}
            </p>
          )}

          {open ? (
            <div className="mt-3 space-y-2">
              <label className="block text-sm text-red-900">
                Type <strong>{customerName}</strong> to confirm
                <input
                  className="input mt-1 max-w-sm"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={!confirmed || erase.isPending}
                  onClick={() => {
                    setError(null);
                    erase.mutate(undefined, { onError: (err) => setError(err.message) });
                  }}
                >
                  {erase.isPending ? 'Erasing…' : 'Erase their details permanently'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setOpen(false);
                    setTyped('');
                    setError(null);
                  }}
                >
                  Cancel
                </button>
              </div>

              <p className="text-xs text-red-700">
                This cannot be undone. If they have a car out, money owed or a deposit still held,
                the server will refuse and say which.
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-outline btn-sm mt-3"
              onClick={() => setOpen(true)}
            >
              Erase personal details
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
