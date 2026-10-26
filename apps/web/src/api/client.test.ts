import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../../../packages/contracts/src/index';
import { api } from './client';

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('API 请求契约', () => {
  it('停止请求不携带空 JSON 请求体或 Content-Type', async () => {
    const dashboard = { status: 'stopped' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(dashboard)));

    await expect(api.stop()).resolves.toEqual(dashboard);
    expect(fetchMock).toHaveBeenCalledWith('/api/runs/stop', {
      method: 'POST',
      credentials: 'same-origin',
    });
  });

  it.each([
    ['save', '/api/config', 'PUT'],
    ['start', '/api/runs', 'POST'],
  ] as const)('%s 以 JSON 发送完整运行参数', async (action, path, method) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(defaultConfig)));

    await api[action](defaultConfig);
    expect(fetchMock).toHaveBeenCalledWith(path, {
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

    await api.matches(filters, 3, signal);
    await api.starHistory(filters, signal);
    const urls = fetchMock.mock.calls.map(([path]) => new URL(String(path), 'http://localhost'));
    expect(urls[0]!.pathname).toBe('/api/matches');
    expect(urls[1]!.pathname).toBe('/api/matches/star-history');
    expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({
      page: '3',
      pageSize: '20',
      opponent: 'a b%_&',
      minTurns: '0',
    });
    expect(Object.fromEntries(urls[1]!.searchParams)).toEqual({
      opponent: 'a b%_&',
      minTurns: '0',
    });
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toEqual({ signal, credentials: 'same-origin' });
    }
  });

  it('录像标识按路径片段编码，避免特殊字符改变请求目标', async () => {
    fetchMock.mockResolvedValue(new Response('{}'));
    const signal = new AbortController().signal;

    await api.replay('bots', 'game/with?#空格', signal);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/replays/bots/game%2Fwith%3F%23%E7%A9%BA%E6%A0%BC',
      { signal, credentials: 'same-origin' },
    );
  });
});
