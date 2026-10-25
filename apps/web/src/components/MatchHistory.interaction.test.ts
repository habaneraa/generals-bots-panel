// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchRecord } from '../../../../packages/contracts/src/index';
import { useMatchHistory } from '../hooks/useMatchHistory';
import { MatchHistory } from './MatchHistory';

vi.mock('../hooks/useMatchHistory', () => ({ useMatchHistory: vi.fn() }));
vi.mock('./StarHistoryChart', () => ({ StarHistoryChart: () => null }));

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

async function render() {
  await act(async () => root.render(createElement(MatchHistory, { refreshKey: 'refresh' })));
}

function button(label: string): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
    expect(dialog.textContent).toContain('12 → 13.5');
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
