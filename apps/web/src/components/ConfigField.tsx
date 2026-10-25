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
      className={`flex min-w-0 flex-col gap-2 ${wide ? 'sm:col-span-2' : ''} ${
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
      className={`flex cursor-pointer items-start justify-between gap-4 rounded-xl border px-4 py-3.5 transition-colors ${
        checked
          ? 'border-forest-700/20 bg-forest-900/[0.035]'
          : 'border-line bg-canvas/40 hover:border-line-strong'
      }`}
      htmlFor={id}
    >
      <span className="min-w-0">
        <strong className="block text-[13px] font-medium text-ink-soft">{label}</strong>
        <small id={`${id}-hint`} className="mt-1 block text-[11px] leading-relaxed text-faint">
          {hint}
        </small>
      </span>
      <span className="relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center">
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
        <span className="h-6 w-11 rounded-full bg-line-strong transition-colors peer-checked:bg-forest-800 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-forest-700 peer-disabled:opacity-40" />
        <span
          className="pointer-events-none absolute left-0.5 size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"
          aria-hidden="true"
        />
      </span>
    </label>
  );
}
