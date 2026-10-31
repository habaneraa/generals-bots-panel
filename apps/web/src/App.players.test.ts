// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultConfig,
  type Dashboard,
  type MatchRecord,
  type Player,
} from '../../../packages/contracts/src/index';
import { api } from './api/client';
import { App } from './App';
import { useDashboard } from './hooks/useDashboard';

vi.mock('./hooks/useDashboard', () => ({ useDashboard: vi.fn() }));
vi.mock('./components/StarHistoryChart', () => ({ StarHistoryChart: () => null }));

const players: Player[] = [
  { id: 'player-a', server: 'generals', userId: 'private-a', nickname: '主账号' },
  { id: 'player-b', server: 'bots', userId: 'private-b', nickname: '练习账号' },
];
const match: MatchRecord = {
  id: 'match-a',
  runId: 'run-a',
  server: 'generals',
  mode: 'live',
  gameId: 'game-a',
  opponent: 'opponent',
  startedAt: '2026-10-25T00:00:00Z',
  endedAt: null,
  outcome: null,
  turns: 10,
  localReplay: true,
  replayUrl: null,
};
function snapshot(player = players[0]!): Dashboard {
  return {
    player,
    players,
    config: defaultConfig,
    state: {
      run: {
        id: `run-${player.id}`,
        phase: 'stopped',
        startedAt: '2026-10-25T00:00:00Z',
        endedAt: null,
        error: null,
        config: defaultConfig,
      },
      phase: 'stopped',
      phaseStartedAt: '2026-10-25T00:00:00Z',
      match: null,
      turn: 0,
      agentLatencyMs: null,
      completedGames: 0,
      nextGameAt: null,
    },
    stats: { total: 0, won: 0, lost: 0, draw: 0, interrupted: 0, winRate: 0 },
    matches: [],
    logs: [],
    dataDir: 'data/players/local',
  };
}
let root: Root;
let container: HTMLDivElement;
let model: ReturnType<typeof useDashboard>;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
async function render() {
  await act(async () => root.render(createElement(App)));
}
function button(label: string) {
  const result = [...container.querySelectorAll('button')].find(
    (item) => item.getAttribute('aria-label') === label || item.textContent?.includes(label),
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
function input(selector: string) {
  const result = container.querySelector<HTMLInputElement>(selector);
  if (!result) throw new Error(`Missing input: ${selector}`);
  return result;
}
function setInput(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/');
  fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async (path) =>
        new Response(
          JSON.stringify(
            String(path).includes('star-history')
              ? { items: [] }
              : { items: [match], total: 1, page: 1, pageSize: 20 },
          ),
        ),
    );
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = false;
  });
  const dashboard = snapshot();
  model = {
    dashboard,
    player: dashboard.player,
    players,
    connection: 'connected',
    loadError: null,
    actionError: null,
    pending: null,
    playerPending: false,
    playerAction: null,
    retry: vi.fn(),
    save: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    selectPlayer: vi.fn(),
    addPlayer: vi.fn(),
    cancelAddPlayer: vi.fn(),
    deletePlayer: vi.fn(),
  };
  vi.mocked(useDashboard).mockImplementation(() => model);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('Player workspaces', () => {
  it('guides an empty registry without rendering start controls or issuing unscoped data requests', async () => {
    model = {
      ...model,
      dashboard: { ...snapshot(), player: null, players: [] },
      player: null,
      players: [],
    };
    await render();
    expect(container.textContent).toContain('欢迎，先添加一个 Player');
    expect(container.querySelector('#run-config')).toBeNull();
    expect(container.querySelector('button[value="start"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => button('添加第一个 Player').click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('resets drafts, filters, modal, replay and log state even when Players share the same config', async () => {
    await render();
    expect(container.querySelector('#run-config #server')).toBeNull();
    expect(container.querySelector('#userIdFile')).toBeNull();
    const oldSignals = fetchMock.mock.calls.map(([, options]) => options!.signal!);
    await act(async () => {
      setInput(input('#command'), 'unsaved-agent-a');
      setInput(input('#history-opponent'), 'old-filter');
      setInput(input('#panel-replay input:not([type="file"])'), 'old-replay');
      const level = container.querySelector<HTMLSelectElement>('[aria-label="日志级别筛选"]')!;
      level.value = 'error';
      level.dispatchEvent(new Event('change', { bubbles: true }));
      button('打开对局 game-a 详情').click();
    });
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(input('#command').value).toBe('unsaved-agent-a');
    const next = snapshot(players[1]);
    model = { ...model, dashboard: next, player: next.player };
    await render();
    expect(oldSignals.every((signal) => signal.aborted)).toBe(true);
    expect(input('#command').value).toBe(defaultConfig.command);
    expect(input('#history-opponent').value).toBe('');
    expect(input('#panel-replay input:not([type="file"])').value).toBe('');
    expect(container.querySelector<HTMLSelectElement>('[aria-label="日志级别筛选"]')!.value).toBe(
      'all',
    );
    expect(container.querySelector('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    const lastUrls = fetchMock.mock.calls
      .slice(-2)
      .map(([url]) => new URL(String(url), 'http://localhost'));
    expect(lastUrls.every((url) => url.searchParams.get('playerId') === 'player-b')).toBe(true);
  });

  it('scopes history replay links, log downloads and the switcher to the selected Player', async () => {
    await render();
    const replay = container.querySelector<HTMLAnchorElement>('a[href^="/replay"]')!;
    expect(replay.getAttribute('href')).toBe('/replay?playerId=player-a#replay=generals/game-a');
    const logs = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="下载本轮完整 JSONL 日志"]',
    )!;
    expect(new URL(logs.href).searchParams.get('playerId')).toBe('player-a');
    await act(async () => button('切换 Player').click());
    expect(container.querySelector('[role="dialog"]')?.textContent).not.toContain('private-');
    vi.mocked(model.selectPlayer).mockResolvedValueOnce(true);
    await act(async () => button('切换到 练习账号（bots）').click());
    expect(model.selectPlayer).toHaveBeenCalledWith('player-b');
  });

  it('keeps current draft, filters and page when deleting a different Player', async () => {
    await render();
    await act(async () => {
      setInput(input('#command'), 'keep-unsaved-agent');
      setInput(input('#history-opponent'), 'keep-filter');
      button('对局记录').click();
      button('切换 Player').click();
    });
    vi.spyOn(api, 'playerDetails').mockResolvedValueOnce({
      player: players[1]!,
      dataDir: 'data/players/player-b',
      phase: 'stopped',
      active: false,
      runs: 0,
      matches: 0,
      stats: snapshot().stats,
      logs: 0,
      replays: 0,
      lastRunAt: null,
    });
    vi.mocked(model.deletePlayer).mockImplementationOnce(async (id) => {
      const remaining = model.players.filter((item) => item.id !== id);
      model = {
        ...model,
        players: remaining,
        dashboard: { ...model.dashboard!, players: remaining },
      };
      return true;
    });
    await act(async () => button('删除 练习账号（bots）').click());
    expect(container.querySelector('dialog')?.textContent).toContain('从未运行');
    await act(async () => button('永久删除本地数据').click());
    await render();
    expect(input('#command').value).toBe('keep-unsaved-agent');
    expect(input('#history-opponent').value).toBe('keep-filter');
    expect(container.querySelector<HTMLElement>('#panel-history')?.hidden).toBe(false);
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.textContent).not.toContain('练习账号');
  });

  it('uses the standalone replay URL Player even when another default could be active', async () => {
    window.history.replaceState(null, '', '/replay?playerId=player-b#replay=bots/game-b');
    vi.spyOn(api, 'replay').mockRejectedValueOnce(new Error('录像不存在'));
    await render();
    expect(api.replay).toHaveBeenCalledWith('bots', 'game-b', expect.any(AbortSignal), 'player-b');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/?playerId=player-b');
    expect(useDashboard).not.toHaveBeenCalled();
  });

  it('never requests the default Player library from an unscoped standalone replay URL', async () => {
    window.history.replaceState(null, '', '/replay#replay=bots/game-b');
    const replay = vi.spyOn(api, 'replay');
    await render();
    expect(replay).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(
      true,
    );
    expect(container.textContent).toContain('请从 Player 工作区打开录像');
  });
});
