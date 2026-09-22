/**
 * components/CustomerEditForm.tsx
 * ---------------------------------------------------------------------------
 * Correcting a customer's file from the counter.
 *
 * Every field starts filled with what is on record and only changed fields are
 * sent, so opening the form and closing it again cannot quietly overwrite
 * something with a blank. That matters more here than on most forms: these are
 * the details that end up on an invoice and a rental agreement, and a field
 * silently emptied is a contract with a hole in it.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { patchData } from '../services/api';
import type { NormalisedApiError } from '../types/api';

export interface EditableCustomer {
  id: string;
  fullName: string;
  phone: string | null;
  residencyStatus: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  addressLine1: string | null;
  city: string | null;
  emirate: string | null;
  licenceNumber: string | null;
  licenceIssuingCountry: string | null;
  licenceExpiryDate: string | null;
}

export default function CustomerEditForm({
  customer,
  onDone,
}: {
  customer: EditableCustomer;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();

  const save = useMutation<unknown, NormalisedApiError, Record<string, unknown>>({
    mutationFn: (changes) => patchData(`/customers/${customer.id}`, changes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customer'] });
      void queryClient.invalidateQueries({ queryKey: ['customer-profile', customer.id] });
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      onDone();
    },
  });

  const [form, setForm] = useState({
    fullName: customer.fullName ?? '',
    phone: customer.phone ?? '',
    residencyStatus: customer.residencyStatus ?? '',
    dateOfBirth: customer.dateOfBirth ?? '',
    nationality: customer.nationality ?? '',
    addressLine1: customer.addressLine1 ?? '',
    city: customer.city ?? '',
    emirate: customer.emirate ?? '',
    licenceNumber: customer.licenceNumber ?? '',
    licenceIssuingCountry: customer.licenceIssuingCountry ?? '',
    licenceExpiryDate: customer.licenceExpiryDate ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  function submit() {
    setError(null);

    /*
     * Only what changed.
     *
     * A payload of every field would send empty strings for everything the
     * customer never filled in, and the API would happily write them - turning
     * "we never asked" into "they told us it was blank".
     */
    const original: Record<string, string> = {
      fullName: customer.fullName ?? '',
      phone: customer.phone ?? '',
      residencyStatus: customer.residencyStatus ?? '',
      dateOfBirth: customer.dateOfBirth ?? '',
      nationality: customer.nationality ?? '',
      addressLine1: customer.addressLine1 ?? '',
      city: customer.city ?? '',
      emirate: customer.emirate ?? '',
      licenceNumber: customer.licenceNumber ?? '',
      licenceIssuingCountry: customer.licenceIssuingCountry ?? '',
      licenceExpiryDate: customer.licenceExpiryDate ?? '',
    };

    const changes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(form)) {
      if (value !== original[key] && value !== '') changes[key] = value;
    }

    if (Object.keys(changes).length === 0) {
      onDone();
      return;
    }

    save.mutate(changes, { onError: (err) => setError(err.message) });
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Full name" value={form.fullName} onChange={set('fullName')} />
        <Field label="Phone" value={form.phone} onChange={set('phone')} />
        <label className="block">
          <span className="text-xs text-slate-500">Residency</span>
          <select
            className="input mt-1"
            value={form.residencyStatus}
            onChange={(e) => set('residencyStatus')(e.target.value)}
          >
            <option value="">Not stated</option>
            <option value="UAE_RESIDENT">UAE resident</option>
            <option value="VISITOR">Visitor</option>
          </select>
        </label>

        <Field label="Date of birth" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} />
        <Field
          label="Nationality"
          hint="2-letter code, e.g. AE"
          value={form.nationality}
          onChange={set('nationality')}
        />
        <Field label="Address" value={form.addressLine1} onChange={set('addressLine1')} />

        <Field label="City" value={form.city} onChange={set('city')} />
        <Field label="Emirate" value={form.emirate} onChange={set('emirate')} />
        <Field label="Licence number" value={form.licenceNumber} onChange={set('licenceNumber')} />

        <Field
          label="Licence country"
          hint="2-letter code"
          value={form.licenceIssuingCountry}
          onChange={set('licenceIssuingCountry')}
        />
        <Field
          label="Licence expiry"
          type="date"
          value={form.licenceExpiryDate}
          onChange={set('licenceExpiryDate')}
        />
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={save.isPending}
          onClick={submit}
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Edits here are recorded against your name. Leaving a box blank changes nothing - clear a
        value by asking an admin, not by emptying the field.
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        className="input mt-1"
        type={type ?? 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
