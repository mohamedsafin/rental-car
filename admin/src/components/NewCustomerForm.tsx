/**
 * components/NewCustomerForm.tsx
 * ---------------------------------------------------------------------------
 * Opening an account for someone standing at the desk.
 *
 * Only four fields are required - name, email, phone, and a company name if it
 * is a corporate hire. Everything else can be filled in later from the
 * customer's file. That is deliberate: a form that demands a passport number
 * before it will save anything is a form staff work around by typing rubbish
 * into it, and rubbish in a customer record is worse than a blank.
 *
 * No password field, on purpose. The customer sets their own from a link sent
 * to their address, so nobody at the counter ever knows their credentials.
 */
import { useState } from 'react';
import { useCreateCustomer, type CreatedCustomer } from '../features/counter/useCounter';

export default function NewCustomerForm({
  onCreated,
  onCancel,
}: {
  onCreated: (customer: CreatedCustomer) => void;
  onCancel: () => void;
}) {
  const create = useCreateCustomer();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [corporate, setCorporate] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [companyTrn, setCompanyTrn] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [licenceNumber, setLicenceNumber] = useState('');
  const [licenceExpiryDate, setLicenceExpiryDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    fullName.trim().length >= 2 &&
    /.+@.+\..+/.test(email) &&
    phone.trim().length >= 8 &&
    (!corporate || companyName.trim().length > 0);

  function submit() {
    setError(null);
    create.mutate(
      {
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        customerType: corporate ? 'CORPORATE' : 'INDIVIDUAL',
        companyName: corporate ? companyName.trim() : undefined,
        companyTrn: corporate && companyTrn.trim() ? companyTrn.trim() : undefined,
        dateOfBirth: dateOfBirth || undefined,
        licenceNumber: licenceNumber.trim() || undefined,
        licenceExpiryDate: licenceExpiryDate || undefined,
      },
      {
        onSuccess: (result) => onCreated(result.customer),
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name" required>
          <input
            className="input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="As it appears on their licence"
          />
        </Field>

        <Field label="Email" required hint="Their set-password link goes here.">
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label="Phone" required hint="With the country code, e.g. +971501234567">
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>

        <Field
          label="Date of birth"
          hint="Needed if a minimum driver age is switched on in Settings."
        >
          <input
            className="input"
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
          />
        </Field>

        <Field label="Licence number">
          <input
            className="input"
            value={licenceNumber}
            onChange={(e) => setLicenceNumber(e.target.value)}
          />
        </Field>

        <Field label="Licence expiry">
          <input
            className="input"
            type="date"
            value={licenceExpiryDate}
            onChange={(e) => setLicenceExpiryDate(e.target.value)}
          />
        </Field>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          className="rounded border-slate-300"
          checked={corporate}
          onChange={(e) => setCorporate(e.target.checked)}
        />
        This is a company hire
      </label>

      {corporate && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Company name" required>
            <input
              className="input"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </Field>
          <Field label="Company TRN" hint="Without it they cannot reclaim the VAT.">
            <input
              className="input"
              value={companyTrn}
              onChange={(e) => setCompanyTrn(e.target.value)}
            />
          </Field>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!canSubmit || create.isPending}
          onClick={submit}
        >
          {create.isPending ? 'Creating…' : 'Create the customer'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Their identity documents still have to be uploaded and approved before a booking can be
        confirmed. Open their file after creating them to do that.
      </p>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
