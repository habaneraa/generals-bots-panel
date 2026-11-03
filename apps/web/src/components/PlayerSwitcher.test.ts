// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player, PlayerDetails } from '../../../../packages/contracts/src/index';
import { api } from '../api/client';
import { PlayerSwitcher } from './PlayerSwitcher';

const players: Player[] = [
  { id: 'a', server: 'generals', userId: 'hidden-secret-a', nickname: '服务器主账号' },
  { id: 'b', server: 'bots', userId: 'hidden-secret-b', nickname: '服务器练习账号' },
];
function details(player = players[0]!): PlayerDetails {
  return {
    player,
    dataDir: `data/players/${player.id}`,
    phase: 'stopped',
    active: false,
    runs: 12,
    matches: 34,
    stats: { total: 30, won: 18, lost: 8, draw: 3, interrupted: 1, winRate: 0.6 },
    logs: 9,
    replays: 22,
    lastRunAt: '2026-10-29T08:00:00.000Z',
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let root: Root;
let container: HTMLDivElement;
let items: Player[];
let selected: Player | null;
let error: string | null;
let pendingAction: 'add' | 'select' | null;
const onSelect = vi.fn<(id: string) => Promise<boolean>>();
const onAdd = vi.fn<React.ComponentProps<typeof PlayerSwitcher>['onAdd']>();
const onDelete = vi.fn<React.ComponentProps<typeof PlayerSwitcher>['onDelete']>();
const onCancelAdd = vi.fn();

function Harness() {
  const [open, setOpen] = useState(false);
  return createElement(PlayerSwitcher, {
    player: selected,
    players: items,
    open,
    pending: pendingAction !== null,
    pendingAction,
    error,
    onOpenChange: setOpen,
    onSelect,
    onAdd,
    onCancelAdd,
    onDelete,
  });
}
async function render() {
  await act(async () => root.render(createElement(Harness)));
}
function button(text: string, parent: ParentNode = container) {
  const result = [...parent.querySelectorAll('button')].find(
    (item) => item.textContent?.includes(text) || item.getAttribute('aria-label') === text,
  );
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}
async function click(text: string, parent: ParentNode = container) {
  await act(async () => button(text, parent).click());
}
function input(label: string) {
  const result = [...container.querySelectorAll('label')]
    .find((item) => item.textContent?.trim() === label)
    ?.querySelector<HTMLInputElement>('input');
  if (!result) throw new Error(`Missing input: ${label}`);
  return result;
}
function setInput(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
async function submit() {
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}
async function openDelete(name = '服务器主账号（generals）') {
  await render();
  await click('切换 Player');
  const opener = button(`删除 ${name}`);
  opener.focus();
  await act(async () => opener.click());
  return container.querySelector('dialog')!;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  onSelect.mockReset().mockResolvedValue(true);
  onAdd.mockReset().mockResolvedValue(true);
  onDelete.mockReset().mockResolvedValue(true);
  onCancelAdd.mockReset();
  vi.spyOn(api, 'playerDetails').mockImplementation(async (id) =>
    details(players.find((player) => player.id === id)!),
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
  items = players;
  selected = players[0]!;
  error = null;
  pendingAction = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PlayerSwitcher', () => {
  it('shows server-cached nickname/server without leaking hidden IDs into text, titles or accessible labels', async () => {
    await render();
    await click('切换 Player');
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('服务器主账号');
    expect(dialog.textContent).toContain('服务器练习账号');
    expect(dialog.textContent).toContain('generals 服务器');
    expect(dialog.textContent).toContain('bots 服务器');
    expect(container.innerHTML).not.toContain('hidden-secret-');
    expect(button('切换 Player').getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('button button')).toBeNull();
    await click('显示 userId');
    expect(dialog.textContent).toContain('hidden-secret-a');
    expect(dialog.textContent).toContain('hidden-secret-b');
    await click('隐藏 userId');
    expect(container.innerHTML).not.toContain('hidden-secret-');
  });

  it('supports Escape, outside click, focus restoration and resetting visibility on reopen', async () => {
    await render();
    await click('切换 Player');
    await click('显示 userId');
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button('切换 Player'));
    await click('切换 Player');
    expect(container.innerHTML).not.toContain('hidden-secret-');
    await act(async () =>
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('selects by Player id and closes after success', async () => {
    await render();
    await click('切换 Player');
    await click('切换到 服务器练习账号（bots）');
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('guides first use and submits only server/userId, never a nickname field', async () => {
    items = [];
    selected = null;
    await render();
    await click('切换 Player');
    expect(container.textContent).toContain('还没有 Player');
    expect(input('userId').type).toBe('password');
    expect(
      container.querySelectorAll('form input:not([type="checkbox"]), form select'),
    ).toHaveLength(2);
    expect(container.querySelector('[id$="-nickname"]')).toBeNull();
    await submit();
    expect(onAdd).not.toHaveBeenCalled();
    expect(input('userId').getAttribute('aria-invalid')).toBe('true');
    await act(async () => setInput(input('userId'), '  direct-secret  '));
    await act(async () => {
      const select = container.querySelector('select')!;
      select.value = 'bots';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await submit();
    expect(onAdd).toHaveBeenCalledWith({ server: 'bots', userId: 'direct-secret' });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps the add draft on lookup errors', async () => {
    onAdd.mockResolvedValue(false);
    await render();
    await click('切换 Player');
    await click('新增 Player');
    await act(async () => setInput(input('userId'), 'secret'));
    await submit();
    error = '无法读取服务器昵称';
    await render();
    expect(input('userId').value).toBe('secret');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(error);
  });

  it('prevents duplicate adds, explains nickname lookup pending, and ignores late success after cancel', async () => {
    const request = deferred<boolean>();
    onAdd.mockReturnValue(request.promise);
    await render();
    await click('切换 Player');
    await click('新增 Player');
    await act(async () => setInput(input('userId'), 'secret'));
    await submit();
    await submit();
    expect(onAdd).toHaveBeenCalledTimes(1);
    pendingAction = 'add';
    await render();
    expect(container.textContent).toContain('正在向服务器读取昵称');
    expect(button('添加并切换').disabled).toBe(true);
    expect(input('userId').disabled).toBe(true);
    await click('取消');
    expect(onCancelAdd).toHaveBeenCalled();
    pendingAction = null;
    await render();
    await click('新增 Player');
    await act(async () => request.resolve(true));
    expect(container.querySelector('form')).not.toBeNull();
    expect(input('userId').value).toBe('secret');
  });
});

describe('Player deletion dialog', () => {
  it('shows detailed list-only removal warning and server identity, hides userId until explicitly revealed', async () => {
    const dialog = await openDelete();
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain(
      '仅从列表中移除此 Player，本地配置、历史、日志和录像仍保留在磁盘原位置，不影响服务器账号。',
    );
    expect(dialog.textContent).toContain('服务器主账号');
    expect(dialog.textContent).toContain('data/players/a');
    expect(dialog.textContent).toContain('已停止');
    const taskLabel = [...dialog.querySelectorAll('dt')].find(
      (item) => item.textContent === '后台运行任务',
    );
    expect(taskLabel?.nextElementSibling?.textContent).toBe('未运行');
    expect(dialog.textContent).not.toContain('服务端默认工作区');
    for (const label of [
      '运行记录',
      '对局记录',
      '统计总局数',
      '胜利',
      '失败',
      '平局',
      '中断',
      '胜率',
      '日志文件',
      '录像文件',
      '最近运行时间',
    ])
      expect(dialog.textContent).toContain(label);
    expect(dialog.textContent).toContain('60%');
    expect(dialog.querySelector('time')?.dateTime).toBe('2026-10-29T08:00:00.000Z');
    expect(dialog.innerHTML).not.toContain('hidden-secret-');
    await click('显示 userId', dialog);
    expect(dialog.textContent).toContain('hidden-secret-a');
    expect(
      dialog.querySelector('[title*="hidden-secret"], [aria-label*="hidden-secret"]'),
    ).toBeNull();
    await click('隐藏 userId', dialog);
    expect(dialog.innerHTML).not.toContain('hidden-secret-');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('supports native Escape/outside dismissal, cancels details, restores focus and resets ID visibility', async () => {
    const dialog = await openDelete();
    const signal = vi.mocked(api.playerDetails).mock.calls[0]![1];
    await click('显示 userId', dialog);
    expect(document.activeElement).toBe(button('关闭删除确认'));
    await act(async () =>
      dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true })),
    );
    expect(signal.aborted).toBe(true);
    expect(container.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(button('删除 服务器主账号（generals）'));
    expect(document.body.style.overflow).toBe('');
    await click('删除 服务器主账号（generals）');
    expect(container.querySelector('dialog')?.innerHTML).not.toContain('hidden-secret-');
    await act(async () => container.querySelector('dialog')!.click());
    expect(container.querySelector('dialog')).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('disables delete while details load, supports retry and rejects mismatched detail identity', async () => {
    const request = deferred<PlayerDetails>();
    vi.mocked(api.playerDetails).mockReturnValueOnce(request.promise);
    const dialog = await openDelete();
    expect(button('从列表移除', dialog).disabled).toBe(true);
    expect(dialog.textContent).toContain('正在读取 Player 详情');
    await act(async () => request.resolve(details(players[1])));
    expect(dialog.textContent).toContain('返回的 Player 与删除目标不一致');
    expect(button('从列表移除', dialog).disabled).toBe(true);
    await click('重试详情', dialog);
    expect(button('从列表移除', dialog).disabled).toBe(false);
  });

  it('aborts old details on target change and ignores late responses', async () => {
    const old = deferred<PlayerDetails>();
    vi.mocked(api.playerDetails).mockReturnValueOnce(old.promise);
    await openDelete();
    const signal = vi.mocked(api.playerDetails).mock.calls[0]![1];
    await click('关闭删除确认');
    await click('删除 服务器练习账号（bots）');
    expect(signal.aborted).toBe(true);
    await act(async () => old.resolve(details()));
    const dialog = container.querySelector('dialog')!;
    expect(dialog.textContent).toContain('服务器练习账号');
    expect(dialog.textContent).not.toContain('服务器主账号');
    await click('从列表移除', dialog);
    expect(onDelete).toHaveBeenCalledWith('b', expect.any(AbortSignal));
  });

  it('cancels old details when the current workspace changes', async () => {
    const request = deferred<PlayerDetails>();
    vi.mocked(api.playerDetails).mockReturnValueOnce(request.promise);
    await openDelete();
    const signal = vi.mocked(api.playerDetails).mock.calls[0]![1];
    selected = players[1]!;
    await render();
    expect(signal.aborted).toBe(true);
    await act(async () => request.resolve(details()));
    expect(container.querySelector('dialog')).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
    selected = players[0]!;
    await render();
    expect(container.querySelector('dialog')).toBeNull();
  });

  it('restores focus to the switcher if an externally deleted target removes its opener', async () => {
    await openDelete('服务器练习账号（bots）');
    items = [players[0]!];
    await render();
    expect(container.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(button('切换 Player'));
  });

  it.each(['playing', 'stopped'] as const)(
    'refuses an active background task in %s phase until refreshing inactive details',
    async (phase) => {
      vi.mocked(api.playerDetails).mockResolvedValueOnce({ ...details(), phase, active: true });
      const dialog = await openDelete();
      const taskLabel = [...dialog.querySelectorAll('dt')].find(
        (item) => item.textContent === '后台运行任务',
      );
      expect(taskLabel?.nextElementSibling?.textContent).toBe('运行中');
      expect(dialog.textContent).toContain('先切换到该 Player 并停止运行');
      expect(button('从列表移除', dialog).disabled).toBe(true);
      await click('从列表移除', dialog);
      expect(onDelete).not.toHaveBeenCalled();
      await click('刷新运行状态与详情', dialog);
      expect(taskLabel?.nextElementSibling?.textContent).toBe('未运行');
      expect(button('从列表移除', dialog).disabled).toBe(false);
    },
  );

  it('retains details and running rejection errors, prevents duplicate deletes and cancels closed mutations', async () => {
    onDelete.mockRejectedValueOnce(new Error('Player 正在运行（409）'));
    const dialog = await openDelete();
    await click('从列表移除', dialog);
    expect(dialog.textContent).toContain('Player 正在运行（409）');
    expect(dialog.textContent).toContain('请先确认该 Player 已停止运行');
    expect(dialog.textContent).toContain('data/players/a');
    const request = deferred<boolean>();
    onDelete.mockReturnValueOnce(request.promise);
    await click('从列表移除', dialog);
    await click('从列表移除', dialog);
    expect(onDelete).toHaveBeenCalledTimes(2);
    expect(button('从列表移除', dialog).disabled).toBe(true);
    const signal = onDelete.mock.calls[1]![1];
    await click('关闭删除确认', dialog);
    expect(signal.aborted).toBe(true);
    await click('删除 服务器练习账号（bots）');
    await act(async () => request.resolve(true));
    expect(container.querySelector('dialog')?.textContent).toContain('服务器练习账号');
    expect(onDelete.mock.calls.map(([id]) => id)).toEqual(['a', 'a']);
  });
});
