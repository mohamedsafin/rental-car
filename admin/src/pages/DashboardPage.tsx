/**
 * pages/DashboardPage.tsx
 * ---------------------------------------------------------------------------
 * The admin overview (BRD 35).
 *
 * ===========================================================================
 * TWO SUMMARIES, THEN THE MONEY
 * ===========================================================================
 * The fleet, then what is out with customers, then this month's figures. That
 * order is the working day: a car cannot be rented if it is in the workshop or
 * has no registration on file, and a rental cannot be closed until the car
 * comes back.
 *
 * Every number here is a question somebody asks out loud and used to answer by
 * opening a list and counting - "how many are free", "what is overdue", "what
 * is due back today", "which cars have no insurance on file".
 *
 * ===========================================================================
 * A NUMBER THAT MEANS WORK IS A LINK, AND IT IS THE ONLY THING IN COLOUR
 * ===========================================================================
 * "42 available" is a fact. "3 overdue" is a job, and the useful next thing is
 * the returns screen, not a bigger font. So the tiles that represent work turn
 * amber ONLY while they have something in them, and each one goes straight to
 * the screen that clears it.
 *
 * Amber at zero would be the worst of both worlds: staff learn within a week
 * that the colour means nothing, and then it means nothing on the morning it
 * matters.
 *
 * Every count comes from the server, across the whole fleet. This page used to
 * tally the first 60 vehicles in the browser - correct until the 61st car was
 * added, after which the tiles quietly stopped adding up.
 */
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import ConnectionStatus from '../components/ConnectionStatus';
import { useDashboardReport } from '../features/output/useOutput';
import { formatCount, formatLongDate, formatMoneyCompact } from '../utils/format';

