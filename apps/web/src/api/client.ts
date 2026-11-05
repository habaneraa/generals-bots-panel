import type { Replay } from '../../../../packages/contracts/src/replay';
import type {
  Dashboard,
  MatchFilters,
  MatchPage,
  MatchRecord,
  LogPage,
  LogPageCursor,
  PlayerDetails,
  PlayerInput,
  RunConfig,
  StarHistoryResponse,
} from '../../../../packages/contracts/src/index';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, credentials: 'same-origin' });
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const error: unknown = await response.json();
      if (typeof error === 'object' && error !== null && 'message' in error) {
        if (typeof error.message === 'string') message = error.message;
      }
    } catch {
      // 代理或断开的服务可能返回 HTML，保留 HTTP 状态才能继续定位故障。
    }
    throw new ApiRequestError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export function playerPath(path: string, playerId: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}${new URLSearchParams({ playerId })}`;
}

async function mutation<T>(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  // 无请求体时不能带 JSON content-type，否则 Fastify 会按空 body 拒绝。
  return request<T>(path, {
    method,
    ...(signal ? { signal } : {}),
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

export const api = {
  dashboard: (signal: AbortSignal, playerId?: string): Promise<Dashboard> =>
    request(playerId !== undefined ? playerPath('/api/dashboard', playerId) : '/api/dashboard', {
      signal,
    }),
  logs: (
    runId: string,
    cursor: LogPageCursor,
    signal: AbortSignal,
    playerId: string,
  ): Promise<LogPage> => {
    const query = new URLSearchParams();
    if (cursor.beforeId !== undefined) query.set('beforeId', String(cursor.beforeId));
    if (cursor.afterId !== undefined) query.set('afterId', String(cursor.afterId));
    return request(playerPath(`/api/runs/${encodeURIComponent(runId)}/logs?${query}`, playerId), {
      signal,
    });
  },
  addPlayer: (input: PlayerInput, signal: AbortSignal): Promise<Dashboard> =>
    mutation('/api/players', 'POST', input, signal),
  selectPlayer: (playerId: string, signal: AbortSignal): Promise<Dashboard> =>
    mutation('/api/players/active', 'PUT', { playerId }, signal),
  playerDetails: (id: string, signal: AbortSignal): Promise<PlayerDetails> =>
    request(`/api/players/${encodeURIComponent(id)}`, { signal }),
  deletePlayer: (id: string, playerId: string, signal: AbortSignal): Promise<Dashboard> =>
    mutation(
      playerPath(`/api/players/${encodeURIComponent(id)}`, playerId),
      'DELETE',
      undefined,
      signal,
    ),
  replay: (
    server: string,
    gameId: string,
    signal: AbortSignal,
    playerId: string,
  ): Promise<Replay> =>
    request(
      playerPath(
        `/api/replays/${encodeURIComponent(server)}/${encodeURIComponent(gameId)}`,
        playerId,
      ),
      { signal },
    ),
  matches: (
    filters: MatchFilters,
    page: number,
    signal: AbortSignal,
    playerId: string,
  ): Promise<MatchPage> => {
    const query = new URLSearchParams({ page: String(page), pageSize: '20' });
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) query.set(key, String(value));
    }
    return request(playerPath(`/api/matches?${query}`, playerId), { signal });
  },
  match: (id: string, signal: AbortSignal, playerId: string): Promise<MatchRecord> =>
    request(playerPath(`/api/matches/${encodeURIComponent(id)}`, playerId), { signal }),
  starHistory: (
    filters: MatchFilters,
    signal: AbortSignal,
    playerId: string,
  ): Promise<StarHistoryResponse> => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) query.set(key, String(value));
    }
    return request(playerPath(`/api/matches/star-history?${query}`, playerId), { signal });
  },
  save: (config: RunConfig, playerId: string, signal?: AbortSignal): Promise<RunConfig> =>
    mutation(playerPath('/api/config', playerId), 'PUT', config, signal),
  start: (config: RunConfig, playerId: string, signal?: AbortSignal): Promise<Dashboard> =>
    mutation(playerPath('/api/runs', playerId), 'POST', config, signal),
  stop: (playerId: string, signal?: AbortSignal): Promise<Dashboard> =>
    mutation(playerPath('/api/runs/stop', playerId), 'POST', undefined, signal),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请求未能完成，请稍后重试。';
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
