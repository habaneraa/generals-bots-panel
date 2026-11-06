// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultConfig,
  type Dashboard,
  type MatchRecord,
} from '../../../../packages/contracts/src/index';
import { PlayerScope } from '../hooks/PlayerScope';
import { App } from '../App';
import { useDashboard } from '../hooks/useDashboard';
import { useMatchHistory } from '../hooks/useMatchHistory';
import { MatchHistory } from './MatchHistory';
import { StarHistoryChart } from './StarHistoryChart';

vi.mock('../hooks/useDashboard', () => ({ useDashboard: vi.fn() }));
vi.mock('../hooks/useMatchHistory', () => ({ useMatchHistory: vi.fn() }));
vi.mock('./StarHistoryChart', () => ({ StarHistoryChart: vi.fn(() => null) }));

function record(): MatchRecord {
  return {
    id: 'match-1',
    runId: 'run-1',
    mode: 'live',
    server: 'generals',
    gameId: 'game-1',
    opponent: 'opponent',
    startedAt: '2026-10-25T06:00:00Z',
    endedAt: null,
    outcome: null,
    turns: 1,
    replayUrl: 'https://generals.io/replays/game-1',
    rating: {
      username: 'self',
      before: 12,
      after: null,
      delta: null,
      source: null,
      capturedAt: null,
    },
  };
}

let root: Root;
let container: HTMLDivElement;
let history: ReturnType<typeof useMatchHistory>;

async function render(playerId = 'player-a') {
  await act(async () =>
    root.render(
      createElement(
        PlayerScope.Provider,
        { value: playerId },
        createElement(MatchHistory, { refreshKey: 'refresh', starHistoryRefreshKey: 'rating' }),
      ),
    ),
  );
}

function button(label: string): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
}

beforeEach(() => {
  vi.mocked(StarHistoryChart).mockClear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [record()] }) }),
  );
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
  history = {
    data: { items: [record()], total: 21, page: 1, pageSize: 20 },
    filters: {},
    page: 1,
    loading: false,
    error: null,
    applyFilters: vi.fn(),
    setPage: vi.fn(),
    retry: vi.fn(),
  };
  vi.mocked(useMatchHistory).mockImplementation(() => history);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('MatchHistory star history', () => {
  it('keeps the complete history across list pagination without fetching it again', async () => {
    const allItems = [record(), { ...record(), id: 'older-match', gameId: 'older-game' }];
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ items: allItems }),
    } as Response);
    await render();
    expect(vi.mocked(StarHistoryChart).mock.lastCall?.[0].matches).toEqual(allItems);
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => button('下一页').click());
    expect(history.setPage).toHaveBeenCalledWith(2);
    history = { ...history, page: 2, data: null, loading: true };
    await render();
    expect(vi.mocked(StarHistoryChart).mock.lastCall?.[0].matches).toEqual(allItems);
    history = {
      ...history,
      loading: false,
      data: { items: [{ ...record(), id: 'page-2' }], total: 21, page: 2, pageSize: 20 },
    };
    await render();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(StarHistoryChart).mock.lastCall?.[0].matches).toEqual(allItems);
  });

  it('uses the applied list filters for a new complete-history query', async () => {
    await render();
    history = { ...history, filters: { server: 'bots', outcome: 'won' } };
    await render();
    expect(fetch).toHaveBeenCalledTimes(2);
    const url = new URL(String(vi.mocked(fetch).mock.calls[1]![0]), 'http://localhost');
    expect(url.pathname).toBe('/api/matches/star-history');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      server: 'bots',
      outcome: 'won',
      playerId: 'player-a',
    });
  });
});

describe('Star chart match navigation', () => {
  function choose(match: MatchRecord) {
    const props = vi.mocked(StarHistoryChart).mock.lastCall![0];
    return act(async () => props.onOpenMatch!(match));
  }

  function deferredMatch() {
    let resolve!: (response: Response) => void;
    const promise = new Promise<Response>((done) => {
      resolve = done;
    });
    return {
      promise,
      resolve: (match: MatchRecord) => resolve(new Response(JSON.stringify(match))),
    };
  }

  it('opens an exact off-page match without changing pagination or filters', async () => {
    await render();
    const older = { ...record(), id: 'off-page', gameId: 'older-game', outcome: 'won' as const };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(older)));
    await choose(older);
    const url = new URL(String(vi.mocked(fetch).mock.lastCall![0]), 'http://localhost');
    expect(url.pathname).toBe('/api/matches/off-page');
    expect(url.searchParams.get('playerId')).toBe('player-a');
    expect(container.querySelector('dialog[open]')?.textContent).toContain('older-game');
    expect(history.setPage).not.toHaveBeenCalled();
    expect(history.applyFilters).not.toHaveBeenCalled();
    await act(async () => button('关闭对局详情').click());
    expect(document.body.style.overflow).toBe('');
  });

  it('cancels a previous selection and ignores its late result', async () => {
    await render();
    const first = deferredMatch();
    const second = deferredMatch();
    const a = { ...record(), id: 'a', gameId: 'game-a' };
    const b = { ...record(), id: 'b', gameId: 'game-b' };
    vi.mocked(fetch).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await choose(a);
    const firstSignal = vi.mocked(fetch).mock.lastCall![1]!.signal!;
    expect(container.textContent).toContain('正在打开对局');
    await choose(b);
    expect(firstSignal.aborted).toBe(true);
    await act(async () => second.resolve(b));
    expect(container.querySelector('dialog[open]')?.textContent).toContain('game-b');
    await act(async () => first.resolve(a));
    expect(container.querySelector('dialog[open]')?.textContent).toContain('game-b');
    expect(container.querySelector('dialog[open]')?.textContent).not.toContain('game-a');
  });

  it('allows cancelling loading and does not reopen when the response arrives', async () => {
    await render();
    const pending = deferredMatch();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    await choose(record());
    const signal = vi.mocked(fetch).mock.lastCall![1]!.signal!;
    const cancel = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '取消',
    )!;
    await act(async () => cancel.click());
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(record()));
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.textContent).not.toContain('正在打开对局');
  });

  it('aborts a match request when player scope changes', async () => {
    await render();
    const pending = deferredMatch();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    await choose(record());
    const signal = vi.mocked(fetch).mock.lastCall![1]!.signal!;
    await render('player-b');
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(record()));
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.textContent).not.toContain('正在打开对局');
  });

  it('shows a useful failure and retries the same match', async () => {
    await render();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: '对局记录不存在' }), { status: 404 }),
    );
    await choose(record());
    expect(container.textContent).toContain('对局读取失败：对局记录不存在');
    expect(container.querySelector('dialog')).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(record())));
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '重试',
    )!;
    await act(async () => retry.click());
    expect(container.querySelector('dialog[open]')?.textContent).toContain('game-1');
    expect(container.textContent).not.toContain('对局读取失败');
  });
});

