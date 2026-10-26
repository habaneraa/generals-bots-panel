// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Replay } from '../../../../packages/contracts/src/replay';
import { api } from '../api/client';
import { ReplayWorkspace } from './ReplayWorkspace';

vi.mock('./ReplayPlayer', () => ({
  ReplayPlayer: ({
    replay,
    active,
    sidebarContent,
  }: {
    replay: Replay;
    active: boolean;
    sidebarContent: ReactNode;
  }) =>
    createElement(
      'section',
      {
        'data-testid': 'replay-player',
        'data-game-id': replay.gameId,
        'data-active': String(active),
      },
      createElement('aside', { 'data-testid': 'replay-sidebar' }, sidebarContent),
    ),
}));

function sample(gameId = 'first-game', server: Replay['server'] = 'bots'): Replay {
  return {
    format: 'generals-replay',
    version: 1,
    server,
    gameId,
    startedAt: '2026-10-25T00:00:00Z',
    endedAt: null,
    outcome: null,
    winnerIndex: null,
    perspective: 0,
    width: 1,
    height: 1,
    tickMs: 500,
    keyframeInterval: 64,
    players: [
      { index: 0, username: 'self', team: 0 },
      { index: 1, username: 'enemy', team: 1 },
    ],
    frames: [
      {
        turn: 0,
        at: 0,
        keyframe: [4, 0, 1],
        scores: [
          { index: 0, army: 1, land: 1 },
          { index: 1, army: 0, land: 0 },
        ],
      },
    ],
    actions: [],
  };
}

function deferredReplay() {
  let resolve!: (replay: Replay) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Replay>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

let container: HTMLDivElement;
let root: Root;
const originalUrl = window.location.href;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(api, 'replay').mockResolvedValue(sample());
  window.history.replaceState(null, '', '/');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', originalUrl);
  vi.unstubAllGlobals();
});

async function render(active = true) {
  await act(async () => root.render(createElement(ReplayWorkspace, { active })));
}

function player() {
  return container.querySelector<HTMLElement>('[data-testid="replay-player"]')!;
}

function sidebar() {
  return container.querySelector<HTMLElement>('[data-testid="replay-sidebar"]')!;
}

async function submitReplacement(gameId: string) {
  const form = sidebar().querySelector('form')!;
  const input = form.querySelector<HTMLInputElement>('input:not([type="file"])')!;
  const select = form.querySelector('select')!;
  act(() => {
    select.value = 'generals';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, gameId);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}

function expectOnlySidebarForm() {
  expect(container.children).toHaveLength(1);
  expect(container.firstElementChild).toBe(player());
  expect(container.querySelectorAll('form')).toHaveLength(1);
  expect(container.querySelector('form')).toBe(sidebar().querySelector('form'));
}

describe('ReplayWorkspace layout', () => {
  it('shows the standalone open/import form before any replay is loaded', async () => {
    await render();
    expect(api.replay).not.toHaveBeenCalled();
    expect(player()).toBeNull();
    expect(container.querySelectorAll('form')).toHaveLength(1);
    const form = container.querySelector('form')!;
    expect(form.textContent).toContain('读取录像');
    expect(form.textContent).toContain('导入文件');
    expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(form.querySelector('[aria-label="选择录像文件"]')).not.toBeNull();
    expect(container.querySelector('.replay-empty')).not.toBeNull();
    expect(container.querySelector('.replay-source')).toBeNull();
  });

  it('moves the form and recording source/download into sidebarContent after a hash load', async () => {
    window.history.replaceState(null, '', '#replay=bots/first-game');
    await render();
    expect(api.replay).toHaveBeenCalledWith('bots', 'first-game', expect.any(AbortSignal));
    expectOnlySidebarForm();
    expect(container.querySelector('.replay-empty')).toBeNull();
    const details = sidebar().querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('读取 / 导入其他录像');
    expect(details.querySelector('form')).toBe(container.querySelector('form'));
    expect(details.textContent).toContain('读取录像');
    expect(details.textContent).toContain('导入文件');
    expect(details.querySelector<HTMLSelectElement>('select')!.value).toBe('bots');
    expect(details.querySelector<HTMLInputElement>('input:not([type="file"])')!.value).toBe(
      'first-game',
    );
    const source = sidebar().querySelector('.replay-source')!;
    expect(source.textContent).toContain('本机录像库');
    expect(source.textContent).toContain('未标记结束');
    const download = source.querySelector('a')!;
    expect(download.textContent).toContain('下载录像');
    expect(download.getAttribute('href')).toBe('/api/replays/bots/first-game/download');
    expect(download.hasAttribute('download')).toBe(true);
    expect(player().dataset.active).toBe('true');
    await render(false);
    expect(player().dataset.active).toBe('false');
    await render();
    expect(player().dataset.active).toBe('true');
  });

  it('replaces a replay through the sidebar form and keeps loading status inside the sidebar', async () => {
    window.history.replaceState(null, '', '#replay=bots/first-game');
    await render();
    const pending = deferredReplay();
    vi.mocked(api.replay).mockReturnValueOnce(pending.promise);
    await submitReplacement('  second-game  ');
    expect(api.replay).toHaveBeenLastCalledWith('generals', 'second-game', expect.any(AbortSignal));
    expectOnlySidebarForm();
    expect(player().dataset.gameId).toBe('first-game');
    expect(player().dataset.active).toBe('false');
    const status = sidebar().querySelector('[role="status"]')!;
    expect(status.textContent).toContain('正在读取并校验录像');
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(sidebar().querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(
      true,
    );
    expect(sidebar().querySelector<HTMLButtonElement>('button[type="button"]')!.disabled).toBe(
      true,
    );
    await act(async () => pending.resolve(sample('second-game', 'generals')));
    expectOnlySidebarForm();
    expect(player().dataset.gameId).toBe('second-game');
    expect(player().dataset.active).toBe('true');
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(sidebar().querySelector('a')!.getAttribute('href')).toBe(
      '/api/replays/generals/second-game/download',
    );
    expect(sidebar().querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(
      false,
    );
  });

  it('keeps replacement errors inside the sidebar without discarding the current replay', async () => {
    window.history.replaceState(null, '', '#replay=bots/first-game');
    await render();
    const pending = deferredReplay();
    vi.mocked(api.replay).mockReturnValueOnce(pending.promise);
    await submitReplacement('missing-game');
    await act(async () => pending.reject(new Error('录像不存在')));
    expectOnlySidebarForm();
    expect(player().dataset.gameId).toBe('first-game');
    expect(player().dataset.active).toBe('true');
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(sidebar().querySelector('[role="alert"]')!.textContent).toContain('录像不存在');
    expect(sidebar().querySelector('a')!.getAttribute('href')).toBe(
      '/api/replays/bots/first-game/download',
    );
    expect(sidebar().querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(
      false,
    );
  });
});
