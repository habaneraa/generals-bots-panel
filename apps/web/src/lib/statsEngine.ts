import type { MatchRecord } from '../../../../packages/contracts/src/index';

export const MIN_OPPONENT_COMPLETED_MATCHES = 3;
export const OPPONENT_RANKING_LIMIT = 5;

export type OutcomeCounts = {
  won: number;
  lost: number;
  draw: number;
  interrupted: number;
  playing: number;
};

export type TurnGroup = OutcomeCounts & {
  label: string;
  records: number;
  completed: number;
  winRate: number | null;
};

export type OpponentSummary = OutcomeCounts & {
  name: string;
  games: number;
  stars: number | null;
  completed: number;
  winRate: number | null;
};

export type MatchStatistics = {
  turnGroups: TurnGroup[];
  unclassifiedTurns: number;
  opponents: OpponentSummary[];
  frequentOpponents: OpponentSummary[];
  highestWinRateOpponents: OpponentSummary[];
  lowestWinRateOpponents: OpponentSummary[];
  eligibleOpponentCount: number;
};

type MutableOutcomeCounts = OutcomeCounts & { records: number };
type MutableOpponent = MutableOutcomeCounts & {
  name: string;
  games: number;
  stars: number | null;
  latestCompletedAt: number;
};

const turnGroupLabels = ['0–99', '100–499', '500+'] as const;

function emptyCounts(): MutableOutcomeCounts {
  return { records: 0, won: 0, lost: 0, draw: 0, interrupted: 0, playing: 0 };
}

function addOutcome(counts: MutableOutcomeCounts, outcome: MatchRecord['outcome']): void {
  counts.records++;
  if (outcome === null) counts.playing++;
  else counts[outcome]++;
}

function completedCount(counts: OutcomeCounts): number {
  return counts.won + counts.lost + counts.draw;
}

function winRate(counts: OutcomeCounts): number | null {
  const completed = completedCount(counts);
  return completed ? counts.won / completed : null;
}

function nameOrder(a: OpponentSummary, b: OpponentSummary): number {
  return a.name.localeCompare(b.name, 'zh-CN');
}

function opponentStars(match: MatchRecord, opponentKey: string): number | null {
  const others = (match.details?.last?.players ?? []).filter((player) => !player.isSelf);
  const matched = others.find(
    (player) => player.username?.trim().toLocaleLowerCase('zh-CN') === opponentKey,
  );
  const opponent = matched ?? (others.length === 1 ? others[0] : undefined);
  return opponent?.stars ?? null;
}

export function summarizeMatchStatistics(matches: MatchRecord[]): MatchStatistics {
  const mutableTurnGroups = turnGroupLabels.map(() => emptyCounts());
  const opponentGroups = new Map<string, MutableOpponent>();
  let unclassifiedTurns = 0;

  for (const match of matches) {
    const turns = match.turns;
    if (!Number.isFinite(turns) || turns < 0) unclassifiedTurns++;
    else if (turns < 100) addOutcome(mutableTurnGroups[0]!, match.outcome);
    else if (turns < 500) addOutcome(mutableTurnGroups[1]!, match.outcome);
    else addOutcome(mutableTurnGroups[2]!, match.outcome);

    const name = match.opponent.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase('zh-CN');
    const opponent = opponentGroups.get(key) ?? {
      ...emptyCounts(),
      name,
      games: 0,
      stars: null,
      latestCompletedAt: Number.NEGATIVE_INFINITY,
    };
    opponent.games++;
    addOutcome(opponent, match.outcome);
    if (match.outcome === 'won' || match.outcome === 'lost' || match.outcome === 'draw') {
      const completedAt = Date.parse(match.startedAt);
      if (Number.isFinite(completedAt) && completedAt > opponent.latestCompletedAt) {
        opponent.stars = opponentStars(match, key);
        opponent.latestCompletedAt = completedAt;
      }
    }
    opponentGroups.set(key, opponent);
  }

  const turnGroups = mutableTurnGroups.map((counts, index) => ({
    ...counts,
    label: turnGroupLabels[index]!,
    completed: completedCount(counts),
    winRate: winRate(counts),
  }));
  const opponents = [...opponentGroups.values()].map((counts) => ({
    name: counts.name,
    games: counts.games,
    stars: counts.stars,
    won: counts.won,
    lost: counts.lost,
    draw: counts.draw,
    interrupted: counts.interrupted,
    playing: counts.playing,
    completed: completedCount(counts),
    winRate: winRate(counts),
  }));
  const frequentOpponents = [...opponents]
    .sort((a, b) => b.games - a.games || nameOrder(a, b))
    .slice(0, OPPONENT_RANKING_LIMIT);
  const eligible = opponents.filter(
    (opponent) => opponent.completed >= MIN_OPPONENT_COMPLETED_MATCHES,
  );
  const highestWinRateOpponents = [...eligible]
    .sort((a, b) => b.winRate! - a.winRate! || b.completed - a.completed || nameOrder(a, b))
    .slice(0, OPPONENT_RANKING_LIMIT);
  const lowestWinRateOpponents = [...eligible]
    .sort((a, b) => a.winRate! - b.winRate! || b.completed - a.completed || nameOrder(a, b))
    .slice(0, OPPONENT_RANKING_LIMIT);

  return {
    turnGroups,
    unclassifiedTurns,
    opponents,
    frequentOpponents,
    highestWinRateOpponents,
    lowestWinRateOpponents,
    eligibleOpponentCount: eligible.length,
  };
}
