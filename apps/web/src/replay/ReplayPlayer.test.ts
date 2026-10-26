// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Replay } from '../../../../packages/contracts/src/replay';
import { ReplayPlayer } from './ReplayPlayer';
import { actionWindow, elapsed, frameForTurn, replaySource } from './model';

function sample(): Replay {
  return {
    format: 'generals-replay',
    version: 1,
    server: 'bots',
    gameId: 'test-game',
    startedAt: '2026-10-25T00:00:00Z',
    endedAt: '2026-10-25T00:00:03Z',
    outcome: 'won',
    winnerIndex: 0,
    perspective: 0,
    width: 3,
    height: 2,
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
        keyframe: [4, 0, 1, 1, -1, 0, 0, -3, 0, 2, -2, 0, 3, -1, 40, 4, 1, 1],
        scores: [
          { index: 0, army: 1, land: 1 },
          { index: 1, army: 1, land: 1 },
        ],
      },
      ...[1, 2, 5].map((turn) => ({
        turn,
        at: turn * 500,
        delta: [0, 4, 0, turn + 1],
        scores: [
          { index: 0, army: turn + 1, land: 1 },
          { index: 1, army: turn + 1, land: 1 },
        ],
      })),
    ],
    actions: [
      { frame: 0, turn: 0, player: 0, from: 0, to: 1, split: false, status: 'sent' },
      { frame: 2, turn: 2, player: 0, from: 0, to: 1, split: true, status: 'dry-run' },
    ],
  };
}

describe('replay navigation helpers', () => {
  it('finds nearest recorded turn without assuming contiguous updates', () => {
    const replay = sample();
    expect(frameForTurn(replay, -10)).toBe(0);
    expect(frameForTurn(replay, 1)).toBe(1);
    expect(frameForTurn(replay, 3)).toBe(3);
    expect(frameForTurn(replay, 100)).toBe(3);
  });
  it('hides future operations and toggles faded history independently', () => {
    const { actions } = sample();
    expect(actionWindow(actions, 1, true, null)).toEqual([actions[0]]);
    expect(actionWindow(actions, 1, false, null)).toEqual([]);
    expect(actionWindow(actions, 2, false, 0)).toEqual([actions[1]]);
    expect(actionWindow(actions, 2, true, 1)).toEqual([]);
    expect(actionWindow(actions, 15, true, null)).toEqual(actions);
  });
  it('bounds operation drawing work even when called with unvalidated duplicate actions', () => {
    const action = sample().actions[0]!;
    expect(
      actionWindow(
        Array.from({ length: 1000 }, () => action),
        0,
        true,
        null,
      ),
    ).toHaveLength(10);
  });
  it('retains the latest ten operations across frame gaps and applies the player filter first', () => {
    const actions = Array.from({ length: 30 }, (_, index) => ({
      ...sample().actions[0]!,
      frame: index * 20,
      turn: index * 20,
      player: index % 2,
    }));
    expect(actionWindow(actions, 1000, true, null)).toEqual(actions.slice(-10));
    expect(actionWindow(actions, 1000, true, 0)).toEqual(
      actions.filter((action) => action.player === 0).slice(-10),
    );
    expect(actionWindow(actions, 200, true, null)).toEqual(actions.slice(1, 11));
    expect(actionWindow(actions, 201, false, null)).toEqual([]);
    expect(actionWindow(actions, 200, false, null)).toEqual([actions[10]]);
  });
  it('parses deep links safely and formats elapsed time', () => {
    expect(replaySource('#replay=bots/game_1')).toEqual({ server: 'bots', gameId: 'game_1' });
    expect(replaySource('#replay=other/game')).toBeNull();
    expect(replaySource('#replay=bots/%GG')).toBeNull();
    expect(elapsed(65000)).toBe('1:05');
  });
});

let container: HTMLDivElement;
let root: Root;
const noop = () => {};
beforeEach(() => {
  vi.useFakeTimers();
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    scale: noop,
    fillRect: noop,
    strokeRect: noop,
    drawImage: noop,
    strokeText: noop,
    fillText: noop,
    setLineDash: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
  } as unknown as CanvasRenderingContext2D);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function render(replay = sample(), active = true) {
  act(() => root.render(createElement(ReplayPlayer, { replay, active })));
}
function click(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).not.toBeNull();
  act(() => button!.click());
}
function frameIndex() {
  return Number(container.querySelector<HTMLInputElement>('[aria-label="录像时间轴"]')!.value);
}

