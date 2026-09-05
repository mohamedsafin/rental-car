/**
 * pages/AccountPage.tsx
 * ---------------------------------------------------------------------------
 * The signed-in customer's account area (BRD 22).
 *
 * Verification status is shown as a badge, not left to be inferred from the
 * wording of a paragraph. It is the one thing here that changes because of
 * somebody ELSE's action - a staff member approving a document - so a customer
 * arriving on this page needs to see the answer, not read for it.
 */
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useMyProfile } from '../features/customer/useCustomer';

export default function AccountPage() {
  const { user, logout } = useAuth();
  const { data: profile } = useMyProfile();
  if (!user) return null;

  const verified = profile?.verification.isVerified ?? false;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">My account</h1>
          <p className="mt-1 text-sm text-ink-600">Signed in as {user.email}</p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-md border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
        >
          Sign out
        </button>
      </div>

      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-semibold text-ink-900">Profile</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <Detail label="Full name" value={user.fullName} />
          <Detail label="Email" value={user.email} />
          <Detail label="Mobile" value={user.phone ?? 'Not provided'} />
          <Detail label="Country" value={user.country ?? 'Not provided'} />
          <Detail label="Account type" value={user.role} />
          <Detail label="Status" value={user.status} />
        </dl>
      </section>

      <section
        className={
          verified
            ? 'rounded-lg border border-emerald-200 bg-emerald-50/60 p-5'
            : 'rounded-lg border border-ink-200 bg-white p-5'
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-ink-900">My documents</h2>
              {profile && (
                <span
                  className={
                    verified
                      ? 'rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-semibold text-white'
                      : 'rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800'
                  }
                >
                  {verified ? 'Verified' : 'Not verified yet'}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-ink-600">
              {verified
                ? 'All required documents are approved. You can book and pay straight away.'
                : 'Upload your ID and licence so we can verify you before your first rental.'}
            </p>
          </div>
          <Link
            to="/account/documents"
            className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
          >
            {verified ? 'View documents' : 'Upload documents'}
          </Link>
        </div>
      </section>

      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-ink-900">My bookings</h2>
            <p className="mt-1 text-sm text-ink-600">
              Upcoming reservations, active rentals and past trips.
            </p>
          </div>
          <Link
            to="/account/bookings"
            className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
          >
            View bookings
          </Link>
        </div>
      </section>

      {/*
        Payments and invoices are NOT a separate area. Both belong to a
        specific booking - "which rental was this refund for?" is the first
        question anyone asks - so they live on the booking's own page rather
        than in a global list that would immediately need a booking column.
      */}
      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-semibold text-ink-900">Payments and invoices</h2>
        <p className="mt-1 text-sm text-ink-600">
          Payment history, deposits and downloadable invoices are shown on each booking.
        </p>
        <Link
          to="/account/bookings"
          className="mt-3 inline-block text-sm font-medium text-ink-900 underline underline-offset-4"
        >
          Open a booking to see its payments and invoices
        </Link>
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="text-sm font-medium text-ink-900">{value}</dd>
    </div>
  );
}
