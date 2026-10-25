import type { ReactNode } from 'react';

export function ConfigField({
  id,
  label,
  hint,
  error,
  wide = false,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 ${wide ? 'sm:col-span-2' : ''} ${
        error ? 'field-invalid' : ''
      }`}
    >
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      <span id={`${id}-hint`} className={error ? 'field-message' : 'field-hint'}>
        {error ?? hint}
      </span>
    </div>
  );
}

export function ToggleField({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start justify-between gap-3 rounded-[3px] border px-3 py-2.5 transition-colors ${
        checked
          ? 'border-teal-line bg-teal-soft/40'
          : 'border-line bg-surface hover:border-line-strong'
      }`}
      htmlFor={id}
    >
      <span className="min-w-0">
        <strong className="block text-xs font-medium text-ink-soft">{label}</strong>
        <small id={`${id}-hint`} className="mt-0.5 block text-[10px] leading-snug text-faint">
          {hint}
        </small>
      </span>
      <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center">
        <input
          id={id}
          type="checkbox"
          name={id}
          className="peer sr-only"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-describedby={`${id}-hint`}
          role="switch"
        />
        <span className="h-5 w-9 rounded-full bg-line-strong transition-colors peer-checked:bg-teal peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-teal peer-disabled:opacity-40" />
        <span
          className="pointer-events-none absolute left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4"
          aria-hidden="true"
        />
      </span>
    </label>
  );
}
