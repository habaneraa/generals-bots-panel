import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultConfig as baseConfig,
  type MatchSnapshot,
} from '../../../packages/contracts/src/index.js';
import type { GameConnection, GameEnd } from './game/types.js';
import { FixtureGame, fixtureObservation } from '../../../test/fixtures/game.js';
import { AgentProcess } from './agent/process.js';
import type { Controller } from './controller.js';
import { PlayerManager } from './player-manager.js';
import { RunLog } from './storage/logs.js';
import { createApp } from './app.js';

const defaultConfig = {
  ...baseConfig,
  autopilot: false,
  command: process.execPath,
  args: [resolve('test/fixtures/pass-agent.mjs')],
};
function snapshot(land: number): MatchSnapshot {
  return {
    turn: land - 1,
    serverTurn: land,
    capturedAt: new Date().toISOString(),
    gameType: '1v1',
    teams: [0, 1],
    modifiers: [],
    torus: false,
    map: { width: 3, height: 3 },
    players: [
      {
        index: 0,
        isSelf: true,
        userId: 'public-self',
        username: 'self fixture',
        stars: 12.5,
        team: 0,
        land,
        army: 10,
        cities: land - 1,
        visibleCities: land - 1,
        alive: true,
      },
      {
        index: 1,
        isSelf: false,
        userId: null,
        username: 'opponent fixture',
        stars: null,
        team: 1,
        land: 1,
        army: 8,
        cities: null,
        visibleCities: 0,
        alive: null,
      },
    ],
  };
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
async function setup(game: GameConnection = new FixtureGame()) {
  const dir = mkdtempSync(join(tmpdir(), 'panel-controller-'));
  const manager = new PlayerManager(
    dir,
    resolve('.'),
    async () => game,
    async () => 'test player',
  );
  await manager.add({ server: 'generals', userId: 'test-account' });
  const controller = manager.controller();
  const repository = controller.repository;
  cleanups.push(async () => {
    await manager.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { repository, controller, manager };
}
async function idle(controller: Controller) {
  if (!controller.active) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('Controller did not stop'));
    }, 5000);
    const unsubscribe = controller.subscribe(() => {
      if (!controller.active) {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      }
    });
  });
}

