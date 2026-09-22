/**
 * components/AdditionalDrivers.tsx
 * ---------------------------------------------------------------------------
 * Who else may drive this car.
 *
 * An unlisted driver is an uninsured driver. After an accident the insurer's
 * first question is who was at the wheel, and if that person is not on the
 * agreement the answer decides whether anybody pays. So this sits on the
 * booking screen next to the contract, and it says so in those words rather
 * than presenting itself as an optional extra.
 *
 * The licence number is required. A driver recorded by name alone proves
 * nothing to an insurer, which makes it a record that costs effort and buys
 * no protection.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, X } from 'lucide-react';
import { getData, postData, api } from '../services/api';
import type { NormalisedApiError } from '../types/api';

interface AdditionalDriver {
  id: string;
  fullName: string;
  licenceNumber: string;
  licenceIssuingCountry: string | null;
  licenceExpiry: string | null;
  phone: string | null;
}

export default function AdditionalDrivers({
  bookingId,
  bookingStatus,
}: {
  bookingId: string;
  bookingStatus: string;
}) {
  const queryClient = useQueryClient();
  const key = ['booking-drivers', bookingId];

  const { data } = useQuery<{ drivers: AdditionalDriver[] }, NormalisedApiError>({
    queryKey: key,
    queryFn: () => getData<{ drivers: AdditionalDriver[] }>(`/bookings/${bookingId}/drivers`),
  });

  const add = useMutation<unknown, NormalisedApiError, Record<string, unknown>>({
    mutationFn: (body) => postData(`/bookings/${bookingId}/drivers`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const remove = useMutation<unknown, NormalisedApiError, string>({
    mutationFn: (driverId) => api.delete(`/bookings/${bookingId}/drivers/${driverId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [licenceNumber, setLicenceNumber] = useState('');
  const [licenceExpiry, setLicenceExpiry] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Nothing to authorise on a booking that is over or was called off.
  if (bookingStatus === 'CANCELLED' || bookingStatus === 'COMPLETED') {
    if (!data?.drivers.length) return null;
  }

  const drivers = data?.drivers ?? [];
  const closed = bookingStatus === 'CANCELLED' || bookingStatus === 'COMPLETED';

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Users className="mt-0.5 h-5 w-5 text-slate-400" aria-hidden />
          <div>
            <h3 className="section-title">Additional drivers</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              Anybody not listed here is not insured to drive this car.
            </p>
          </div>
        </div>

        {!closed && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen((o) => !o)}>
            {open ? 'Cancel' : 'Add a driver'}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {drivers.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          Only the hirer may drive. Add anyone else before the keys change hands, then reissue the
          agreement so their name is on it.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {drivers.map((driver) => (
            <li key={driver.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <p className="text-sm font-medium text-slate-900">{driver.fullName}</p>
                <p className="text-xs text-slate-500">
                  Licence {driver.licenceNumber}
                  {driver.licenceIssuingCountry ? ` (${driver.licenceIssuingCountry})` : ''}
                  {driver.licenceExpiry ? ` · expires ${driver.licenceExpiry}` : ''}
                  {driver.phone ? ` · ${driver.phone}` : ''}
                </p>
              </div>
              {!closed && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title={`Remove ${driver.fullName}`}
                  disabled={remove.isPending}
                  onClick={() => {
                    setError(null);
                    remove.mutate(driver.id, { onError: (err) => setError(err.message) });
                  }}
                >
                  <X className="h-4 w-4" aria-hidden />
                  <span className="sr-only">Remove {driver.fullName}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-slate-500">Full name *</span>
              <input className="input mt-1" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Licence number *</span>
              <input
                className="input mt-1"
                value={licenceNumber}
                onChange={(e) => setLicenceNumber(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Licence expiry</span>
              <input
                type="date"
                className="input mt-1"
                value={licenceExpiry}
                onChange={(e) => setLicenceExpiry(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Phone</span>
              <input
                className="input mt-1"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+971501234567"
              />
            </label>
          </div>

          <button
            type="button"
            className="btn btn-primary btn-sm mt-3"
            disabled={add.isPending || fullName.trim().length < 2 || !licenceNumber.trim()}
            onClick={() => {
              setError(null);
              add.mutate(
                {
                  fullName: fullName.trim(),
                  licenceNumber: licenceNumber.trim(),
                  licenceExpiry: licenceExpiry || undefined,
                  phone: phone.trim() || undefined,
                },
                {
                  onSuccess: () => {
                    setOpen(false);
                    setFullName('');
                    setLicenceNumber('');
                    setLicenceExpiry('');
                    setPhone('');
                  },
                  onError: (err) => setError(err.message),
                },
              );
            }}
          >
            {add.isPending ? 'Adding…' : 'Add them'}
          </button>
        </div>
      )}
    </section>
  );
}
