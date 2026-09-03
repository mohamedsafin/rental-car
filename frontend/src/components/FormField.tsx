/**
 * components/FormField.tsx
 * ---------------------------------------------------------------------------
 * One labelled input with its error message. Small, but it is what keeps every
 * form in the app consistent - and keeps the accessibility wiring
 * (label/input association, aria-invalid, aria-describedby) in one place rather
 * than copy-pasted and half-forgotten across a dozen forms.
 */
import type { InputHTMLAttributes } from 'react';

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  error?: string;
  hint?: string;
}

export default function FormField({ label, name, error, hint, ...inputProps }: FormFieldProps) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;

  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className={
          error
            ? 'mt-1 block w-full rounded-md border border-red-400 px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100'
            : 'mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100'
        }
        {...inputProps}
      />
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={hintId} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
    </div>
  );
}
