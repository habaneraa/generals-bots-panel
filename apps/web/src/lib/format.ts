import type { MatchRecord, Outcome, RunPhase } from '../../../../packages/contracts/src/index';

export const phaseLabels: Record<RunPhase, string> = {
  idle: '等待启动',
  starting: '正在启动',
  queueing: '匹配中',
  playing: '对局进行中',
  cooldown: '冷却等待',
  stopping: '正在停止',
  stopped: '已停止',
  failed: '运行异常',
};

export const outcomeLabels: Record<Outcome, string> = {
  won: '胜利',
  lost: '失败',
  draw: '平局',
  interrupted: '已中断',
};

export function isRunning(phase: RunPhase): boolean {
  return ['starting', 'queueing', 'playing', 'cooldown', 'stopping'].includes(phase);
}

function parseDisplayDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTime(value: string | null, seconds = true): string {
  const date = parseDisplayDate(value);
  if (!date) return '—';
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hour12: false,
  });
}

export function formatDateTime(value: string | null): string {
  const date = parseDisplayDate(value);
  if (!date) return '—';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function localReplayHref(
  match: Pick<MatchRecord, 'localReplay' | 'server' | 'gameId'>,
  playerId?: string,
): string | undefined {
  return playerId && match.localReplay && match.gameId
    ? `/replay?${new URLSearchParams({ playerId })}#replay=${match.server}/${encodeURIComponent(match.gameId)}`
    : undefined;
}

export function replayHref(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
