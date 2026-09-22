/**
 * components/ConditionSignOff.tsx
 * ---------------------------------------------------------------------------
 * The customer agreeing the car's condition, at handover and at return.
 *
 * ===========================================================================
 * WHY IT IS NOT JUST ANOTHER TICKBOX
 * ===========================================================================
 * The handover form already has a tickbox where staff confirm they checked the
 * customer's ID. That is staff vouching for staff. It proves nothing about
 * whether the customer ever saw the condition notes - and the condition notes
 * are what a damage charge stands or falls on.
 *
 * So this asks for the customer's own name, typed with them present, and
 * records it as their acknowledgement. It also offers "would not sign",
 * because a customer refusing is a real outcome and a form with no way to say
 * so gets a made-up name typed into it instead.
 *
 * Neither is mandatory. Blocking a handover on a signature would strand a
 * customer at the counter over a screen, and the honest record of "nobody
 * signed" is more useful than a forced one nobody believes.
 */
import type { SignOffState } from './conditionSignOff.helpers';

export default function ConditionSignOff({
  value,
  onChange,
  customerName,
  moment,
}: {
  value: SignOffState;
  onChange: (next: SignOffState) => void;
  customerName?: string;
  moment: 'handover' | 'return';
}) {
  return (
    <fieldset className="mt-4 rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Customer sign-off
      </legend>

      <p className="text-sm text-slate-600">
        {moment === 'handover'
          ? 'Show the customer what you have recorded above, then have them confirm it is how the car was handed over.'
          : 'Show the customer what you have recorded above, then have them confirm it is how the car came back.'}
      </p>

      {!value.customerDeclined && (
        <label className="mt-3 block">
          <span className="text-xs text-slate-500">Customer’s full name, typed by them</span>
          <input
            className="input mt-1"
            value={value.customerSignedName}
            onChange={(e) => onChange({ ...value, customerSignedName: e.target.value })}
            placeholder={customerName ?? 'Full name'}
          />
        </label>
      )}

      <label className="mt-3 flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 rounded border-slate-400"
          checked={value.customerDeclined}
          onChange={(e) =>
            onChange({
              customerDeclined: e.target.checked,
              // Clearing the name matters: a declined sign-off that still
              // carries a name is a record nobody can read.
              customerSignedName: e.target.checked ? '' : value.customerSignedName,
            })
          }
        />
        <span className="text-sm text-slate-700">
          The customer would not sign. Record the refusal instead.
        </span>
      </label>

      {!value.customerDeclined && value.customerSignedName.trim().length === 0 && (
        <p className="mt-2 text-xs text-slate-500">
          Leave both blank if nobody was there to sign. The record will say so.
        </p>
      )}
    </fieldset>
  );
}