describe('ReplayPlayer interaction', () => {
  it('defaults to 32px tiles and restores that size after manual zooming', () => {
    render();
    const canvas = container.querySelector('canvas')!;
    expect(canvas.style.width).toBe('96px');
    expect(canvas.style.height).toBe('64px');
    click('缩小地图');
    expect(canvas.style.width).toBe('72px');
    click('放大地图');
    click('放大地图');
    expect(canvas.style.width).toBe('120px');
    const fit = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '适应窗口',
    )!;
    act(() => fit.click());
    expect(canvas.style.width).toBe('96px');
    expect(canvas.style.height).toBe('64px');
  });
  it('still fits the board into containers narrower than the default tile size allows', () => {
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    render();
    act(() =>
      callbacks[0]!(
        [{ contentRect: { width: 60, height: 200 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      ),
    );
    const canvas = container.querySelector('canvas')!;
    expect(canvas.style.width).toBe('60px');
    expect(canvas.style.height).toBe('40px');
  });
  it('fits both viewport dimensions and expands again when more space is available', () => {
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    render();
    const resize = (width: number, height: number) =>
      act(() =>
        callbacks[0]!(
          [{ contentRect: { width, height } } as ResizeObserverEntry],
          {} as ResizeObserver,
        ),
      );
    const canvas = container.querySelector('canvas')!;
    resize(600, 100);
    expect(canvas.style.width).toBe('150px');
    expect(canvas.style.height).toBe('100px');
    resize(300, 400);
    expect(canvas.style.width).toBe('300px');
    expect(canvas.style.height).toBe('200px');
    click('放大地图');
    expect(canvas.style.width).toBe('375px');
    const fit = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '适应窗口',
    )!;
    act(() => fit.click());
    expect(canvas.style.width).toBe('300px');
  });
  it('floats a live score table over the board and keeps game details in the sidebar', () => {
    render();
    const stage = container.querySelector('.replay-stage')!;
    const sidebar = container.querySelector('.replay-sidebar')!;
    const scores = stage.querySelector('table[aria-label="玩家统计 · 当前帧"]')!;
    expect([...scores.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual([
      '玩家',
      '兵力',
      '领地',
    ]);
    expect(scores.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(scores.querySelector('tbody tr th')?.textContent).toContain('self己方');
    expect(scores.querySelector('tbody td')?.textContent).toBe('1');
    expect(sidebar.querySelector('table')).toBeNull();
    expect(sidebar.textContent).toContain('test-game');
    expect(sidebar.querySelector('[aria-label="跳转回合"]')).not.toBeNull();
    expect(sidebar.querySelector('.replay-footer')).toBeNull();
    expect(sidebar.querySelector('.replay-explainer')).toBeNull();
    expect(sidebar.textContent).not.toContain('敌方操作不可得');
    expect(container.querySelector<HTMLDialogElement>('.replay-help')!.open).toBe(false);
    const controls = container.querySelector('.replay-controls')!;
    expect(controls.querySelector('[aria-label="播放录像"]')).not.toBeNull();
    expect(controls.querySelector('[aria-label="录像时间轴"]')).not.toBeNull();
    expect(controls.querySelector('[aria-label="播放速度"]')).not.toBeNull();
    click('前进一帧');
    expect(scores.querySelector('tbody td')?.textContent).toBe('2');
  });
  it('toggles only scoreboard IDs by click or keyboard while keeping live scores and markers', () => {
    render();
    const scoreboard = container.querySelector<HTMLElement>('.replay-scoreboard')!;
    const headers = () =>
      [...scoreboard.querySelectorAll('thead th')].map((cell) => cell.textContent);
    const colors = () =>
      [...scoreboard.querySelectorAll<HTMLElement>('.replay-player-dot')].map(
        (dot) => dot.style.background,
      );
    const initialColors = colors();
    const initialScores = [...scoreboard.querySelectorAll('td')].map((cell) => cell.textContent);
    expect(scoreboard.querySelectorAll('[title="self"], [title="enemy"]')).toHaveLength(2);
    const toggle = scoreboard.querySelector<HTMLButtonElement>('.replay-scoreboard-toggle')!;
    expect(toggle.tagName).toBe('BUTTON');
    expect(scoreboard.querySelector('table')!.closest('button')).toBeNull();
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('显示玩家 ID');
    expect(scoreboard.querySelector('.truncate')).toBeNull();
    expect(scoreboard.querySelector('.replay-self')?.textContent).toBe('己方');
    expect(colors()).toEqual(initialColors);
    expect(headers()).toEqual(['玩家', '兵力', '领地']);
    expect([...scoreboard.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(
      initialScores,
    );
    expect(container.querySelector('.replay-options select')?.textContent).toContain('self');
    click('前进一帧');
    expect(scoreboard.querySelector('td')?.textContent).toBe('2');
    expect(scoreboard.querySelector('.truncate')).toBeNull();
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(scoreboard.querySelectorAll('[title="self"], [title="enemy"]')).toHaveLength(2);
    for (const key of [' ', 'Enter']) {
      act(() => toggle.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
    }
    act(() => vi.advanceTimersByTime(1000));
    expect(frameIndex()).toBe(1);
    expect(container.querySelector('[aria-label="暂停录像"]')).toBeNull();
  });
  it('shows only the latest ten actions in the history list', () => {
    const replay = sample();
    replay.actions = Array.from({ length: 14 }, () => ({ ...replay.actions[1]! }));
    render(replay);
    click('跳到末帧');
    expect(container.querySelectorAll('.replay-action')).toHaveLength(10);
    expect(container.querySelector('.replay-options')?.textContent).toContain('10 步');
  });
  it('steps both ways, clamps at boundaries, and jumps to endpoints', () => {
    render();
    expect(frameIndex()).toBe(0);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="后退一帧"]')!.disabled).toBe(
      true,
    );
    click('前进一帧');
    expect(frameIndex()).toBe(1);
    click('后退一帧');
    expect(frameIndex()).toBe(0);
    click('跳到末帧');
    expect(frameIndex()).toBe(3);
    click('跳到开局');
    expect(frameIndex()).toBe(0);
  });
  it('respects speed, recorded timing, pause and end-of-replay', () => {
    render();
    const speed = container.querySelector<HTMLSelectElement>('[aria-label="播放速度"]')!;
    act(() => {
      speed.value = '2';
      speed.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click('播放录像');
    act(() => vi.advanceTimersByTime(249));
    expect(frameIndex()).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(frameIndex()).toBe(1);
    click('暂停录像');
    act(() => vi.advanceTimersByTime(1000));
    expect(frameIndex()).toBe(1);
    click('跳到末帧');
    click('重新播放');
    expect(frameIndex()).toBe(0);
    click('跳到末帧');
    act(() => vi.advanceTimersByTime(10000));
    expect(frameIndex()).toBe(3);
  });
  it('resets its playback clock when replaying after the automatic end', () => {
    render();
    click('播放录像');
    act(() => vi.advanceTimersByTime(500));
    act(() => vi.advanceTimersByTime(500));
    act(() => vi.advanceTimersByTime(1500));
    expect(frameIndex()).toBe(3);
    click('重新播放');
    expect(frameIndex()).toBe(0);
    act(() => vi.advanceTimersByTime(500));
    expect(frameIndex()).toBe(1);
  });
  it('does not add a synthetic tick for updates sharing a timestamp', () => {
    const replay = sample();
    replay.frames[1]!.at = 0;
    render(replay);
    click('播放录像');
    act(() => vi.advanceTimersByTime(0));
    expect(frameIndex()).toBe(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(frameIndex()).toBe(2);
  });
  it('supports keyboard navigation and ignores editable controls', () => {
    render();
    const section = container.querySelector('section')!;
    act(() =>
      section.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    );
    expect(frameIndex()).toBe(1);
    const input = container.querySelector('[aria-label="跳转回合"]')!;
    act(() =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    );
    expect(frameIndex()).toBe(1);
    act(() => section.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(frameIndex()).toBe(3);
    act(() => section.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(frameIndex()).toBe(0);
  });
  it('turns off arrows/history and seeks from operation history', () => {
    render();
    click('跳到末帧');
    const action = container.querySelector<HTMLButtonElement>('.replay-action')!;
    act(() => action.click());
    expect(frameIndex()).toBe(2);
    const checks = container.querySelectorAll<HTMLInputElement>('.replay-options input');
    act(() => checks[1]!.click());
    expect(checks[1]!.checked).toBe(false);
    act(() => checks[0]!.click());
    expect(checks[0]!.checked).toBe(false);
    expect(checks[1]!.disabled).toBe(true);
    expect(container.textContent).toContain('敌方操作不可得');
  });
  it('shows help only in a dismissible dialog without triggering playback shortcuts', () => {
    render();
    const dialog = container.querySelector<HTMLDialogElement>('.replay-help')!;
    expect(dialog.open).toBe(false);
    click('播放帮助');
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('敌方操作不可得');
    expect(dialog.textContent).toContain('文件只在浏览器内解析，不上传');
    act(() => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(frameIndex()).toBe(0);
    click('关闭播放帮助');
    expect(dialog.open).toBe(false);
    click('播放帮助');
    act(() => dialog.click());
    expect(dialog.open).toBe(false);
  });
  it('clearly labels recordings that reached the capture limit', () => {
    render({ ...sample(), truncated: true });
    expect(container.querySelector('[role="status"]')?.textContent).toContain('录像不完整');
    expect(container.textContent).toContain('最后一帧不是终局');
  });
  it('does not advance while its workspace tab is hidden', () => {
    const replay = sample();
    render(replay);
    click('播放录像');
    render(replay, false);
    act(() => vi.advanceTimersByTime(5000));
    expect(frameIndex()).toBe(0);
  });
});
