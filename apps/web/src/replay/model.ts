import {
  parseReplay,
  type Replay,
  type ReplayAction,
} from '../../../../packages/contracts/src/replay';

export const playerColors = [
  '#dc4646',
  '#4664dc',
  '#3c9646',
  '#9646be',
  '#dc7828',
  '#289696',
  '#a02864',
  '#6e5028',
];
export const statusNames = {
  sent: '已提交',
  pass: 'Pass',
  stale: '过期未提交',
  rejected: '被拒绝',
  'dry-run': '仅决策',
} as const;

/** First recorded frame at or after the requested turn (turns can have gaps). */
export function frameForTurn(replay: Replay, turn: number): number {
  let low = 0;
  let high = replay.frames.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (replay.frames[middle]!.turn < turn) low = middle + 1;
    else high = middle;
  }
  return low;
}

export const HISTORY_STEPS = 10;

export function actionWindow(
  actions: readonly ReplayAction[],
  frame: number,
  history: boolean,
  player: number | null,
): ReplayAction[] {
  // Actions are chronological; binary-search the end rather than filtering an entire game per paint.
  let low = 0;
  let high = actions.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (actions[middle]!.frame <= frame) low = middle + 1;
    else high = middle;
  }
  const result: ReplayAction[] = [];
  const limit = history ? HISTORY_STEPS : 64;
  for (let index = low - 1; index >= 0 && result.length < limit; index--) {
    const action = actions[index]!;
    if (!history && action.frame < frame) break;
    if (player === null || action.player === player) result.push(action);
  }
  return result.reverse();
}

export function replayAddress(server: string, gameId: string): string {
  return `/api/replays/${encodeURIComponent(server)}/${encodeURIComponent(gameId)}`;
}

export function replaySource(hash: string): { server: 'generals' | 'bots'; gameId: string } | null {
  const match = /^#replay=(generals|bots)\/([^/]+)$/.exec(hash);
  if (!match) return null;
  try {
    return { server: match[1] as 'generals' | 'bots', gameId: decodeURIComponent(match[2]!) };
  } catch {
    return null;
  }
}

export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export async function readReplayFile(file: File, signal?: AbortSignal): Promise<Replay> {
  const limit = 64 * 1024 * 1024;
  if (file.size > limit) throw new Error('录像文件不能超过 64 MiB');
  signal?.throwIfAborted();
  const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  signal?.throwIfAborted();
  let stream = file.stream();
  if (magic[0] === 0x1f && magic[1] === 0x8b) {
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }
  const reader = stream.getReader();
  const cancelRead = () => {
    // 忽略异步取消拒绝；读取主错由循环与 finally 保留。
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener('abort', cancelRead, { once: true });
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    signal?.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('解压后的录像不能超过 64 MiB');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return parseReplay(JSON.parse(text));
  } finally {
    signal?.removeEventListener('abort', cancelRead);
    try {
      await reader.cancel();
    } catch {
      // 失败流的取消也可能拒绝，不能覆盖读取原错或阻止释放读取锁。
    } finally {
      reader.releaseLock();
    }
  }
}
