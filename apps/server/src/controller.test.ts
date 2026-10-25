import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultConfig as baseConfig,
  type MatchSnapshot,
} from '../../../packages/contracts/src/index.js';
import type { GameConnection } from './game/types.js';
import { FixtureGame } from '../../../test/fixtures/game.js';
import { Controller } from './controller.js';
import { Repository } from './storage/repository.js';
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
});
function setup(game: GameConnection = new FixtureGame()) {
  const dir = mkdtempSync(join(tmpdir(), 'panel-controller-'));
  const repository = new Repository(dir);
  const controller = new Controller(repository, resolve('.'), async () => game);
  cleanups.push(async () => {
    await controller.close();
    repository.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { repository, controller };
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
    const { controller, repository } = setup();
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
    const { controller, repository } = setup();
    controller.start(defaultConfig);
    await controller.stop();
    expect(controller.dashboard().state.phase).toBe('stopped');
    expect(repository.matches().total).toBe(0);
  });

  it('records agent startup errors and an interrupted match', async () => {
    const { controller, repository } = setup();
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
    const { controller, repository } = setup(new SnapshotGame());
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
    const { controller, repository } = setup(new LatestGame());
    controller.start({ ...defaultConfig, command: '/nonexistent-panel-test-executable' });
    await idle(controller);
    expect(repository.matches().items[0]).toMatchObject({
      outcome: 'interrupted',
      details: { endReason: 'error', agent: { observations: 0, decisions: 0 } },
    });
    expect(repository.matches().items[0]?.details?.last?.players[0]?.land).toBe(2);
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
    const { controller, repository } = setup(game);
    controller.start({ ...defaultConfig, command: '/agent-must-not-start' });
    await idle(controller);
    expect(controller.dashboard().state).toMatchObject({ phase: 'stopped', completedGames: 1 });
    expect(repository.matches().items[0]).toMatchObject({
      outcome: 'lost',
      details: { initial: null, winnerIndex: 1, agent: { observations: 0, decisions: 0 } },
    });
  });

  it('validates requests and rejects cross-site command execution', async () => {
    const { controller } = setup();
    const app = await createApp(controller, resolve('nonexistent-web'));
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
