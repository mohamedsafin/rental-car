/**
 * pages/AccidentsPage.tsx
 * ---------------------------------------------------------------------------
 * Accidents and insurance claims.
 *
 * ===========================================================================
 * WHY THIS IS A SEPARATE SCREEN FROM DAMAGES
 * ===========================================================================
 * Damages answer "what do we charge this customer?". An accident is a claim,
 * and a claim is a queue: reported, submitted to the insurer, assessed, in the
 * garage, back on the road. Each stage has somebody waiting on somebody else,
 * which is why the list leads with the stage and with how many days the car
 * has not been earning - the two numbers that decide what to chase today.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertOctagon } from 'lucide-react';
import {
  useAccidents,
  useReportAccident,
  useUpdateAccident,
  type Accident,
  type AccidentStatus,
} from '../features/accidents/useAccidents';
import { useVehicleOptions } from '../features/fleet/useFleetAdmin';

const STAGES: { value: AccidentStatus; label: string; hint: string }[] = [
  { value: 'REPORTED', label: 'Reported', hint: 'Recorded. Nothing sent to the insurer yet.' },
  { value: 'CLAIM_SUBMITTED', label: 'Claim submitted', hint: 'With the insurer, waiting on them.' },
  { value: 'ASSESSED', label: 'Assessed', hint: 'The insurer has decided what they will pay.' },
  { value: 'IN_REPAIR', label: 'In repair', hint: 'At the garage. The car is not earning.' },
  { value: 'COMPLETED', label: 'Repaired', hint: 'Back on the road. Claim may still be open.' },
  { value: 'CLOSED', label: 'Closed', hint: 'Paid, settled and done.' },
];

const STAGE_STYLE: Record<AccidentStatus, string> = {
  REPORTED: 'badge-caution',
  CLAIM_SUBMITTED: 'badge-accent',
  ASSESSED: 'badge-accent',
  IN_REPAIR: 'badge-caution',
  COMPLETED: 'badge-positive',
  CLOSED: 'badge-neutral',
};

const day = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export default function AccidentsPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? '1');
  const status = params.get('status') ?? '';

  const { data, isPending, isError, error } = useAccidents({
    page,
    limit: 20,
    status: status || undefined,
  });
  const [reporting, setReporting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Accidents & claims</h2>
          <p className="text-sm text-slate-600">
            {data ? `${data.pagination.total} report(s)` : 'Loading…'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setReporting((open) => !open)}
          >
            {reporting ? 'Cancel' : 'Report an accident'}
          </button>
          <select
            className="input max-w-[180px]"
            value={status}
            onChange={(e) => setParam('status', e.target.value)}
          >
            <option value="">All stages</option>
            {STAGES.map((stage) => (
              <option key={stage.value} value={stage.value}>
                {stage.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error.message}
        </div>
      )}

      {reporting && <ReportForm onDone={() => setReporting(false)} />}

      {isPending && <div className="skeleton h-48 rounded-xl" />}

      {data?.items.length === 0 && (
        <div className="card p-8 text-center">
          <AlertOctagon className="mx-auto h-8 w-8 text-slate-300" aria-hidden />
          <p className="mt-2 text-sm text-slate-500">
            {status ? 'Nothing at that stage.' : 'No accidents recorded. Long may it last.'}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {data?.items.map((accident) => (
          <AccidentCard
            key={accident.id}
            accident={accident}
            open={openId === accident.id}
            onToggle={() => setOpenId(openId === accident.id ? null : accident.id)}
          />
        ))}
      </div>

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={page <= 1}
            onClick={() => setParam('page', String(page - 1))}
          >
            Previous
          </button>
          <span className="text-slate-500">
            Page {page} of {data.pagination.totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={page >= data.pagination.totalPages}
            onClick={() => setParam('page', String(page + 1))}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function AccidentCard({
  accident,
  open,
  onToggle,
}: {
  accident: Accident;
  open: boolean;
  onToggle: () => void;
}) {
  const update = useUpdateAccident();
  const [error, setError] = useState<string | null>(null);

  const [claimNumber, setClaimNumber] = useState(accident.claimNumber ?? '');
  const [policeReportNumber, setPoliceReportNumber] = useState(accident.policeReportNumber ?? '');
  const [garageName, setGarageName] = useState(accident.garageName ?? '');
  const [repairCost, setRepairCost] = useState(accident.repairCost ?? '');
  const [customerLiability, setCustomerLiability] = useState(accident.customerLiability ?? '');
  const [claimPaidAmount, setClaimPaidAmount] = useState(accident.claimPaidAmount ?? '');

  function save(changes: Record<string, unknown>) {
    setError(null);
    update.mutate(
      { id: accident.id, changes },
      { onError: (err) => setError(err.message) },
    );
  }

  const stillOff = accident.offRoadFrom && !accident.offRoadUntil;

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{accident.reference}</span>
            <span className={`badge ${STAGE_STYLE[accident.status]}`}>
              {STAGES.find((s) => s.value === accident.status)?.label ?? accident.status}
            </span>
            {!accident.policeReportNumber && (
              <span className="badge badge-critical">No police report</span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {accident.vehicle?.name} · {accident.vehicle?.registrationNumber} ·{' '}
            {day(accident.occurredAt)}
            {accident.customerName ? ` · ${accident.customerName}` : ' · not on rental'}
          </p>
        </div>

        <div className="text-right">
          {accident.offRoadDays !== null && (
            <p className={`text-sm font-semibold ${stillOff ? 'text-amber-700' : 'text-slate-700'}`}>
              {accident.offRoadDays} day{accident.offRoadDays === 1 ? '' : 's'} off the road
              {stillOff ? ' so far' : ''}
            </p>
          )}
          <button type="button" className="btn btn-ghost btn-sm mt-1" onClick={onToggle}>
            {open ? 'Close' : 'Open'}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
          <p className="text-sm text-slate-700">{accident.description}</p>
          {accident.location && <p className="text-xs text-slate-500">At {accident.location}</p>}

          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}

          {/* --- Move it along -------------------------------------------- */}
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Stage</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {STAGES.map((stage) => (
                <button
                  key={stage.value}
                  type="button"
                  title={stage.hint}
                  disabled={update.isPending || stage.value === accident.status}
                  onClick={() => save({ status: stage.value })}
                  className={`btn btn-sm ${
                    stage.value === accident.status ? 'btn-primary' : 'btn-outline'
                  }`}
                >
                  {stage.label}
                </button>
              ))}
            </div>
          </div>

          {/* --- The paperwork -------------------------------------------- */}
          <div className="grid gap-3 sm:grid-cols-2">
            <SaveField
              label="Police report number"
              hint="No UAE insurer opens a claim without one."
              value={policeReportNumber}
              onChange={setPoliceReportNumber}
              onSave={() => save({ policeReportNumber })}
              busy={update.isPending}
            />
            <SaveField
              label="Insurer claim number"
              value={claimNumber}
              onChange={setClaimNumber}
              onSave={() => save({ claimNumber })}
              busy={update.isPending}
            />
            <SaveField
              label="Garage"
              value={garageName}
              onChange={setGarageName}
              onSave={() => save({ garageName })}
              busy={update.isPending}
            />
            <SaveField
              label={`Repair cost (${accident.currency})`}
              hint="Posts to this vehicle’s running costs."
              value={repairCost}
              onChange={setRepairCost}
              onSave={() => save({ repairCost })}
              busy={update.isPending}
            />
            <SaveField
              label={`Insurer paid (${accident.currency})`}
              value={claimPaidAmount}
              onChange={setClaimPaidAmount}
              onSave={() => save({ claimPaidAmount })}
              busy={update.isPending}
            />
            <SaveField
              label={`Customer liable for (${accident.currency})`}
              hint="Charge it through Damages so the customer sees why."
              value={customerLiability}
              onChange={setCustomerLiability}
              onSave={() => save({ customerLiability })}
              busy={update.isPending}
            />
          </div>

          <dl className="grid gap-3 border-t border-slate-100 pt-3 text-sm sm:grid-cols-3">
            <Fact label="Insurer" value={accident.insurerName ?? '—'} />
            <Fact label="Policy" value={accident.policyNumber ?? '—'} />
            <Fact
              label="Excess"
              value={accident.excessAmount ? `${accident.currency} ${accident.excessAmount}` : '—'}
            />
            <Fact label="Claim submitted" value={day(accident.claimSubmittedAt)} />
            <Fact label="Off road from" value={day(accident.offRoadFrom)} />
            <Fact label="Back on the road" value={day(accident.offRoadUntil)} />
          </dl>
        </div>
      )}
    </section>
  );
}