export default function DashboardPage() {
  const { data: report, isPending } = useDashboardReport();

  const fleet = report?.fleet;
  const rentals = report?.rentals;
  const currency = 'AED';

  const total = fleet?.total ?? 0;
  const onRoad = total > 0 ? Math.round(((fleet?.rented ?? 0) / total) * 100) : 0;

  return (
    <div className="space-y-7">
      {/* --- Page heading ------------------------------------------------- */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400">
            Overview
          </p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-ink-950">
            Today at a glance
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-500">{formatLongDate(new Date())}</p>
        </div>
        <ConnectionStatus />
      </div>

      {/* --- Fleet --------------------------------------------------------- */}
      <section aria-labelledby="fleet-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="fleet-heading" className="section-title">
            Fleet summary
          </h3>
          <span className="tabular text-[12px] text-ink-400">
            {onRoad}% on the road · {formatCount(total)} vehicles
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Tile label="Total cars" value={fleet?.total} loading={isPending} to="/vehicles" />
          <Tile
            label="Available"
            value={fleet?.available}
            loading={isPending}
            to="/vehicles?status=AVAILABLE"
          />
          <Tile
            label="Rented out"
            value={fleet?.rented}
            loading={isPending}
            to="/vehicles?status=RENTED"
          />
          <Tile
            label="In maintenance"
            value={fleet?.underMaintenance}
            loading={isPending}
            to="/maintenance"
          />

          <Tile
            label="Under inspection"
            value={fleet?.underInspection}
            loading={isPending}
            to="/inspections"
            hint="Back from a customer, not signed off"
            /* Not a fault, but it is a car earning nothing - worth noticing
               rather than hiding among the greys. */
            warnWhenAny
          />
          <Tile
            label="No registration"
            value={fleet?.noRegistration}
            loading={isPending}
            to="/insurance"
            hint="Nothing on file - cannot legally go out"
            warnWhenAny
          />
          <Tile
            label="No insurance"
            value={fleet?.noInsurance}
            loading={isPending}
            to="/insurance"
            hint="No policy currently in force"
            warnWhenAny
          />
          <Tile
            label="Damaged"
            value={fleet?.damaged}
            loading={isPending}
            to="/damages"
            hint="Damage not yet resolved"
            warnWhenAny
          />
          <Tile
            label="Expired documents"
            value={(fleet?.expiredRegistration ?? 0) + (fleet?.expiredInsurance ?? 0)}
            loading={isPending}
            to="/insurance"
            hint={
              fleet
                ? `${fleet.expiredRegistration} registration · ${fleet.expiredInsurance} insurance`
                : undefined
            }
            warnWhenAny
          />
        </div>
      </section>

      {/* --- Rentals ------------------------------------------------------- */}
      <section aria-labelledby="rentals-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="rentals-heading" className="section-title">
            Rental summary
          </h3>
          <Link to="/bookings" className="text-[12px] font-medium text-ink-500 hover:text-ink-950">
            All bookings
          </Link>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Tile
            label="Active rentals"
            value={rentals?.active}
            loading={isPending}
            to="/bookings?status=ACTIVE"
          />
          <Tile
            label="Overdue"
            value={rentals?.overdue}
            loading={isPending}
            to="/returns"
            hint="Out past its due date"
            warnWhenAny
          />
          <Tile
            label="Due back today"
            value={rentals?.dueBackToday}
            loading={isPending}
            to="/returns"
          />
          <Tile
            label="Returned today"
            value={rentals?.returnedToday}
            loading={isPending}
            to="/inspections"
          />
          <Tile
            label="Awaiting payment"
            value={rentals?.awaitingPayment}
            loading={isPending}
            to="/bookings?awaitingPayment=true"
            hint="Confirmed, still unpaid"
            warnWhenAny
          />
          <Tile
            label="Documents to review"
            value={rentals?.documentsToReview}
            loading={isPending}
            to="/customers?pending=true"
            hint="Customers waiting on you"
            warnWhenAny
          />
        </div>
      </section>

      {/* --- Today, and what is still to collect ---------------------------- */}
      <section aria-labelledby="today-heading">
        <div className="flex items-center justify-between gap-3">
          <h3 id="today-heading" className="section-title">
            Today
          </h3>
          <Link to="/fines" className="text-[12px] font-medium text-ink-500 hover:text-ink-950">
            Fines &amp; tolls
          </Link>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MoneyTile
            label="Taken today"
            value={report ? `${currency} ${formatMoneyCompact(report.today.revenue)}` : null}
            hint={report ? `${formatCount(report.today.payments)} payment(s)` : undefined}
            loading={isPending}
            emphasis
          />
          {/*
            Split on purpose. One "charges outstanding" figure would hide
            whether the problem is twenty small tolls or one large fine, and
            those are different afternoons.
          */}
          <MoneyTile
            label="Fines to recover"
            value={report ? `${currency} ${formatMoneyCompact(report.charges.fines.amount)}` : null}
            hint={report ? `${formatCount(report.charges.fines.count)} not yet recovered` : undefined}
            loading={isPending}
          />
          <MoneyTile
            label="Salik to recover"
            value={report ? `${currency} ${formatMoneyCompact(report.charges.tolls.amount)}` : null}
            hint={report ? `${formatCount(report.charges.tolls.count)} not yet recovered` : undefined}
            loading={isPending}
          />
        </div>
      </section>

      {/* --- Money --------------------------------------------------------- */}
      <section aria-labelledby="month-heading">
        <div className="flex items-center justify-between gap-3">
          <h3 id="month-heading" className="section-title">
            This month
          </h3>
          <Link to="/reports" className="text-[12px] font-medium text-ink-500 hover:text-ink-950">
            Full reports
          </Link>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MoneyTile
            label="Revenue"
            value={report ? `${currency} ${formatMoneyCompact(report.revenue.netRevenue)}` : null}
            hint="Money actually received"
            loading={isPending}
            emphasis
          />
          <MoneyTile
            label="Booked value"
            value={report ? `${currency} ${formatMoneyCompact(report.bookings.bookedValue)}` : null}
            hint="Agreed, not all received"
            loading={isPending}
          />
          <MoneyTile
            label="Bookings"
            value={report ? formatCount(report.bookings.totalBookings) : null}
            hint={report ? `${report.bookings.cancellations} cancelled` : undefined}
            loading={isPending}
          />
          <MoneyTile
            label="Deposits held"
            value={
              report ? `${currency} ${formatMoneyCompact(report.outstanding.depositsHeld)}` : null
            }
            hint="Customers' money, not income"
            loading={isPending}
          />
        </div>

        {/*
          Its own line rather than a tile: it is money the company has already
          spent and not taken back, and unlike the figures above it says what to
          do about it.
        */}
        {report && Number(report.outstanding.unrecoveredCharges) > 0 && (
          <Link
            to="/fines"
            className="card card-interactive mt-3 flex items-center gap-3 p-4 hover:no-underline"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-ink-900">
                {currency} {formatMoneyCompact(report.outstanding.unrecoveredCharges)} in fines,
                tolls and damages not yet recovered
              </span>
              <span className="block text-[12px] text-ink-500">
                Recover them from a rental before it is completed — a closed booking takes no
                further charges.
              </span>
            </span>
            <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-ink-400" />
          </Link>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * One number.
 *
 * `warnWhenAny` is the design of this page in a single prop: a tile that
 * represents WORK turns amber while it has any, and goes quiet at zero. A
 * count of available cars is never amber, however low - it is a fact, not a
 * job.
 */
function Tile({
  label,
  value,
  hint,
  to,
  loading,
  warnWhenAny,
}: {
  label: string;
  value: number | undefined;
  hint?: string;
  to: string;
  loading?: boolean;
  warnWhenAny?: boolean;
}) {
  const urgent = Boolean(warnWhenAny) && (value ?? 0) > 0;

  return (
    <Link
      to={to}
      title={hint}
      className={[
        'card card-raised card-interactive flex flex-col justify-between p-4',
        urgent ? 'border-accent-200 bg-accent-50/60' : '',
      ].join(' ')}
    >
      <p className={`text-[12px] font-medium ${urgent ? 'text-accent-700' : 'text-ink-500'}`}>
        {label}
      </p>

      <p
        className={`tabular mt-2 text-[26px] font-semibold leading-none tracking-tight ${
          urgent ? 'text-accent-700' : 'text-ink-950'
        }`}
      >
        {loading || value === undefined ? (
          <span className="skeleton block h-6 w-10" aria-hidden />
        ) : (
          value
        )}
      </p>

      {hint && (
        <p
          className={`mt-1.5 text-[11px] leading-snug ${
            urgent ? 'text-accent-700/80' : 'text-ink-400'
          }`}
        >
          {hint}
        </p>
      )}
    </Link>
  );
}

/** A figure worth knowing but not worth acting on: no colour, no link. */
function MoneyTile({
  label,
  value,
  hint,
  loading,
  emphasis,
}: {
  label: string;
  value: string | null;
  hint?: string;
  loading?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className="card card-raised p-4">
      <p className="text-[12px] font-medium text-ink-500">{label}</p>
      <p
        className={[
          'tabular mt-2 font-semibold leading-tight tracking-tight text-ink-950',
          emphasis ? 'text-[22px]' : 'text-[19px]',
        ].join(' ')}
      >
        {loading || value === null ? <span className="skeleton block h-6 w-28" aria-hidden /> : value}
      </p>
      {hint && <p className="mt-1 text-[11px] leading-snug text-ink-400">{hint}</p>}
    </div>
  );
}
