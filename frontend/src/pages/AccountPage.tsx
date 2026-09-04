/**
 * pages/AccountPage.tsx
 * ---------------------------------------------------------------------------
 * The signed-in customer's account area (BRD 22).
 *
 * Phase 2 shows the profile and proves the session works. The bookings,
 * payments, invoices and documents sections need their modules to exist first,
 * so they are listed here as placeholders with the phase that delivers them.
 */
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useMyProfile } from '../features/customer/useCustomer';

const PLANNED_SECTIONS = [
  { title: 'Payments & refunds', detail: 'Payment history and refund status', phase: 'Phase 7' },
  { title: 'Invoices', detail: 'View and download invoices', phase: 'Phase 10' },
];

export default function AccountPage() {
  const { user, logout } = useAuth();
  const { data: profile } = useMyProfile();
  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My account</h1>
          <p className="mt-1 text-sm text-slate-600">Signed in as {user.email}</p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Sign out
        </button>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Profile</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <Detail label="Full name" value={user.fullName} />
          <Detail label="Email" value={user.email} />
          <Detail label="Mobile" value={user.phone ?? 'Not provided'} />
          <Detail label="Country" value={user.country ?? 'Not provided'} />
          <Detail label="Account type" value={user.role} />
          <Detail label="Status" value={user.status} />
        </dl>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">My documents</h2>
            <p className="mt-1 text-sm text-slate-600">
              {profile?.verification.isVerified
                ? 'All required documents are approved.'
                : 'Upload your ID and licence so we can verify you before your first rental.'}
            </p>
          </div>
          <Link
            to="/account/documents"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {profile?.verification.isVerified ? 'View documents' : 'Upload documents'}
          </Link>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">My bookings</h2>
            <p className="mt-1 text-sm text-slate-600">
              Upcoming reservations, active rentals and past trips.
            </p>
          </div>
          <Link
            to="/account/bookings"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            View bookings
          </Link>
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900">Coming in later phases</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {PLANNED_SECTIONS.map((section) => (
            <div key={section.title} className="rounded-lg border border-dashed border-slate-300 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">{section.title}</p>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  {section.phase}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{section.detail}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}
