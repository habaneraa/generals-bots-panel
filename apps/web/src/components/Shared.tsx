import { AlertCircle, Check, Info, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Connection } from '../hooks/useDashboard';

const connectionState: Record<Connection, { label: string; dot: string; pulse: string }> = {
  connecting: { label: '正在连接', dot: 'bg-warn', pulse: 'animate-pulse' },
  connected: { label: '实时连接正常', dot: 'bg-[#6d9b45]', pulse: '' },
  reconnecting: { label: '连接断开 · 正在重连', dot: 'bg-warn', pulse: 'animate-pulse' },
  disconnected: { label: '实时连接已断开', dot: 'bg-danger', pulse: '' },
};

export function ConnectionBadge({ connection }: { connection: Connection }) {
  const current = connectionState[connection];
  return (
    <span
      className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[11px] font-medium text-muted shadow-sm"
      role="status"
      aria-live="polite"
    >
      <span className={`size-1.5 rounded-full ${current.dot} ${current.pulse}`} />
      {current.label}
    </span>
  );
}

const noticeTones = {
  error: {
    box: 'border-danger/20 bg-danger/[0.055] text-danger',
    icon: <AlertCircle size={15} />,
  },
  success: {
    box: 'border-forest-700/15 bg-forest-900/[0.055] text-forest-800',
    icon: <Check size={15} />,
  },
  info: {
    box: 'border-warn/25 bg-warn/[0.07] text-warn',
    icon: <Info size={15} />,
  },
};

export function Notice({
  children,
  tone = 'error',
  action,
}: {
  children: ReactNode;
  tone?: 'error' | 'success' | 'info';
  action?: ReactNode;
}) {
  const current = noticeTones[tone];
  return (
    <div
      className={`flex flex-wrap items-center gap-2.5 rounded-xl border px-4 py-3 text-xs leading-relaxed ${current.box}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {current.icon}
      <span className="min-w-0 flex-1 break-words">{children}</span>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-2xl border border-line bg-canvas text-moss">
        {icon}
      </span>
      <strong className="mt-4 text-sm font-medium text-ink">{title}</strong>
      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted">{description}</p>
    </div>
  );
}

export function Spinner() {
  return <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />;
}
