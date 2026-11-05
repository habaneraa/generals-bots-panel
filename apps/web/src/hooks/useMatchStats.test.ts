// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchPage, MatchRecord } from '../../../../packages/contracts/src/index';
import { api } from '../api/client';
import { PlayerScope } from './PlayerScope';
import { useMatchStats } from './useMatchStats';

function match(id: string): MatchRecord {
  return {
    id,
    runId: 'run-1',
    mode: 'live',
    server: 'generals',
    gameId: `game-${id}`,
    opponent: 'Opponent',
    startedAt: '2026-11-03T00:00:00.000Z',
    endedAt: null,
    outcome: 'won',
    turns: 100,
    replayUrl: null,
  };
}

function page(items: MatchRecord[], total = items.length, current = 1): MatchPage {
  return { items, total, page: current, pageSize: 100 };
}

function deferredPage() {
  let resolve!: (value: MatchPage) => void;
  const promise = new Promise<MatchPage>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

let root: Root;
let container: HTMLDivElement;
let result: ReturnType<typeof useMatchStats>;
let enabled: boolean;
let refreshKey: string;

function Harness() {
  result = useMatchStats(enabled, refreshKey);
  return null;
}

async function render(playerId = 'player-a') {
  await act(async () =>
    root.render(
      createElement(
        PlayerScope.Provider,
        { key: playerId, value: playerId },
        createElement(Harness),
      ),
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(api, 'matches').mockResolvedValue(page([]));
  enabled = true;
  refreshKey = 'initial';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('useMatchStats', () => {
  it('loads all match pages with the selected Player and a larger read-only page size', async () => {
    vi.mocked(api.matches)
      .mockResolvedValueOnce(
        page(
          Array.from({ length: 100 }, (_, index) => match(`match-${index}`)),
          101,
        ),
      )
      .mockResolvedValueOnce(page([match('match-100')], 101, 2));

    await render();

    expect(api.matches).toHaveBeenNthCalledWith(1, {}, 1, expect.any(AbortSignal), 'player-a', 100);
    expect(api.matches).toHaveBeenNthCalledWith(2, {}, 2, expect.any(AbortSignal), 'player-a', 100);
    expect(result.matches).toHaveLength(101);
    expect(result.matches?.at(-1)?.id).toBe('match-100');
    expect(result.loading).toBe(false);
  });

  it('does not request statistics while its tab is inactive', async () => {
    enabled = false;
    await render();
    expect(api.matches).not.toHaveBeenCalled();
    expect(result.loading).toBe(false);
  });

  it('aborts the previous Player read and hides its data after switching', async () => {
    const old = deferredPage();
    vi.mocked(api.matches).mockReturnValueOnce(old.promise);
    await render();
    const signal = vi.mocked(api.matches).mock.calls[0]![2];

    vi.mocked(api.matches).mockResolvedValueOnce(page([match('other-player')]));
    await render('player-b');

    expect(signal.aborted).toBe(true);
    expect(result.matches?.map(({ id }) => id)).toEqual(['other-player']);
    await act(async () => old.resolve(page([match('late')])));
    expect(result.matches?.map(({ id }) => id)).toEqual(['other-player']);
  });

  it('reloads when the live match summary changes', async () => {
    await render();
    expect(api.matches).toHaveBeenCalledTimes(1);
    refreshKey = 'new-match';
    await render();
    expect(api.matches).toHaveBeenCalledTimes(2);
  });
});
