import type { Outcome } from '../../../../packages/contracts/src/index';
import { outcomeLabels } from '../lib/format';
import { tonePill, type Tone } from '../lib/tone';

const tones: Record<Outcome | 'playing', Tone> = {
  won: 'good',
  lost: 'bad',
  draw: 'tie',
  interrupted: 'unknown',
  playing: 'unknown',
};

export function OutcomeBadge({ outcome }: { outcome: Outcome | null }) {
  return (
    <span className={tonePill[tones[outcome ?? 'playing']]}>
      {outcome ? outcomeLabels[outcome] : '进行中'}
    </span>
  );
}
