import type { Outcome } from '../../../../packages/contracts/src/index';
import { outcomeLabels } from '../lib/format';

const tones: Record<Outcome | 'playing', string> = {
  won: 'border-forest-700/20 bg-[#eef5e4] text-[#4d7431]',
  lost: 'border-danger/20 bg-danger/[0.06] text-danger',
  draw: 'border-line bg-canvas text-muted',
  interrupted: 'border-line bg-canvas text-muted',
  playing: 'border-warn/25 bg-warn/[0.07] text-warn',
};

export function OutcomeBadge({ outcome }: { outcome: Outcome | null }) {
  const key = outcome ?? 'playing';
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium ${tones[key]}`}
    >
      <span className="size-1 rounded-full bg-current" aria-hidden="true" />
      {outcome ? outcomeLabels[outcome] : '进行中'}
    </span>
  );
}
