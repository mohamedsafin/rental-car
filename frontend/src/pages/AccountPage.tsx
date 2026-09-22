/**
 * pages/AccountPage.tsx
 * ---------------------------------------------------------------------------
 * The signed-in customer's account area (BRD 22).
 *
 * Verification status leads the page, as a panel with a badge rather than a
 * sentence to be read. It is the one thing here that changes because of
 * somebody ELSE's action - a staff member approving a document - so a customer
 * arriving on this page needs to see the answer, not read for it.
 *
 * Payments and invoices are NOT a separate area. Both belong to a specific
 * booking - "which rental was this refund for?" is the first question anyone
 * asks - so they live on the booking's own page rather than in a global list
 * that would immediately need a booking column.
 */
import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, CalendarDays, FileText, LogOut, Receipt, ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useMyProfile } from '../features/customer/useCustomer';
import PageHeader from '../components/PageHeader';
import EmailVerificationNotice from '../components/EmailVerificationNotice';

export default function AccountPage() {
  const { user, logout } = useAuth();
  const { data: profile } = useMyProfile();
  if (!user) return null;

  const verified = profile?.verification.isVerified ?? false;

  /*
   * Required documents that expire within the next six months.
   *
   * "Verified" is a statement about TODAY, and it is the answer to the wrong
   * question for someone about to take a car for three months: bookings are
   * checked against their RETURN date, so a licence expiring in November
   * quietly blocks anything running past it. Saying "you can book and pay
   * straight away" and then refusing the booking is the sequence that makes a
   * correct rule look broken.
   *
   * Six months because that is roughly the longest term the monthly options
   * offer - far enough ahead to cover what a customer might book, near enough
   * that it is not permanent noise on every account.
   */
  const HORIZON_DAYS = 183;
  const expiringSoon = (profile?.verification.requirements ?? []).filter((requirement) => {
    if (!requirement.required || requirement.status !== 'APPROVED') return false;
    if (!requirement.expiryDate) return false;
    const daysLeft = (new Date(requirement.expiryDate).getTime() - Date.now()) / 86_400_000;
    return daysLeft <= HORIZON_DAYS;
  });
  const firstName = user.fullName?.trim().split(' ')[0] || 'there';

  const shortcuts = [
    {
      to: '/account/bookings',
      icon: CalendarDays,
      title: 'My bookings',
      body: 'Upcoming reservations, active rentals and past trips.',
    },
    {
      to: '/account/documents',
      icon: FileText,
      title: 'My documents',
      body: 'Your licence and ID, and where each one is in review.',
    },
    {
      to: '/account/bookings',
      icon: Receipt,
      title: 'Payments and invoices',
      body: 'Payment history, deposits and invoices are shown on each booking.',
    },
  ];

  return (
    <div className="page-container pt-10 sm:pt-14">
      <PageHeader
        eyebrow="My account"
        title={
          <>
            Hello, <span className="font-editorial">{firstName}.</span>
          </>
        }
        description={`Signed in as ${user.email}`}
        actions={
          <button type="button" onClick={() => void logout()} className="btn btn-outline">
            <LogOut aria-hidden className="h-4 w-4" />
            Sign out
          </button>
        }
      />

      {/*
        Above the document panel, because it is the smaller ask of the two and
        the one a customer can settle in ten seconds. Renders nothing once the
        address is confirmed.
      */}
      {!user.emailVerified && <EmailVerificationNotice email={user.email} />}

      <section
        aria-labelledby="verification-title"
        className={`mt-10 flex flex-col gap-6 rounded-[20px] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8 ${
          verified ? 'bg-emerald-50' : 'bg-sand-100'
        }`}
      >
        <div className="flex items-start gap-4">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
              verified ? 'bg-emerald-600 text-white' : 'bg-white text-ink-950'
            }`}
          >
            {verified ? (
              <BadgeCheck aria-hidden className="h-5 w-5" />
            ) : (
              <ShieldCheck aria-hidden className="h-5 w-5" strokeWidth={1.6} />
            )}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 id="verification-title" className="text-lg font-semibold tracking-tight text-ink-950">
                My documents
              </h2>
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
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-600">
              {verified
                ? 'All required documents are approved.'
                : 'Upload your ID and licence so we can verify you before your first rental.'}
            </p>

            {verified && expiringSoon.length > 0 && (
              <p className="mt-2.5 max-w-xl rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm leading-relaxed text-amber-900">
                {expiringSoon
                  .map((requirement) => `${requirement.label} expires ${requirement.expiryDate}`)
                  .join('; ')}
                . You can rent up to {expiringSoon.length === 1 ? 'that date' : 'the earliest of those dates'}; a
                longer booking needs a renewed copy first.
              </p>
            )}
          </div>
        </div>
        <Link
          to="/account/documents"
          className={`btn shrink-0 ${verified ? 'btn-outline' : 'btn-accent'}`}
        >
          {verified ? 'View documents' : 'Upload documents'}
          <ArrowRight aria-hidden className="btn-arrow h-4 w-4" />
        </Link>
      </section>

      <ul className="mt-6 grid gap-4 md:grid-cols-3">
        {shortcuts.map(({ to, icon: Icon, title, body }) => (
          <li key={title}>
            <Link to={to} className="group surface surface-interactive flex h-full flex-col p-6">
              <Icon aria-hidden className="h-5 w-5 text-ink-950" strokeWidth={1.5} />
              <h2 className="mt-6 flex items-center justify-between gap-2 text-base font-semibold text-ink-950">
                {title}
                <ArrowRight aria-hidden className="link-arrow-icon h-4 w-4 text-ink-400" />
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{body}</p>
            </Link>
          </li>
        ))}
      </ul>

      <section aria-labelledby="profile-title" className="mt-16">
        <h2 id="profile-title" className="text-xl font-semibold tracking-tight text-ink-950">
          Profile
        </h2>
        <dl className="mt-6 grid gap-x-8 border-t border-ink-100 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Full name" value={user.fullName} />
          <Detail label="Email" value={user.email} />
          <Detail label="Mobile" value={user.phone ?? 'Not provided'} />
          <Detail label="Country" value={user.country ?? 'Not provided'} />
          <Detail label="Account type" value={user.role} />
          <Detail label="Status" value={user.status} />
        </dl>
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-ink-100 py-5">
      <dt className="text-[13px] text-ink-500">{label}</dt>
      <dd className="mt-1 wrap-break-word text-[15px] font-medium text-ink-950">{value}</dd>
    </div>
  );
}
