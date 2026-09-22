/**
 * components/FormField.tsx
 * ---------------------------------------------------------------------------
 * One labelled input with its error message. Small, but it is what keeps every
 * form in the app consistent - and keeps the accessibility wiring
 * (label/input association, aria-invalid, aria-describedby) in one place rather
 * than copy-pasted and half-forgotten across a dozen forms.
 *
 * The error styling comes from `.field-control[aria-invalid='true']` in
 * index.css, so the red border can never disagree with what a screen reader
 * is told.
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
      <label htmlFor={name} className="field-label">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className="field-control"
        {...inputProps}
      />
      {error && (
        <p id={errorId} className="mt-2 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={hintId} className="mt-2 text-xs text-ink-500">
          {hint}
        </p>
      )}
    </div>
  );
}
