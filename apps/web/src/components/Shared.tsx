import { AlertCircle, Check, Info, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Connection } from '../hooks/useDashboard';

const connectionState: Record<Connection, { label: string; dot: string; pulse: string }> = {
  connecting: { label: '正在连接', dot: 'bg-warn', pulse: 'animate-pulse' },
  connected: { label: '实时连接正常', dot: 'bg-teal', pulse: '' },
  reconnecting: { label: '连接断开 · 正在重连', dot: 'bg-warn', pulse: 'animate-pulse' },
  disconnected: { label: '实时连接已断开', dot: 'bg-danger', pulse: '' },
};

export function ConnectionBadge({ connection }: { connection: Connection }) {
  const current = connectionState[connection];
  return (
    <span
      className="inline-flex w-fit items-center gap-1.5 rounded-[2px] border border-line bg-surface px-2 py-1 text-[10px] font-medium text-muted"
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
    box: 'border-danger/20 bg-danger/[0.045] text-danger',
    icon: <AlertCircle size={13} />,
  },
  success: {
    box: 'border-teal-line bg-teal-soft/60 text-teal-dark',
    icon: <Check size={13} />,
  },
  info: {
    box: 'border-warn/25 bg-warn/[0.055] text-warn',
    icon: <Info size={13} />,
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
      className={`flex flex-wrap items-center gap-2 rounded-[3px] border px-3 py-2 text-[11px] leading-snug ${current.box}`}
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
    <div className="flex min-h-44 flex-col items-center justify-center px-6 py-10 text-center">
      <span className="grid size-9 place-items-center rounded-[3px] border border-line bg-canvas text-teal">
        {icon}
      </span>
      <strong className="mt-3 text-xs font-medium text-ink">{title}</strong>
      <p className="mt-1 max-w-sm text-[11px] leading-snug text-muted">{description}</p>
    </div>
  );
}

export function Spinner() {
  return <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />;
}
