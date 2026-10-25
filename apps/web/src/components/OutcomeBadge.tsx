import type { Outcome } from '../../../../packages/contracts/src/index';
import { outcomeLabels } from '../lib/format';

const tones: Record<Outcome | 'playing', string> = {
  won: 'border-teal-line bg-teal-soft text-teal-dark',
  lost: 'border-danger/20 bg-danger/[0.05] text-danger',
  draw: 'border-line bg-surface-subtle text-muted',
  interrupted: 'border-line bg-surface-subtle text-muted',
  playing: 'border-warn/25 bg-warn/[0.05] text-warn',
};

export function OutcomeBadge({ outcome }: { outcome: Outcome | null }) {
  const key = outcome ?? 'playing';
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[2px] border px-1.5 py-0.5 text-[10px] font-medium leading-none ${tones[key]}`}
    >
      <span className="size-1 rounded-full bg-current" aria-hidden="true" />
      {outcome ? outcomeLabels[outcome] : '进行中'}
    </span>
  );
}