describe('App star history refresh key', () => {
  it('ignores turns and details snapshots but refreshes for ratings and match identities', async () => {
    let dashboard: Dashboard = {
      player: { id: 'player-a', server: 'generals', userId: 'secret-a', nickname: 'Player A' },
      players: [{ id: 'player-a', server: 'generals', userId: 'secret-a', nickname: 'Player A' }],
      state: {
        run: null,
        phase: 'playing',
        phaseStartedAt: '2026-10-26T14:30:00.000Z',
        match: null,
        turn: 1,
        agentLatencyMs: null,
        completedGames: 0,
        nextGameAt: null,
        autoRestartAt: null,
      },
      config: defaultConfig,
      stats: { total: 1, won: 0, lost: 0, draw: 0, interrupted: 0, winRate: 0 },
      matches: [record()],
      logs: [],
      dataDir: 'data',
    };
    vi.mocked(useDashboard).mockImplementation(() => ({
      dashboard,
      player: dashboard.player,
      players: dashboard.players,
      playerPending: false,
      playerAction: null,
      selectPlayer: vi.fn(),
      addPlayer: vi.fn(),
      cancelAddPlayer: vi.fn(),
      deletePlayer: vi.fn(),
      connection: 'connected',
      loadError: null,
      actionError: null,
      pending: null,
      retry: vi.fn(),
      save: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }));
    const renderApp = () => act(async () => root.render(createElement(App)));
    await renderApp();
    expect(fetch).toHaveBeenCalledTimes(1);
    const listKey = vi.mocked(useMatchHistory).mock.lastCall?.[0];
    dashboard = {
      ...dashboard,
      matches: [
        {
          ...record(),
          turns: 2,
          details: {
            initial: null,
            last: null,
            durationMs: 500,
            winnerIndex: null,
            endReason: null,
            agent: {
              observations: 2,
              decisions: 2,
              submittedMoves: 1,
              passes: 1,
              skippedMoves: 0,
              staleMoves: 0,
              rejectedMoves: 0,
              skippedTurns: 0,
              retriedMoves: 0,
              splitMoves: 0,
              totalLatencyMs: 20,
              maxLatencyMs: 10,
            },
          },
        },
      ],
    };
    await renderApp();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useMatchHistory).mock.lastCall?.[0]).not.toBe(listKey);
    dashboard = {
      ...dashboard,
      matches: [{ ...dashboard.matches[0]!, rating: { ...record().rating!, after: 13, delta: 1 } }],
    };
    await renderApp();
    expect(fetch).toHaveBeenCalledTimes(2);
    dashboard = { ...dashboard, matches: [{ ...dashboard.matches[0]!, id: 'new-match' }] };
    await renderApp();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe('MatchHistory details updates', () => {
  it('shows the latest same-id record without reopening the dialog or moving focus', async () => {
    await render();
    await act(async () => button('打开对局 game-1 详情').click());
    const dialog = container.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('尚未记录结束');
    const replay = dialog.querySelector<HTMLAnchorElement>('a')!;
    replay.focus();
    const updated: MatchRecord = {
      ...record(),
      outcome: 'won',
      turns: 40,
      endedAt: '2026-10-25T06:05:00Z',
      rating: {
        ...record().rating!,
        after: 13.5,
        delta: 1.5,
        source: 'terminal',
        capturedAt: '2026-10-25T06:05:00Z',
      },
    };
    history = { ...history, data: { ...history.data!, items: [updated] } };
    await render();
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('胜利');
    expect(dialog.textContent).toContain('40');
    expect(dialog.textContent).toContain('+1.5');
    expect(dialog.textContent).toContain('12.0 → 13.5');
    expect(dialog.textContent).not.toContain('尚未记录结束');
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(replay);
  });

  it('keeps the selected record while another page loads and allows closing it', async () => {
    await render();
    await act(async () => button('打开对局 game-1 详情').click());
    history = { ...history, data: null, page: 2, loading: true };
    await render();
    expect(container.querySelector('dialog')?.open).toBe(true);
    history = {
      ...history,
      data: {
        items: [{ ...record(), id: 'match-2', gameId: 'game-2' }],
        total: 21,
        page: 2,
        pageSize: 20,
      },
      loading: false,
    };
    await render();
    expect(container.querySelector('dialog')?.textContent).toContain('game-1');
    await act(async () => button('关闭对局详情').click());
    expect(container.querySelector('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
});
