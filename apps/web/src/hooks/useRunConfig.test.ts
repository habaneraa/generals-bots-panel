// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../../../packages/contracts/src/index';
import { useRunConfig } from './useRunConfig';

const config = { ...defaultConfig, command: 'node' };
const requestFrame = vi.fn<typeof requestAnimationFrame>();
const cancelFrame = vi.fn<typeof cancelAnimationFrame>();
const frames = new Map<number, FrameRequestCallback>();
let nextFrame: number;
let root: Root;
let container: HTMLDivElement;
let result: ReturnType<typeof useRunConfig>;

function Harness({ showInvalid = true }: { showInvalid?: boolean }) {
  result = useRunConfig(config);
  return createElement(
    'form',
    { id: 'run-config' },
    createElement('input', {
      name: 'command',
      'aria-invalid': showInvalid && Boolean(result.errors.command),
    }),
    createElement('input', {
      name: 'agentTimeoutMs',
      'aria-invalid': showInvalid && Boolean(result.errors.agentTimeoutMs),
    }),
    createElement('button', { type: 'button' }, '继续编辑'),
  );
}

async function render(playerId = 'player-a', showInvalid = true) {
  await act(async () => root.render(createElement(Harness, { key: playerId, showInvalid })));
}

function flushFrames() {
  act(() => {
    for (const [id, callback] of [...frames]) {
      frames.delete(id);
      callback(0);
    }
  });
}

function commandInput() {
  return container.querySelector<HTMLInputElement>('input[name="command"]')!;
}

beforeEach(() => {
  vi.clearAllMocks();
  frames.clear();
  nextFrame = 0;
  requestFrame.mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  cancelFrame.mockImplementation((id) => {
    frames.delete(id);
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', requestFrame);
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('useRunConfig validation focus lifecycle', () => {
  it('waits for validation errors to render before focusing the first invalid field', async () => {
    await render();
    act(() => {
      result.update('command', '');
      result.update('agentTimeoutMs', '0');
    });
    act(() => {
      expect(result.validate()).toBeNull();
    });
    expect(result.errors).toHaveProperty('command');
    expect(result.errors).toHaveProperty('agentTimeoutMs');
    expect(document.activeElement).not.toBe(commandInput());
    const scroll = vi.spyOn(container.querySelector('form')!, 'scrollIntoView');

    flushFrames();

    expect(document.activeElement).toBe(commandInput());
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => root.render(null));
    expect(cancelFrame).not.toHaveBeenCalled();
  });

  it('scrolls to the form when validation has no rendered invalid field to focus', async () => {
    await render('player-a', false);
    act(() => result.update('command', ''));
    act(() => {
      expect(result.validate()).toBeNull();
    });
    const scroll = vi.spyOn(container.querySelector('form')!, 'scrollIntoView');
    const focus = vi.spyOn(commandInput(), 'focus');

    flushFrames();

    expect(scroll).toHaveBeenCalledExactlyOnceWith({ behavior: 'smooth', block: 'start' });
    expect(focus).not.toHaveBeenCalled();
  });

  it('keeps only the latest focus frame when invalid validation is repeated', async () => {
    await render();
    act(() => result.update('command', ''));
    act(() => {
      expect(result.validate()).toBeNull();
    });
    const firstFrame = [...frames.keys()][0]!;
    act(() => {
      expect(result.validate()).toBeNull();
    });
    expect(requestFrame).toHaveBeenCalledTimes(2);
    expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(firstFrame);
    expect(frames.size).toBe(1);
    const focus = vi.spyOn(commandInput(), 'focus');

    flushFrames();

    expect(focus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(commandInput());
  });

  it('cancels an old workspace frame without focusing or scrolling the replacement form', async () => {
    await render();
    act(() => result.update('command', ''));
    act(() => {
      expect(result.validate()).toBeNull();
    });
    const oldFrame = [...frames.keys()][0]!;

    await render('player-b');

    expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(oldFrame);
    expect(frames.size).toBe(0);
    expect(result.errors).toEqual({});
    const scroll = vi.spyOn(container.querySelector('form')!, 'scrollIntoView');
    const focus = vi.spyOn(commandInput(), 'focus');
    const button = container.querySelector('button')!;
    button.focus();
    flushFrames();
    expect(document.activeElement).toBe(button);
    expect(focus).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
  });

  it('clears previous errors and pending focus when corrected values validate successfully', async () => {
    await render();
    act(() => result.update('command', ''));
    act(() => {
      expect(result.validate()).toBeNull();
    });
    const oldFrame = [...frames.keys()][0]!;
    act(() => {
      result.update('command', 'python3');
      result.update('args', 'agent.py\n--name=a b');
      result.update('agentTimeoutMs', '2500');
    });
    act(() => {
      expect(result.validate()).toEqual({
        ...config,
        command: 'python3',
        args: ['agent.py', '--name=a b'],
        agentTimeoutMs: 2500,
      });
    });

    expect(result.errors).toEqual({});
    expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(oldFrame);
    expect(requestFrame).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    const button = container.querySelector('button')!;
    button.focus();
    const scroll = vi.spyOn(container.querySelector('form')!, 'scrollIntoView');
    flushFrames();
    expect(document.activeElement).toBe(button);
    expect(scroll).not.toHaveBeenCalled();
  });
});
