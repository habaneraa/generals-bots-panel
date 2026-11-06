import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { MatchRecord } from '../../../packages/contracts/src/index.js';
import { createApp } from './app.js';
import { PlayerManager } from './player-manager.js';

const resources: { app: FastifyInstance; dir: string }[] = [];
afterEach(async () => {
  for (const { app, dir } of resources.splice(0)) {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'panel-match-api-'));
  const manager = new PlayerManager(join(dir, 'data'), dir, undefined, async () => 'test player');
  const app = await createApp(manager, join(dir, 'no-web'));
  resources.push({ app, dir });
  return { app, manager };
}

function match(): MatchRecord {
  return {
    id: randomUUID(),
    runId: randomUUID(),
    mode: 'live',
    server: 'bots',
    gameId: 'private-game',
    opponent: 'private opponent',
    startedAt: '2026-10-25T00:00:00.000Z',
    endedAt: '2026-10-25T00:01:00.000Z',
    outcome: 'won',
    turns: 12,
    replayUrl: null,
    localReplay: true,
    details: {
      initial: null,
      last: null,
      durationMs: 60_000,
      winnerIndex: 0,
      endReason: 'captured',
      agent: {
        observations: 12,
        decisions: 12,
        submittedMoves: 10,
        passes: 2,
        skippedMoves: 0,
        staleMoves: 0,
        rejectedMoves: 0,
        skippedTurns: 0,
        retriedMoves: 0,
        splitMoves: 1,
        totalLatencyMs: 120,
        maxLatencyMs: 20,
      },
    },
    rating: {
      username: 'test player',
      before: 1,
      after: 2,
      delta: 1,
      source: 'terminal',
      capturedAt: '2026-10-25T00:01:00.000Z',
    },
  };
}

const headers = { host: '127.0.0.1:3000' };
const input = { server: 'bots', userId: 'first-account' } as const;
const path = (id: string, playerId: string) =>
  `/api/matches/${encodeURIComponent(id)}?${new URLSearchParams({ playerId })}`;

describe('单局详情 API', () => {
  it('按记录 ID 返回完整 payload，静态星数历史路由不被详情路由遮蔽', async () => {
    const { app, manager } = await setup();
    const player = (await manager.add(input)).player!;
    const record = match();
    manager.controller(player.id).repository.putMatch(record);

    const response = await app.inject({ url: path(record.id, player.id), headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(record);

    const history = await app.inject({
      url: `/api/matches/star-history?playerId=${player.id}`,
      headers,
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().items).toHaveLength(1);
    expect(history.json().items[0].id).toBe(record.id);
  });

  it('缺失记录与未知 Player 返回 404，不泄露其他 Player 的记录', async () => {
    const { app, manager } = await setup();
    const first = (await manager.add(input)).player!;
    const second = (await manager.add({ ...input, userId: 'second-account' })).player!;
    const record = match();
    manager.controller(first.id).repository.putMatch(record);
    manager.select(first.id);

    for (const url of [path(randomUUID(), first.id), path(record.id, second.id)]) {
      const response = await app.inject({ url, headers });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ message: '对局记录不存在' });
    }
    const unknownPlayer = await app.inject({ url: path(record.id, 'missing-player'), headers });
    expect(unknownPlayer.statusCode).toBe(404);
    expect(unknownPlayer.body).not.toContain(record.gameId);
  });

  it('相同记录 ID 按显式 Player 隔离，切换 active 不改变显式请求', async () => {
    const { app, manager } = await setup();
    const first = (await manager.add(input)).player!;
    const second = (await manager.add({ ...input, userId: 'second-account' })).player!;
    const record = match();
    const other = { ...record, gameId: 'second-game', opponent: 'second opponent' };
    manager.controller(first.id).repository.putMatch(record);
    manager.controller(second.id).repository.putMatch(other);
    manager.select(second.id);

    const explicit = await app.inject({ url: path(record.id, first.id), headers });
    expect(explicit.statusCode).toBe(200);
    expect(explicit.json()).toEqual(record);
    const scoped = await app.inject({ url: path(record.id, second.id), headers });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json()).toEqual(other);
    const active = await app.inject({ url: `/api/matches/${record.id}`, headers });
    expect(active.statusCode).toBe(200);
    expect(active.json()).toEqual(other);
  });

  it('保留旧记录与进行中记录的原始字段，不虚构详情', async () => {
    const { app, manager } = await setup();
    const player = (await manager.add(input)).player!;
    const record = { ...match(), endedAt: null, outcome: null };
    delete record.details;
    delete record.rating;
    delete record.localReplay;
    manager.controller(player.id).repository.putMatch(record);

    const response = await app.inject({ url: path(record.id, player.id), headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(record);
    expect(response.json()).not.toHaveProperty('details');
  });

  it('未创建 Player 时保持 409，显式未知身份仍返回 404', async () => {
    const { app } = await setup();
    const id = randomUUID();
    expect((await app.inject({ url: `/api/matches/${id}`, headers })).statusCode).toBe(409);
    expect((await app.inject({ url: path(id, 'missing-player'), headers })).statusCode).toBe(404);
  });
});
