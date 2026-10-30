import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../../../packages/contracts/src/index.js';
import { PlayerManager } from '../player-manager.js';
import { SocketGame } from './live.js';
import { gameEndpoint, lookupNickname } from './username.js';

const socket = vi.hoisted(() => ({
  connect: vi.fn<(signal: AbortSignal) => Promise<void>>().mockResolvedValue(),
  request: vi
    .fn<(event: string, args: unknown[], signal: AbortSignal) => Promise<unknown[]>>()
    .mockResolvedValue([' server nickname ']),
  close: vi.fn(),
  emit: vi.fn(),
  endpoint: '',
}));
vi.mock('./socket.js', () => ({
  abortError: (signal: AbortSignal) => signal.reason,
  GameSocket: class {
    constructor(endpoint: string) {
      socket.endpoint = endpoint;
    }
    connect = socket.connect;
    request = socket.request;
    close = socket.close;
    emit = socket.emit;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  socket.connect.mockResolvedValue();
  socket.request.mockResolvedValue([' server nickname ']);
});

describe('nickname lookup without matchmaking or network', () => {
  it.each(['generals', 'bots'] as const)(
    'queries %s and always closes without joining',
    async (server) => {
      const signal = new AbortController().signal;
      expect(await lookupNickname({ server, userId: 'secret-id' }, signal)).toBe('server nickname');
      expect(socket.endpoint).toBe(gameEndpoint(server));
      expect(socket.connect).toHaveBeenCalledExactlyOnceWith(signal);
      expect(socket.request).toHaveBeenCalledExactlyOnceWith('get_username', ['secret-id'], signal);
      expect(socket.emit).not.toHaveBeenCalled();
      expect(socket.close).toHaveBeenCalledOnce();
    },
  );
  it.each([null, '', ' ', 42, 'x'.repeat(201)])(
    'rejects invalid username %j without a fake cache',
    async (value) => {
      socket.request.mockResolvedValue([value]);
      await expect(
        lookupNickname({ server: 'bots', userId: 'secret-id' }, new AbortController().signal),
      ).rejects.toThrow('无法查询游戏昵称');
      expect(socket.close).toHaveBeenCalledOnce();
    },
  );
  it.each(['connect', 'request'] as const)('closes and redacts a %s failure', async (stage) => {
    socket[stage].mockRejectedValue(new Error('secret-id'));
    const result = await lookupNickname(
      { server: 'bots', userId: 'secret-id' },
      new AbortController().signal,
    ).catch((error: Error) => error);
    expect(result).toBeInstanceOf(Error);
    expect(String(result)).not.toContain('secret-id');
    expect(socket.close).toHaveBeenCalledOnce();
  });
  it('closes on cancellation even when the acknowledgment arrives late', async () => {
    const abort = new AbortController();
    socket.request.mockImplementationOnce(async () => {
      abort.abort(new Error('secret-id'));
      return ['late nickname'];
    });
    await expect(
      lookupNickname({ server: 'bots', userId: 'secret-id' }, abort.signal),
    ).rejects.toThrow('昵称查询已取消');
    expect(socket.close).toHaveBeenCalledOnce();
  });
  it('refreshes the cache hook on actual game connect before join', async () => {
    const update = vi.fn();
    const game = new SocketGame('bots', 'secret-id', undefined, undefined, update);
    await game.connect(new AbortController().signal);
    expect(update).toHaveBeenCalledExactlyOnceWith('server nickname');
    expect(socket.emit).not.toHaveBeenCalled();
    game.close();
  });
});

describe('nickname cache integration with actual game connect', () => {
  it('persists get_username from connect and ignores an older late startup refresh', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'panel-connect-nickname-'));
    let manager = new PlayerManager(dir, dir, undefined, async () => 'cached nickname');
    try {
      const player = (await manager.add({ server: 'bots', userId: 'secret-id' })).player!;
      await manager.close();
      let finish!: (nickname: string) => void;
      manager = new PlayerManager(
        dir,
        dir,
        undefined,
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      );
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      const controller = manager.controller(player.id);
      controller.start({ ...defaultConfig, autopilot: false });
      await vi.waitFor(() => expect(manager.dashboard().player!.nickname).toBe('server nickname'));
      finish('stale startup nickname');
      await Promise.resolve();
      await Promise.resolve();
      expect(manager.dashboard().player!.nickname).toBe('server nickname');
      expect(JSON.parse(readFileSync(join(dir, 'players.json'), 'utf8')).players[0].nickname).toBe(
        'server nickname',
      );
      await controller.stop();
    } finally {
      await manager.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('aborts and closes a pending lookup socket before manager.close resolves', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'panel-close-nickname-'));
    const manager = new PlayerManager(dir, dir);
    socket.request.mockImplementationOnce((event, args, signal) => {
      expect(event).toBe('get_username');
      expect(args).toEqual(['secret-id']);
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    try {
      const pending = manager
        .add({ server: 'bots', userId: 'secret-id' })
        .catch((error: unknown) => error);
      await vi.waitFor(() => expect(socket.request).toHaveBeenCalledOnce());
      await manager.close();
      expect(socket.close).toHaveBeenCalledOnce();
      expect(await pending).toMatchObject({ statusCode: 502 });
      expect(manager.players).toEqual([]);
    } finally {
      await manager.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
