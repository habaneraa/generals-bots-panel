// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { Replay, ReplayAction } from '../../../../packages/contracts/src/replay';
import { ReplayBoard } from './ReplayBoard';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('centers light army counts over full-opacity icons and keeps shadows off other drawing', async () => {
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
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 45;
      onload?: () => void;
      set src(_url: string) {
        this.onload?.();
      }
    },
  );
  const text: Array<{ value: string; x: number; y: number; color: unknown; shadow: unknown }> = [];
  const icons: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    alpha: unknown;
    shadow: unknown;
  }> = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    shadowColor: 'transparent',
    scale: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage(_image: unknown, x: number, y: number, width: number, height: number) {
      icons.push({ x, y, width, height, alpha: this.globalAlpha, shadow: this.shadowColor });
    },
    strokeText: vi.fn(),
    fillText(value: string, x: number, y: number) {
      text.push({ value, x, y, color: this.fillStyle, shadow: this.shadowColor });
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  const cells = [1, 0, 2, 3, -1, 44, 3, 0, 41, 4, 1, 11, 0, -3, 99, 5, -3, 99];
  const replay = {
    width: 6,
    height: 1,
    frames: [{ turn: 0, at: 0, keyframe: cells, scores: [] }],
  } as unknown as Replay;
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(ReplayBoard, { replay, cells, frame: 0, actions: [], zoom: 1 }));
    });
    expect(text.slice(-4)).toEqual([
      { value: '2', x: 20, y: 20, color: '#fff', shadow: '#000' },
      { value: '44', x: 60, y: 20, color: '#fff', shadow: '#000' },
      { value: '41', x: 100, y: 20, color: '#fff', shadow: '#000' },
      { value: '11', x: 140, y: 20, color: '#fff', shadow: '#000' },
    ]);
    expect(ctx.strokeText).not.toHaveBeenCalled();
    expect(icons.slice(0, 3)).toEqual([
      { x: 42, y: 2, width: 36, height: 36, alpha: 1, shadow: 'transparent' },
      { x: 82, y: 2, width: 36, height: 36, alpha: 1, shadow: 'transparent' },
      { x: 122, y: 2, width: 36, height: 36, alpha: 1, shadow: 'transparent' },
    ]);
    expect(ctx.shadowColor).toBe('transparent');
  } finally {
    act(() => root.unmount());
  }
});

it('fades historical arrows by operation order, preserves dashes, and resets drawing alpha', async () => {
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
  vi.stubGlobal(
    'Image',
    class {
      set src(_url: string) {}
    },
  );
  const strokes: Array<{ alpha: number; dash: number[] }> = [];
  const ctx = {
    globalAlpha: 1,
    dash: [] as number[],
    scale: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    strokeText: vi.fn(),
    fillText: vi.fn(),
    setLineDash(dash: number[]) {
      this.dash = [...dash];
    },
    stroke() {
      strokes.push({ alpha: this.globalAlpha, dash: [...this.dash] });
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  const cells = [1, 0, 0, 1, 0, 0];
  const actionFrames = [0, 1, 2, 20, 21, 22, 23, 60, 61, 90, 98, 100];
  const actions: ReplayAction[] = actionFrames.map((frame, position) => ({
    frame,
    turn: frame,
    player: 0,
    from: 0,
    to: 1,
    split: position === 1,
    status: position === 2 ? 'rejected' : 'sent',
  }));
  const replay = {
    width: 2,
    height: 1,
    frames: Array.from({ length: 102 }, (_, turn) => ({ turn, at: turn, scores: [] })),
  } as unknown as Replay;
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(ReplayBoard, { replay, cells, frame: 100, actions, zoom: 1 }));
    });
    expect(strokes).toHaveLength(actions.length * 2);
    const alphas = actions.map((_, position) => strokes[position * 2]!.alpha);
    expect(alphas.slice(0, 2)).toEqual([0.08, 0.08]);
    for (let position = 0; position < actions.length; position++) {
      const expected =
        position === actions.length - 1
          ? 1
          : Math.max(0.08, (0.4 * (position + 1)) / actions.length);
      expect(strokes[position * 2]!.alpha).toBeCloseTo(expected);
      expect(strokes[position * 2 + 1]!.alpha).toBeCloseTo(expected);
      expect(strokes[position * 2]!.dash).toEqual(position === 1 || position === 2 ? [4, 3] : []);
      expect(strokes[position * 2 + 1]!.dash).toEqual([]);
    }
    for (let position = 1; position < actions.length - 1; position++) {
      expect(alphas[position]).toBeGreaterThanOrEqual(alphas[position - 1]!);
      expect(alphas[position]).toBeLessThanOrEqual(0.4);
      if (position > 1) expect(alphas[position]).toBeGreaterThan(alphas[position - 1]!);
    }
    expect(alphas.at(-1)).toBe(1);
    expect(ctx.globalAlpha).toBe(1);

    strokes.length = 0;
    await act(async () => {
      root.render(createElement(ReplayBoard, { replay, cells, frame: 101, actions, zoom: 1 }));
    });
    expect(strokes).toHaveLength(actions.length * 2);
    expect(strokes.at(-1)!.alpha).toBeCloseTo(0.4);
    expect(ctx.globalAlpha).toBe(1);
  } finally {
    act(() => root.unmount());
  }
});
