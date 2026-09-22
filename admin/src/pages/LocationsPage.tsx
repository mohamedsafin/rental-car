/**
 * pages/LocationsPage.tsx
 * ---------------------------------------------------------------------------
 * Pickup, drop-off and delivery points (BRD 38).
 *
 * Note the empty state: no locations are seeded. BRD 51 says office addresses,
 * delivery areas and charges all come from the client, so inventing a
 * plausible "Dubai Airport, AED 50" would be exactly the kind of fake data that
 * quietly ships to production and gets mistaken for a real business rule.
 */
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postData } from '../services/api';
import { useAdminLocations, useDeleteLocation } from '../features/fleet/useFleetAdmin';
import FormField from '../components/FormField';
import type { NormalisedApiError } from '../types/api';
import type { Location } from '../types/vehicle';

const TYPE_LABEL: Record<string, string> = {
  OFFICE: 'Office',
  AIRPORT: 'Airport',
  HOTEL: 'Hotel',
  DELIVERY_AREA: 'Delivery area',
};

const EMPTY_FORM = {
  name: '',
  type: 'OFFICE',
  emirate: '',
  address: '',
  phone: '',
  deliveryCharge: '0',
};

export default function LocationsPage() {
  const queryClient = useQueryClient();
  const { data, isPending } = useAdminLocations();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const create = useMutation<{ location: Location }, NormalisedApiError, Record<string, unknown>>({
    mutationFn: (payload) => postData<{ location: Location }>('/locations', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-locations'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
    },
    onError: (err) => setError(err.message),
  });

  const remove = useDeleteLocation();

  function removeLocation(location: Location) {
    setError(null);
    if (
      !window.confirm(
        `Remove "${location.name}"?\n\nIt disappears from the customer's pickup and drop-off ` +
          'dropdowns. Existing bookings that used it stay intact and readable.',
      )
    ) {
      return;
    }
    remove.mutate(location.id, { onError: (err) => setError(err.message) });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    create.mutate({
      name: form.name,
      type: form.type,
      emirate: form.emirate || undefined,
      address: form.address || undefined,
      phone: form.phone || undefined,
      deliveryCharge: form.deliveryCharge || '0',
    });
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Locations</h2>
          <p className="text-sm text-slate-600">Offices, airport counters and delivery areas.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          {showForm ? 'Cancel' : 'Add location'}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-2">
          <FormField
            label="Name"
            name="name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Type</span>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="OFFICE">Office</option>
              <option value="AIRPORT">Airport</option>
              <option value="HOTEL">Hotel</option>
              <option value="DELIVERY_AREA">Delivery area</option>
            </select>
          </label>
          <FormField
            label="Emirate"
            name="emirate"
            value={form.emirate}
            onChange={(e) => setForm({ ...form, emirate: e.target.value })}
          />
          <FormField
            label="Delivery charge (AED)"
            name="deliveryCharge"
            hint="0 for free delivery"
            inputMode="decimal"
            value={form.deliveryCharge}
            onChange={(e) => setForm({ ...form, deliveryCharge: e.target.value })}
          />
          <FormField
            label="Address"
            name="address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <FormField
            label="Phone"
            name="phone"
            hint="Include country code, e.g. +97141234567"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {create.isPending ? 'Saving...' : 'Save location'}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Emirate</th>
              <th className="px-4 py-3">Delivery</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Loading...
                </td>
              </tr>
            )}
            {data?.locations.map((location) => (
              <tr key={location.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{location.name}</p>
                  {location.address && <p className="text-xs text-slate-500">{location.address}</p>}
                </td>
                <td className="px-4 py-3 text-slate-600">{TYPE_LABEL[location.type]}</td>
                <td className="px-4 py-3 text-slate-600">{location.emirate ?? '-'}</td>
                <td className="px-4 py-3 text-slate-600">
                  {location.deliveryCharge === '0.00' ? 'Free' : `AED ${location.deliveryCharge}`}
                </td>
                <td className="px-4 py-3">
                  {location.isActive ? (
                    <span className="text-xs text-emerald-700">Active</span>
                  ) : (
                    <span className="text-xs text-slate-400">Inactive</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => removeLocation(location)}
                    disabled={remove.isPending}
                    className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {remove.isPending && remove.variables === location.id ? 'Removing...' : 'Remove'}
                  </button>
                </td>
              </tr>
            ))}
            {data?.locations.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center">
                  <p className="font-medium text-slate-700">No locations yet</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Add your real offices and delivery areas. None are pre-filled, because the BRD
                    leaves these to the client.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
