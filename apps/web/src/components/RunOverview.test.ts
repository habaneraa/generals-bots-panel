// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunState } from '../../../../packages/contracts/src/index';
import { RunOverview } from './RunOverview';

const startedAt = '2026-10-26T14:30:00.000Z';
let root: Root;
let container: HTMLDivElement;

function state(overrides: Partial<RunState> = {}): RunState {
  return {
    run: null,
    phase: 'queueing',
    phaseStartedAt: startedAt,
    match: null,
    turn: 0,
    agentLatencyMs: null,
    completedGames: 0,
    nextGameAt: null,
    ...overrides,
  };
}

async function render(value = state()) {
  await act(async () => {
    root.render(createElement(RunOverview, { state: value, pending: null, onStop: vi.fn() }));
  });
}

const heading = () => container.querySelector('h2')!.textContent;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Date.parse(startedAt) + 23_000));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('RunOverview status', () => {
  it('shows only status and elapsed time in the header and updates every second', async () => {
    await render();
    expect(heading()).toBe('匹配中（23 秒）');
    expect(container.textContent).not.toContain('Run status');
    expect(container.textContent).not.toContain('启动于');
    await act(async () => vi.advanceTimersByTime(1000));
    expect(heading()).toBe('匹配中（24 秒）');
    await render(state({ turn: 5 }));
    expect(heading()).toBe('匹配中（24 秒）');
  });

  it('resets on phase changes and clears its timer when unmounted', async () => {
    await render();
    await render(state({ phase: 'playing', phaseStartedAt: new Date().toISOString() }));
    expect(heading()).toBe('对局进行中（0 秒）');
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(heading()).toBe('对局进行中（2 秒）');
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps elapsed time across remounts using the server timestamp', async () => {
    await render();
    await act(async () => root.render(null));
    vi.setSystemTime(new Date(Date.parse(startedAt) + 45_000));
    await render();
    expect(heading()).toBe('匹配中（45 秒）');
  });

  it.each([
    [0, '0 秒'],
    [59, '59 秒'],
    [60, '1 分 0 秒'],
    [83, '1 分 23 秒'],
    [3600, '1 小时 0 秒'],
    [3723, '1 小时 2 分 3 秒'],
    [90061, '25 小时 1 分 1 秒'],
    [-5, '0 秒'],
  ])('formats an elapsed duration of %s seconds', async (seconds, expected) => {
    vi.setSystemTime(new Date(Date.parse(startedAt) + seconds * 1000));
    await render();
    expect(heading()).toBe(`匹配中（${expected}）`);
  });

  it.each([
    ['idle', '等待启动'],
    ['stopped', '已停止'],
    ['failed', '运行异常'],
  ] as const)('shows duration for the %s state too', async (phase, label) => {
    await render(state({ phase }));
    expect(heading()).toBe(`${label}（23 秒）`);
    expect(container.querySelector('button')!.textContent).toContain('启动运行');
  });
});
