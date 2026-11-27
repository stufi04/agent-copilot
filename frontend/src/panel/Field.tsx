import type { ReactNode } from 'react';
import type { Issue } from '../model/validate';

/** Label + control + inline issues for one form field. */
export function Field({
  label,
  hint,
  issues,
  children,
}: {
  label: string;
  hint?: string;
  issues?: Issue[];
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
      {issues?.map((i) => (
        <span key={i.message} className={`field__issue field__issue--${i.severity}`}>
          {i.message}
        </span>
      ))}
    </label>
  );
}
