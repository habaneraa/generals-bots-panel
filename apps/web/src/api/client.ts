import type { Replay } from '../../../../packages/contracts/src/replay';
import type {
  Dashboard,
  MatchFilters,
  MatchPage,
  RunConfig,
} from '../../../../packages/contracts/src/index';

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
      // A proxy or disconnected server may return a non-JSON error page.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function mutation<T>(path: string, method: 'POST' | 'PUT', config?: RunConfig): Promise<T> {
  // 无请求体时不能带 JSON content-type，否则 Fastify 会按空 body 拒绝。
  if (!config) return request<T>(path, { method });
  return request<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

export const api = {
  dashboard: (signal: AbortSignal): Promise<Dashboard> => request('/api/dashboard', { signal }),
  replay: (server: string, gameId: string, signal: AbortSignal): Promise<Replay> =>
    request(`/api/replays/${encodeURIComponent(server)}/${encodeURIComponent(gameId)}`, { signal }),
  matches: (filters: MatchFilters, page: number, signal: AbortSignal): Promise<MatchPage> => {
    const query = new URLSearchParams({ page: String(page), pageSize: '20' });
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) query.set(key, String(value));
    }
    return request(`/api/matches?${query}`, { signal });
  },
  save: (config: RunConfig): Promise<RunConfig> => mutation('/api/config', 'PUT', config),
  start: (config: RunConfig): Promise<Dashboard> => mutation('/api/runs', 'POST', config),
  stop: (): Promise<Dashboard> => mutation('/api/runs/stop', 'POST'),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请求未能完成，请稍后重试。';
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
