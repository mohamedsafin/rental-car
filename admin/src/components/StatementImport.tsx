/**
 * components/StatementImport.tsx
 * ---------------------------------------------------------------------------
 * Upload a month of Salik in one go, instead of typing sixty rows per car.
 *
 * ===========================================================================
 * WHY IT PREVIEWS FIRST
 * ===========================================================================
 * An import charges dozens of real people real money. The failure mode is not
 * an error message, it is a quiet one: the wrong month's file, or a column
 * read as the wrong thing, and twenty customers billed for journeys they did
 * not make - discovered when they complain.
 *
 * So the file is read, judged and shown BEFORE anything is written. The staff
 * member sees every row, who it lands on and what it will cost them, and only
 * then presses Import. The preview and the import run the same code on the
 * server, so what is shown is what happens.
 *
 * Re-uploading the same file is safe: anything already recorded comes back as
 * a duplicate and is skipped. That matters, because the honest reaction to
 * "did that work?" is to try again.
 */
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import {
  useImportStatement,
  usePreviewStatement,
  type ImportRow,
  type ImportSummary,
} from '../features/fleetOps/useFleetOps';

/** Plain words for each outcome. Staff should not have to learn our nouns. */
const OUTCOME: Record<ImportRow['outcome'], { label: string; style: string; blurb: string }> = {
  billable: {
    label: 'Charge the customer',
    style: 'bg-emerald-100 text-emerald-800',
    blurb: 'Someone had the car. It will be recorded against their rental.',
  },
  unattached: {
    label: 'Company pays',
    style: 'bg-slate-100 text-slate-700',
    blurb: 'Nobody had the car then, so there is no customer to bill.',
  },
  written_off: {
    label: 'Written off',
    style: 'bg-amber-100 text-amber-800',
    blurb: 'Too small to chase on a short rental. Recorded, but not charged.',
  },
  duplicate: {
    label: 'Already have it',
    style: 'bg-blue-100 text-blue-800',
    blurb: 'Recorded by an earlier upload. Skipped, so nobody pays twice.',
  },
  unknown_vehicle: {
    label: 'Not our car',
    style: 'bg-red-100 text-red-700',
    blurb: 'That plate is not in the fleet. Skipped.',
  },
};

const ORDER: ImportRow['outcome'][] = [
  'billable',
  'written_off',
  'unattached',
  'duplicate',
  'unknown_vehicle',
];

const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * The words change with the kind; nothing else does.
 *
 * A fines file and a Salik file go through the same engine and the same
 * preview - only the nouns differ, and hard-coding "crossing" into a fines
 * import is how a screen starts lying quietly.
 */
const COPY = {
  tolls: {
    title: 'Import a Salik statement',
    lead: 'Download the month’s statement from the Salik portal and drop the CSV here.',
    placeholder: 'Plate,Date,Gate,Amount',
    unit: 'crossing',
  },
  fines: {
    title: 'Import a fines export',
    lead: 'Download the fines report for your fleet and drop the CSV here. Each row needs its fine number.',
    placeholder: 'Plate,Fine Number,Date,Violation,Amount',
    unit: 'fine',
  },
} as const;

