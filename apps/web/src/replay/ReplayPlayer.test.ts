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
    expect(actionWindow(actions, 15, true, null)).toEqual([]);
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
    ).toHaveLength(64);
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
