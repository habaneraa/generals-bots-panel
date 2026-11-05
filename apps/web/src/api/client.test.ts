import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig, type MatchRecord } from '../../../../packages/contracts/src/index';
import { api, ApiRequestError } from './client';

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('API 请求契约', () => {
  it('所有 Player 数据请求显式携带且编码身份，不依赖可变的 active', async () => {
    fetchMock.mockImplementation(async () => new Response('{}'));
    const signal = new AbortController().signal;
    const id = 'player /?&甲';
    await api.dashboard(signal, id);
    await api.matches({ server: 'bots' }, 1, signal, id);
    await api.match('match-id', signal, id);
    await api.starHistory({}, signal, id);
    await api.replay('bots', 'game', signal, id);
    await api.save(defaultConfig, id, signal);
    await api.start(defaultConfig, id, signal);
    await api.stop(id, signal);
    for (const [path, options] of fetchMock.mock.calls) {
      expect(new URL(String(path), 'http://localhost').searchParams.get('playerId')).toBe(id);
      expect(options?.signal).toBe(signal);
    }
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it('新增与切换 Player 使用独立接口和直接 userId 字符串', async () => {
    fetchMock.mockImplementation(async () => new Response('{}'));
    const signal = new AbortController().signal;
    const input = { server: 'bots', userId: 'direct-user-id' } as const;
    await api.addPlayer(input, signal);
    await api.selectPlayer('player-b', signal);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/players', {
      method: 'POST',
      credentials: 'same-origin',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/players/active', {
      method: 'PUT',
      credentials: 'same-origin',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'player-b' }),
    });
    expect('server' in defaultConfig).toBe(false);
    expect('userIdFile' in defaultConfig).toBe(false);
  });
  it('详情按目标路径编码，删除另携带当前 workspace 且不发送空 JSON body', async () => {
    fetchMock.mockImplementation(async () => new Response('{}'));
    const signal = new AbortController().signal;
    const target = 'target /?&甲';
    const workspace = 'workspace /?&乙';
    await api.playerDetails(target, signal);
    await api.deletePlayer(target, workspace, signal);
    const path = `/api/players/${encodeURIComponent(target)}`;
    expect(fetchMock).toHaveBeenNthCalledWith(1, path, { credentials: 'same-origin', signal });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${path}?${new URLSearchParams({ playerId: workspace })}`,
      {
        method: 'DELETE',
        credentials: 'same-origin',
        signal,
      },
    );
  });
  it('停止请求不携带空 JSON 请求体或 Content-Type', async () => {
    const dashboard = { status: 'stopped' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(dashboard)));

    await expect(api.stop('player-a')).resolves.toEqual(dashboard);
    expect(fetchMock).toHaveBeenCalledWith('/api/runs/stop?playerId=player-a', {
      method: 'POST',
      credentials: 'same-origin',
    });
  });

  it.each([
    ['save', '/api/config', 'PUT'],
    ['start', '/api/runs', 'POST'],
  ] as const)('%s 以 JSON 发送完整运行参数', async (action, path, method) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(defaultConfig)));

    await api[action](defaultConfig, 'player-a');
    expect(fetchMock).toHaveBeenCalledWith(`${path}?playerId=player-a`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(defaultConfig),
    });
  });

  it.each([
    ['{"message":"运行中不能修改参数"}', '运行中不能修改参数'],
    ['<html>Bad Gateway</html>', '请求失败（HTTP 502）'],
    ['', '请求失败（HTTP 502）'],
    ['{"message":null}', '请求失败（HTTP 502）'],
    ['null', '请求失败（HTTP 502）'],
  ])('错误响应 %j 保留可追溯信息', async (body, message) => {
    fetchMock.mockResolvedValue(new Response(body, { status: 502 }));

    await expect(api.dashboard(new AbortController().signal)).rejects.toThrow(message);
  });

  it.each([403, 404, 500])('HTTP %i 暴露明确状态而不依赖错误文案', async (status) => {
    fetchMock.mockResolvedValue(new Response('{"message":"相同错误文案"}', { status }));
    const error = await api
      .dashboard(new AbortController().signal, 'player-a')
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status, message: '相同错误文案' });
  });

  it('将取消信号传给 fetch，并原样传播取消错误', async () => {
    const controller = new AbortController();
    const aborted = new DOMException('请求已取消', 'AbortError');
    fetchMock.mockImplementation((_path, options) => {
      expect(options?.signal).toBe(controller.signal);
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(aborted), { once: true });
      });
    });

    const request = api.dashboard(controller.signal);
    controller.abort();
    await expect(request).rejects.toBe(aborted);
  });

  it('分页与完整历史使用相同的筛选编码，保留零值并忽略未定义值', async () => {
    fetchMock.mockImplementation(async () => new Response('{}'));
    const filters = { opponent: 'a b%_&', minTurns: 0, gameId: undefined };
    const signal = new AbortController().signal;

    await api.matches(filters, 3, signal, 'player-a');
    await api.starHistory(filters, signal, 'player-a');
    const urls = fetchMock.mock.calls.map(([path]) => new URL(String(path), 'http://localhost'));
    expect(urls[0]!.pathname).toBe('/api/matches');
    expect(urls[1]!.pathname).toBe('/api/matches/star-history');
    expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({
      page: '3',
      pageSize: '20',
      opponent: 'a b%_&',
      minTurns: '0',
      playerId: 'player-a',
    });
    expect(Object.fromEntries(urls[1]!.searchParams)).toEqual({
      opponent: 'a b%_&',
      minTurns: '0',
      playerId: 'player-a',
    });
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toEqual({ signal, credentials: 'same-origin' });
    }
  });

  it('完整统计可使用接口允许的 100 条分页大小', async () => {
    fetchMock.mockResolvedValue(new Response('{}'));
    const signal = new AbortController().signal;

    await api.matches({}, 2, signal, 'player-a', 100);

    const url = new URL(String(fetchMock.mock.calls[0]![0]), 'http://localhost');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('pageSize')).toBe('100');
    expect(url.searchParams.get('playerId')).toBe('player-a');
  });

  it('单局详情编码记录 ID 和 Player，并返回完整记录', async () => {
    const record: MatchRecord = {
      id: 'match/with?#甲',
      runId: 'run-id',
      mode: 'live',
      server: 'bots',
      gameId: 'game-id',
      opponent: 'opponent',
      startedAt: '2026-10-25T00:00:00.000Z',
      endedAt: null,
      outcome: null,
      turns: 12,
      replayUrl: null,
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(record)));
    const signal = new AbortController().signal;
    const playerId = 'player /?&乙';

    await expect(api.match(record.id, signal, playerId)).resolves.toEqual(record);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/matches/${encodeURIComponent(record.id)}?${new URLSearchParams({ playerId })}`,
      { signal, credentials: 'same-origin' },
    );
  });

  it('单局详情保留不存在记录的 404 状态', async () => {
    fetchMock.mockResolvedValue(new Response('{"message":"对局记录不存在"}', { status: 404 }));

    await expect(
      api.match('missing', new AbortController().signal, 'player-a'),
    ).rejects.toMatchObject({ status: 404, message: '对局记录不存在' });
  });

  it('录像标识按路径片段编码，避免特殊字符改变请求目标', async () => {
    fetchMock.mockResolvedValue(new Response('{}'));
    const signal = new AbortController().signal;

    await api.replay('bots', 'game/with?#空格', signal, 'player-a');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/replays/bots/game%2Fwith%3F%23%E7%A9%BA%E6%A0%BC?playerId=player-a',
      { signal, credentials: 'same-origin' },
    );
  });
});