describe('run lifecycle with isolated test inputs', () => {
  it('runs autopilot using a real Node child and persists results', async () => {
    const { controller, repository } = await setup();
    controller.start({ ...defaultConfig, autopilot: true, maxGames: 2, cooldownMs: 0 });
    expect(() => controller.start(defaultConfig)).toThrow('已有运行');
    expect(() => controller.saveConfig(defaultConfig)).toThrow('停止当前运行');
    await idle(controller);
    expect(controller.dashboard().state).toMatchObject({ phase: 'stopped', completedGames: 2 });
    expect(repository.stats()).toMatchObject({ total: 2, won: 2 });
    expect(
      controller
        .dashboard()
        .matches.every((match) => match.replayUrl?.startsWith('https://generals.io/replays/')),
    ).toBe(true);
  });

  it('stops immediately during matchmaking without a match result', async () => {
    const { controller, repository } = await setup();
    controller.start(defaultConfig);
    await controller.stop();
    expect(controller.dashboard().state.phase).toBe('stopped');
    expect(repository.matches().total).toBe(0);
  });

  it('records agent startup errors and an interrupted match', async () => {
    const { controller, repository } = await setup();
    controller.start({ ...defaultConfig, command: '/nonexistent-panel-test-executable' });
    await idle(controller);
    expect(controller.dashboard().state.phase).toBe('failed');
    expect(repository.stats()).toMatchObject({ total: 0, interrupted: 1 });
  });

  it('retains initial and terminal snapshots and counts decisions without inventing moves', async () => {
    class SnapshotGame extends FixtureGame {
      override async join(signal: AbortSignal) {
        return {
          ...(await super.join(signal)),
          startedAt: new Date(Date.now() - 2000).toISOString(),
          snapshot: snapshot(1),
        };
      }
      override async next(turn: number, signal: AbortSignal) {
        return {
          ...(await super.next(turn, signal)),
          snapshot: snapshot(2),
          winnerIndex: 0,
          endReason: 'game_won',
        };
      }
    }
    const { controller, repository } = await setup(new SnapshotGame());
    controller.start(defaultConfig);
    await idle(controller);
    const record = repository.matches().items[0];
    expect(record?.details?.initial?.players[0]?.land).toBe(1);
    expect(record?.details?.last?.players[0]?.land).toBe(2);
    expect(record?.details?.last?.players[1]?.cities).toBeNull();
    expect(record?.details?.agent).toMatchObject({
      observations: 1,
      decisions: 1,
      passes: 1,
      submittedMoves: 0,
      skippedMoves: 0,
      splitMoves: 0,
    });
    expect(record?.details?.durationMs).toBeGreaterThanOrEqual(2000);
    expect(record?.details).toMatchObject({ winnerIndex: 0, endReason: 'game_won' });
  });

  it('persists per-game rating and exposes it through history and dashboard APIs', async () => {
    const rating = {
      username: 'self fixture',
      before: 12.5,
      after: 13.25,
      delta: 0.75,
      source: 'public-profile' as const,
      capturedAt: '2026-10-25T00:01:00.000Z',
    };
    class RatingGame extends FixtureGame {
      override async join(signal: AbortSignal) {
        return { ...(await super.join(signal)), startedAt: '2026-10-25T00:00:00.000Z' };
      }
      override async next(turn: number, signal: AbortSignal) {
        return { ...(await super.next(turn, signal)), rating, endedAt: '2026-10-25T00:00:59.000Z' };
      }
    }
    const { controller, repository, manager } = await setup(new RatingGame());
    controller.start(defaultConfig);
    await idle(controller);
    expect(repository.matches().items[0]?.rating).toEqual(rating);
    expect(repository.matches().items[0]).toMatchObject({
      endedAt: '2026-10-25T00:00:59.000Z',
      details: { durationMs: 59000 },
    });
    const app = await createApp(manager, resolve('nonexistent-web'));
    cleanups.push(async () => {
      await app.close();
    });
    const headers = { host: '127.0.0.1:3000' };
    const history = await app.inject({ url: '/api/matches', headers });
    expect(history.statusCode).toBe(200);
    expect(history.json().items[0].rating).toEqual(rating);
    const dashboard = await app.inject({ url: '/api/dashboard', headers });
    expect(dashboard.json().matches[0].rating).toEqual(rating);
  });

  it('keeps a completed outcome when stop cancels terminal metadata sampling', async () => {
    class StoppingGame extends FixtureGame {
      override async next(turn: number, signal: AbortSignal) {
        const result = await super.next(turn, signal);
        void controller.stop();
        return result;
      }
    }
    const { controller, repository } = await setup(new StoppingGame());
    controller.start(defaultConfig);
    await idle(controller);
    expect(repository.matches().items[0]).toMatchObject({
      outcome: 'won',
      rating: { after: null, delta: null },
    });
    expect(repository.stats()).toMatchObject({ won: 1, interrupted: 0 });
  });

  it.each(['stop-reject', 'stop-resolve', 'timeout', 'normal'] as const)(
    'recovers a confirmed terminal result during act without double counting (%s)',
    async (mode) => {
      const rating = {
        username: 'self fixture',
        before: 10,
        after: 11,
        delta: 1,
        source: 'terminal' as const,
        capturedAt: '2026-10-25T00:00:03.000Z',
      };
      let result: GameEnd | null = null;
      const terminal: GameEnd = {
        gameId: 'act-terminal',
        startedAt: '2026-10-25T00:00:00.000Z',
        endedAt: '2026-10-25T00:00:03.000Z',
        outcome: 'won',
        turn: 2,
        winnerIndex: 0,
        endReason: 'game_won',
        rating,
        snapshot: snapshot(3),
      };
      const game: GameConnection = {
        connect: async () => {},
        join: async () => ({
          gameId: terminal.gameId,
          startedAt: terminal.startedAt,
          observation: fixtureObservation(),
          attackIndex: 0,
          snapshot: snapshot(1),
        }),
        next: vi.fn(async () => terminal),
        submit: vi.fn(() => 'pass' as const),
        getResult: () => result,
        getSnapshot: () =>
          result ? { gameId: result.gameId, snapshot: result.snapshot!, rating } : null,
        close: vi.fn(),
      };
      const { controller, repository } = await setup(game);
      const agent = {
        begin: vi.fn(),
        act: vi.fn(async () => {
          result = terminal;
          if (mode.startsWith('stop')) void controller.stop();
          if (mode === 'stop-reject') throw new Error('运行已取消');
          if (mode === 'timeout') throw new Error('agent 响应超时（mock）');
          return { pass: true, row: 0, col: 0, direction: 0, split: false, value: null };
        }),
        end: vi.fn(),
        close: vi.fn(async () => {}),
      };
      vi.spyOn(AgentProcess, 'start').mockResolvedValue(agent as unknown as AgentProcess);
      controller.start(defaultConfig);
      await idle(controller);
      expect(controller.dashboard().state).toMatchObject({
        phase: mode === 'timeout' ? 'failed' : 'stopped',
        completedGames: 1,
        run: { error: mode === 'timeout' ? 'agent 响应超时（mock）' : null },
      });
      expect(repository.matches().items[0]).toMatchObject({
        outcome: 'won',
        turns: 3,
        endedAt: terminal.endedAt,
        rating,
        details: {
          durationMs: 3000,
          winnerIndex: 0,
          endReason: 'game_won',
          last: terminal.snapshot,
        },
      });
      expect(repository.stats()).toMatchObject({ total: 1, won: 1, interrupted: 0 });
      expect(game.next).toHaveBeenCalledTimes(mode === 'normal' ? 1 : 0);
      expect(game.submit).toHaveBeenCalledTimes(mode === 'normal' ? 1 : 0);
    },
  );

  it.each([null, 'different-game'])(
    'does not recover an absent or mismatched terminal result (%s)',
    async (resultId) => {
      const game: GameConnection = {
        connect: async () => {},
        join: async () => ({
          gameId: 'current-game',
          observation: fixtureObservation(),
          attackIndex: 0,
        }),
        next: vi.fn(),
        submit: vi.fn(),
        getResult: () =>
          resultId ? { gameId: resultId, outcome: 'won', turn: 99, winnerIndex: 0 } : null,
        close: vi.fn(),
      };
      const { controller, repository } = await setup(game);
      vi.spyOn(AgentProcess, 'start').mockResolvedValue({
        begin: vi.fn(),
        act: vi.fn(async () => {
          throw new Error('agent 响应超时（mock）');
        }),
        close: vi.fn(async () => {}),
      } as unknown as AgentProcess);
      controller.start(defaultConfig);
      await idle(controller);
      expect(controller.dashboard().state).toMatchObject({ phase: 'failed', completedGames: 0 });
      expect(repository.matches().items[0]).toMatchObject({
        outcome: 'interrupted',
        turns: 1,
        details: { winnerIndex: null, endReason: 'error' },
      });
    },
  );

  it('captures the latest snapshot after an agent failure', async () => {
    class LatestGame extends FixtureGame {
      private gameId = '';
      override async join(signal: AbortSignal) {
        const frame = await super.join(signal);
        this.gameId = frame.gameId;
        return { ...frame, snapshot: snapshot(1) };
      }
      getSnapshot() {
        return { gameId: this.gameId, snapshot: snapshot(2) };
      }
    }
    const { controller, repository } = await setup(new LatestGame());
    controller.start({ ...defaultConfig, command: '/nonexistent-panel-test-executable' });
    await idle(controller);
    expect(repository.matches().items[0]).toMatchObject({
      outcome: 'interrupted',
      details: { endReason: 'error', agent: { observations: 0, decisions: 0 } },
    });
    expect(repository.matches().items[0]?.details?.last?.players[0]?.land).toBe(2);
    expect(repository.matches().items[0]?.rating).toMatchObject({
      username: 'self fixture',
      before: 12.5,
      after: null,
      delta: null,
    });
  });

  it('records a game ending before an actionable frame without starting an agent', async () => {
    const game: GameConnection = {
      connect: async () => {},
      join: async () => ({
        gameId: 'short-game',
        outcome: 'lost',
        turn: 0,
        startedAt: new Date().toISOString(),
        winnerIndex: 1,
        endReason: 'game_lost',
        snapshot: snapshot(1),
      }),
      next: async () => {
        throw new Error('No next frame expected');
      },
      submit: () => 'pass',
      close: () => {},
    };
    const { controller, repository } = await setup(game);
    controller.start({ ...defaultConfig, command: '/agent-must-not-start' });
    await idle(controller);
    expect(controller.dashboard().state).toMatchObject({ phase: 'stopped', completedGames: 1 });
    expect(repository.matches().items[0]).toMatchObject({
      outcome: 'lost',
      details: { initial: null, winnerIndex: 1, agent: { observations: 0, decisions: 0 } },
    });
  });

  it.each([
    { resource: 'game', failure: new Error('game close failed') },
    { resource: 'game', failure: 'game close failed' },
    { resource: 'agent', failure: new Error('agent close failed') },
    { resource: 'agent', failure: 'agent close failed' },
  ])(
    'records $resource cleanup failures without losing their cause ($failure)',
    async ({ resource, failure }) => {
      const game = new FixtureGame();
      const closeGame = vi.spyOn(game, 'close');
      const agent = {
        begin: vi.fn(),
        act: vi.fn(async () => ({
          pass: true,
          row: 0,
          col: 0,
          direction: 0,
          split: false,
          value: null,
        })),
        end: vi.fn(),
        close: vi.fn(async () => {}),
      };
      if (resource === 'game')
        closeGame.mockImplementation(() => {
          throw failure;
        });
      else agent.close.mockRejectedValue(failure);
      vi.spyOn(AgentProcess, 'start').mockResolvedValue(agent as unknown as AgentProcess);
      const { controller, repository } = await setup(game);
      controller.start(defaultConfig);
      await idle(controller);
      const message = `${resource} close failed`;
      const context = resource === 'game' ? '关闭游戏连接失败' : '关闭 agent 进程失败';
      expect(controller.dashboard().state).toMatchObject({
        phase: 'failed',
        run: { error: message },
      });
      expect(controller.dashboard().logs).toContainEqual(
        expect.objectContaining({
          level: 'error',
          message: `${context}：${message}`,
        }),
      );
      expect(closeGame).toHaveBeenCalledOnce();
      expect(agent.close).toHaveBeenCalledOnce();
      expect(repository.stats()).toMatchObject({ won: 1, interrupted: 0 });
    },
  );

  it.each([false, true])(
    'retains the original failure with cleanup log writes failing=%s',
    async (logWritesFail) => {
      const fallback = vi.spyOn(console, 'error').mockImplementation(() => {});
      const writeFailure = new Error('log disk unavailable');
      if (logWritesFail) {
        const write = RunLog.prototype.write;
        vi.spyOn(RunLog.prototype, 'write').mockImplementation(function (
          this: RunLog,
          level,
          message,
        ) {
          if (message.startsWith('关闭')) throw writeFailure;
          return write.call(this, level, message);
        });
      }
      const game = new FixtureGame();
      vi.spyOn(game, 'close').mockImplementation(() => {
        throw 'game close failed';
      });
      const agent = {
        begin: vi.fn(),
        act: vi.fn(async () => {
          throw new Error('inference failed');
        }),
        close: vi.fn(async () => {
          throw 'agent close failed';
        }),
      };
      vi.spyOn(AgentProcess, 'start').mockResolvedValue(agent as unknown as AgentProcess);
      const { controller, repository } = await setup(game);
      controller.start(defaultConfig);
      await idle(controller);
      const dashboard = controller.dashboard();
      expect(dashboard.state).toMatchObject({
        phase: 'failed',
        run: { error: 'inference failed' },
      });
      expect(repository.latestRun()).toMatchObject({ phase: 'failed', error: 'inference failed' });
      const cleanupMessages = [
        '关闭游戏连接失败：game close failed',
        '关闭 agent 进程失败：agent close failed',
      ];
      if (logWritesFail) {
        for (const message of cleanupMessages)
          expect(fallback).toHaveBeenCalledWith(message, writeFailure);
      } else {
        expect(
          dashboard.logs.filter((entry) => entry.level === 'error').map((entry) => entry.message),
        ).toEqual(expect.arrayContaining(cleanupMessages));
      }
      expect(agent.close).toHaveBeenCalledOnce();
    },
  );

  it('validates requests and rejects cross-site command execution', async () => {
    const { manager } = await setup();
    const app = await createApp(manager, resolve('nonexistent-web'));
    cleanups.push(async () => {
      await app.close();
    });
    const host = { host: '127.0.0.1:3000' };
    expect((await app.inject({ url: '/api/health', headers: host })).statusCode).toBe(200);
    expect(
      (await app.inject({ url: '/api/dashboard', headers: { host: 'attacker.invalid' } }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/runs',
          headers: { ...host, origin: 'https://attacker.invalid' },
          payload: defaultConfig,
        })
      ).statusCode,
    ).toBe(403);
    for (const payload of [
      { ...defaultConfig, command: '' },
      { ...defaultConfig, mode: 'demo' },
    ]) {
      expect(
        (await app.inject({ method: 'POST', url: '/api/runs', headers: host, payload })).statusCode,
      ).toBe(400);
    }
    expect((await app.inject({ url: '/api/matches?page=0', headers: host })).statusCode).toBe(400);
    expect(
      (await app.inject({ url: '/api/runs/not-a-uuid/logs/download', headers: host })).statusCode,
    ).toBe(400);
  });
});