function SaveField({
  label,
  hint,
  value,
  onChange,
  onSave,
  busy,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  busy: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <div className="mt-1 flex gap-2">
        <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={busy || !value.trim()}
          onClick={onSave}
        >
          Save
        </button>
      </div>
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

/** Reporting one. Only the vehicle, when and what happened are required. */
function ReportForm({ onDone }: { onDone: () => void }) {
  const report = useReportAccident();
  const vehicles = useVehicleOptions();

  const [vehicleId, setVehicleId] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [policeReportNumber, setPoliceReportNumber] = useState('');
  const [garageName, setGarageName] = useState('');
  const [repairEstimate, setRepairEstimate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canSubmit = vehicleId && description.trim().length >= 5;

  return (
    <section className="card p-5">
      <h3 className="section-title">Report an accident</h3>
      <p className="mt-1 text-sm text-slate-500">
        The insurer and policy are filled in from the car’s live cover. The car counts as off the
        road from the moment it happened.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-slate-500">Vehicle *</span>
          <select
            className="input mt-1"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            <option value="">Choose…</option>
            {vehicles.data?.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.brand} {vehicle.model} · {vehicle.registrationNumber}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-slate-500">When *</span>
          <input
            type="datetime-local"
            className="input mt-1"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-xs text-slate-500">Where</span>
          <input className="input mt-1" value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>

        <label className="block">
          <span className="text-xs text-slate-500">Police report number</span>
          <input
            className="input mt-1"
            value={policeReportNumber}
            onChange={(e) => setPoliceReportNumber(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-xs text-slate-500">Garage</span>
          <input className="input mt-1" value={garageName} onChange={(e) => setGarageName(e.target.value)} />
        </label>

        <label className="block">
          <span className="text-xs text-slate-500">Repair estimate</span>
          <input
            className="input mt-1"
            value={repairEstimate}
            onChange={(e) => setRepairEstimate(e.target.value)}
            placeholder="e.g. 4500.00"
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="text-xs text-slate-500">What happened *</span>
        <textarea
          rows={3}
          className="input mt-1"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Rear-ended at the Al Khail exit; both cars driveable; police attended."
        />
      </label>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!canSubmit || report.isPending}
          onClick={() => {
            setError(null);
            report.mutate(
              {
                vehicleId,
                occurredAt: new Date(occurredAt).toISOString(),
                location: location.trim() || undefined,
                description: description.trim(),
                policeReportNumber: policeReportNumber.trim() || undefined,
                garageName: garageName.trim() || undefined,
                repairEstimate: repairEstimate.trim() || undefined,
              },
              { onSuccess: onDone, onError: (err) => setError(err.message) },
            );
          }}
        >
          {report.isPending ? 'Recording…' : 'Record it'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </section>
  );
}