export default function StatementImport({ kind = 'tolls' }: { kind?: 'fines' | 'tolls' }) {
  const copy = COPY[kind];
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [done, setDone] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const preview = usePreviewStatement(kind);
  const commit = useImportStatement(kind);

  /** A new file invalidates the preview drawn from the old one. */
  function replaceText(next: string, name: string | null) {
    setText(next);
    setFileName(name);
    setSummary(null);
    setDone(null);
    setError(null);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    replaceText(await file.text(), file.name);
  }

  function runPreview() {
    setError(null);
    setDone(null);
    preview.mutate(text, {
      onSuccess: setSummary,
      onError: (err) => {
        setSummary(null);
        setError(err.message);
      },
    });
  }

  function runImport() {
    setError(null);
    commit.mutate(text, {
      onSuccess: (result) => {
        setDone(result);
        setSummary(null);
        setText('');
        setFileName(null);
        if (fileInput.current) fileInput.current.value = '';
      },
      onError: (err) => setError(err.message),
    });
  }

  const counts = summary?.counts;
  const willWrite = counts ? counts.billable + counts.unattached + counts.written_off : 0;

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2">
        <Upload aria-hidden className="h-4 w-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-900">{copy.title}</h3>
      </div>
      <p className="text-sm text-slate-500">
        {copy.lead} Nothing is saved until you have seen what it would do. Uploading the same file
        twice is safe.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="statement-file" className="block text-sm font-medium text-slate-700">
            Statement file
          </label>
          <input
            id="statement-file"
            ref={fileInput}
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(event) => void onFile(event.target.files?.[0])}
            className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:text-white"
          />
          {fileName && <p className="mt-1 text-xs text-slate-500">{fileName}</p>}
        </div>

        <div>
          <label htmlFor="statement-text" className="block text-sm font-medium text-slate-700">
            Or paste the rows
          </label>
          <textarea
            id="statement-text"
            rows={3}
            value={text}
            onChange={(event) => replaceText(event.target.value, null)}
            placeholder={copy.placeholder}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runPreview}
          disabled={!text.trim() || preview.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {preview.isPending ? 'Reading...' : 'Check the file'}
        </button>

        {summary && (
          <button
            type="button"
            onClick={runImport}
            disabled={commit.isPending || willWrite === 0}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {commit.isPending ? 'Importing...' : `Import ${willWrite} ${copy.unit}(s)`}
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {done && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Imported {done.imported} {copy.unit}(s). {done.currency} {done.billableTotal} is now
          recoverable from customers
          {Number(done.writtenOffTotal) > 0
            ? `, and ${done.currency} ${done.writtenOffTotal} was written off as too small to chase.`
            : '.'}{' '}
          They are in the list below - press Recover on each to pass it on.
        </p>
      )}

      {summary && (
        <div className="space-y-3">
          {/* Nothing has been written yet, and the button below says so too. */}
          <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
            Nothing saved yet. This is what would happen: {summary.currency} {summary.billableTotal}{' '}
            charged to customers across {summary.counts.billable} {copy.unit}
            {summary.counts.billable === 1 ? '' : 's'}.
          </p>

          <div className="flex flex-wrap gap-2">
            {ORDER.filter((outcome) => summary.counts[outcome] > 0).map((outcome) => (
              <span
                key={outcome}
                className={`rounded-full px-3 py-1 text-xs font-medium ${OUTCOME[outcome].style}`}
                title={OUTCOME[outcome].blurb}
              >
                {summary.counts[outcome]} {OUTCOME[outcome].label.toLowerCase()}
              </span>
            ))}
          </div>

          {summary.problems.length > 0 && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-medium">
                {summary.problems.length} line(s) could not be read, and will be skipped:
              </p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {summary.problems.slice(0, 5).map((problem) => (
                  <li key={problem.line}>
                    Line {problem.line}: {problem.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.rows.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Plate</th>
                    <th className="px-3 py-2">{kind === 'fines' ? 'Offence' : 'Crossed'}</th>
                    <th className="px-3 py-2">{kind === 'fines' ? 'Fine number' : 'Gate'}</th>
                    <th className="px-3 py-2">Who pays</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.rows.map((row) => (
                    <tr key={`${row.line}-${row.plate}`}>
                      <td className="px-3 py-2 font-medium text-slate-900">{row.plate}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {when(row.crossedAt)}
                        {kind === 'fines' && row.violation && (
                          <span className="block text-xs text-slate-400">{row.violation}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {kind === 'fines' ? (row.reference ?? '-') : (row.gate ?? '-')}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {row.customerName ? (
                          <>
                            {row.customerName}
                            <span className="block text-xs text-slate-400">{row.bookingNumber}</span>
                          </>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-900">
                        {row.total}
                        {Number(row.serviceFee) > 0 && (
                          <span className="block text-xs text-slate-400">
                            {row.amount} + {row.serviceFee} fee
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            OUTCOME[row.outcome].style
                          }`}
                          title={OUTCOME[row.outcome].blurb}
                        >
                          {OUTCOME[row.outcome].label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
