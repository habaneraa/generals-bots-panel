import type { RunConfig } from '../../../../packages/contracts/src/index.js';
import type { AgentAction, Observation } from '../game/types.js';

export function encodeStart(frame: Observation, protocol: RunConfig['protocol']): string {
  if (protocol === 'stdio') {
    return `${frame.player_id} ${frame.types.length} ${frame.types[0]?.length ?? 0}\n`;
  }
  return `${JSON.stringify({
    event: 'start',
    version: 2,
    player_id: frame.player_id,
    height: frame.types.length,
    width: frame.types[0]?.length ?? 0,
    mode: frame.mode,
    teams: frame.teams,
    players: frame.players,
    rules: frame.rules,
  })}\n`;
}

export function encodeObservation(frame: Observation, protocol: RunConfig['protocol']): string {
  if (protocol === 'jsonl') return `${JSON.stringify({ event: 'observation', ...frame })}\n`;
  return [
    `${frame.turn} ${frame.my_land} ${frame.my_army} ${frame.opp_land} ${frame.opp_army}`,
    ...[frame.types, frame.owners, frame.armies].flatMap((grid) =>
      grid.map((row) => row.join(' ')),
    ),
    '',
  ].join('\n');
}

export function encodeEnd(protocol: RunConfig['protocol']): string {
  return protocol === 'jsonl' ? '{"event":"end"}\n' : '\n';
}

export function decodeAction(line: string): AgentAction {
  const fields = line.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) {
    throw new Error('agent stdout 必须输出五个整数和可选的 value');
  }
  const integers = fields.slice(0, 5);
  if (!integers.every((field) => /^-?\d+$/.test(field))) {
    throw new Error('agent 动作前五项必须是整数，stdout 不得输出诊断信息');
  }
  const [pass, row, col, direction, split] = integers.map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const value = fields[5] === undefined ? null : Number(fields[5]);
  if (
    ![pass, row, col, direction, split].every(Number.isSafeInteger) ||
    (pass !== 0 && pass !== 1) ||
    (pass === 0 && (direction < 0 || direction > 3 || (split !== 0 && split !== 1))) ||
    (value !== null && !Number.isFinite(value))
  ) {
    throw new Error('agent 返回了非法动作或非有限 value');
  }
  return { pass: pass === 1, row, col, direction, split: split === 1, value };
}
