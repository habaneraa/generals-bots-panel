import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  MatchFilters,
  MatchRecord,
  StarHistoryResponse,
} from '../../../../packages/contracts/src/index.js';
import { createApp } from '../app.js';
import { Controller } from '../controller.js';
import { Repository } from './repository.js';

const resources: { dir: string; repo: Repository; app?: FastifyInstance }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { dir, repo, app } of resources.splice(0)) {
    try {
      await app?.close();
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'panel-star-history-'));
  const resource: (typeof resources)[number] = { dir, repo: new Repository(dir) };
  resources.push(resource);
  return resource;
}
function match(id: string, overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id,
    runId: 'history-run',
    mode: 'live',
    server: 'bots',
    gameId: `game-${id}`,
    opponent: 'opponent',
    startedAt: '2026-10-25T00:00:00.000Z',
    endedAt: '2026-10-25T00:01:00.000Z',
    outcome: 'won',
    turns: 10,
    replayUrl: null,
    ...overrides,
  };
}
async function apiFixture() {
  const resource = fixture();
  const controller = new Controller(resource.repo, resource.dir, async () => {
    throw new Error('Network access is forbidden in star history tests');
  });
  resource.app = await createApp(controller, join(resource.dir, 'no-web'));
  return { ...resource, app: resource.app };
}
const headers = { host: 'localhost:3000' };
const endpoint = '/api/matches/star-history';

describe('lightweight star history', () => {
  it('returns all 35 matches in ascending order while keeping existing pagination unchanged', async () => {
    const { repo, app } = await apiFixture();
    for (let index = 34; index >= 0; index--) {
      repo.putMatch(
        match(`match-${index}`, {
          startedAt: new Date(Date.UTC(2026, 9, 25, 0, index)).toISOString(),
        }),
      );
    }
    const response = await app.inject({ method: 'GET', url: endpoint, headers });
    expect(response.statusCode).toBe(200);
    const history = response.json<StarHistoryResponse>();
    expect(Object.keys(history)).toEqual(['items']);
    expect(history.items.map((item) => item.id)).toEqual(
      Array.from({ length: 35 }, (_, index) => `match-${index}`),
    );
    const firstPage = await app.inject({ method: 'GET', url: '/api/matches', headers });
    expect(firstPage.json()).toMatchObject({ total: 35, page: 1, pageSize: 20 });
    expect(firstPage.json().items).toHaveLength(20);
    expect(firstPage.json().items[0].id).toBe('match-34');
    const secondPage = await app.inject({
      method: 'GET',
      url: '/api/matches?page=2&pageSize=20',
      headers,
    });
    expect(secondPage.json()).toMatchObject({ total: 35, page: 2, pageSize: 20 });
    expect(secondPage.json().items).toHaveLength(15);
    expect(secondPage.json().items[0].id).toBe('match-14');
  });

  it('retains missing, null and empty ratings and orders timestamp ties by insertion', () => {
    const { repo } = fixture();
    repo.putMatch(match('missing', { endedAt: null }));
    repo.putMatch({ ...match('null'), rating: null } as unknown as MatchRecord);
    repo.putMatch({ ...match('empty'), rating: {} } as MatchRecord);
    repo.putMatch(
      match('unknown', {
        rating: {
          username: null,
          before: null,
          after: null,
          source: null,
          capturedAt: null,
          delta: null,
        },
      }),
    );
    const { items } = repo.starHistory();
    expect(items.map((item) => item.id)).toEqual(['missing', 'null', 'empty', 'unknown']);
    expect(items[0]?.endedAt).toBeNull();
    expect(items[1]?.endedAt).toBe('2026-10-25T00:01:00.000Z');
    expect(items[0]).not.toHaveProperty('rating');
    expect(items[1]).not.toHaveProperty('rating');
    expect(items[2]?.rating).toEqual(items[3]?.rating);
    expect(items[3]?.rating?.after).toBeNull();
  });

  it('projects only allowed fields without parsing details, replay or credentials into JavaScript', async () => {
    const { repo, app } = await apiFixture();
    const secret = 'private-credential-sentinel';
    const rating = {
      username: 'player',
      before: 10,
      after: 12,
      source: 'terminal' as const,
      capturedAt: '2026-10-25T00:01:00.000Z',
      delta: 2,
    };
    const record = {
      ...match('sensitive'),
      details: { userId: secret, huge: 'heavy-detail-sentinel'.repeat(10000) },
      replay: { frames: 'heavy-replay-sentinel'.repeat(10000) },
      config: { userIdFile: secret, login: secret },
      credentials: secret,
      userId: secret,
      rating: { ...rating, userId: secret, credentials: secret },
    };
    repo.putMatch(record as unknown as MatchRecord);
    const parse = vi.spyOn(JSON, 'parse');
    expect(repo.starHistory()).toEqual({
      items: [
        {
          id: record.id,
          runId: record.runId,
          server: record.server,
          gameId: record.gameId,
          startedAt: record.startedAt,
          endedAt: record.endedAt,
          rating,
        },
      ],
    });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse.mock.calls[0]?.[0]).toBe(JSON.stringify(rating));
    parse.mockRestore();
    const response = await app.inject({ method: 'GET', url: endpoint, headers });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(secret);
    expect(response.body).not.toContain('heavy-detail-sentinel');
    expect(response.body).not.toContain('heavy-replay-sentinel');
    expect(Object.keys(response.json().items[0]).sort()).toEqual(
      ['id', 'runId', 'server', 'gameId', 'startedAt', 'endedAt', 'rating'].sort(),
    );
  });

  it('combines every existing filter with AND, using inclusive normalized date boundaries', async () => {
    const { repo, app } = await apiFixture();
    const target = match('target', { opponent: 'prefix %_\\ suffix', gameId: 'prefix-42-suffix' });
    repo.putMatch(target);
    const exclusions: Partial<MatchRecord>[] = [
      { server: 'generals' },
      { outcome: 'lost' },
      { opponent: 'other' },
      { gameId: 'other' },
      { startedAt: '2026-10-24T23:59:59.999Z' },
      { startedAt: '2026-10-25T00:00:00.001Z' },
      { turns: 9 },
      { turns: 11 },
    ];
    exclusions.forEach((overrides, index) =>
      repo.putMatch({ ...target, ...overrides, id: `excluded-${index}` }),
    );
    const query = new URLSearchParams({
      server: 'bots',
      outcome: 'won',
      opponent: '  %_\\  ',
      gameId: '42',
      startedAfter: '2026-10-25T08:00:00+08:00',
      startedBefore: '2026-10-24T19:00:00-05:00',
      minTurns: '10',
      maxTurns: '10',
    });
    const response = await app.inject({ method: 'GET', url: `${endpoint}?${query}`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.map((item: { id: string }) => item.id)).toEqual(['target']);
  });

  it.each<MatchFilters>([
    { server: 'generals' },
    { outcome: 'won' },
    { outcome: 'lost' },
    { outcome: 'draw' },
    { outcome: 'interrupted' },
    { outcome: 'playing' },
    { opponent: '%' },
    { opponent: '_' },
    { opponent: '\\' },
    { gameId: "' OR 1=1 --" },
    { startedAfter: '2026-10-25T08:01:00+08:00' },
    { startedBefore: '2026-10-24T19:03:00-05:00' },
    { minTurns: 0, maxTurns: 0 },
    { minTurns: 2 },
    { maxTurns: 3 },
  ])('uses identical filter semantics to paginated matches for %j', (filters) => {
    const { repo } = fixture();
    const outcomes = ['won', 'lost', 'draw', 'interrupted', null] as const;
    outcomes.forEach((outcome, index) =>
      repo.putMatch(
        match(`filter-${index}`, {
          server: index % 2 ? 'generals' : 'bots',
          outcome,
          opponent: index % 2 ? 'literal %_\\' : 'ordinary',
          gameId: index % 2 ? "literal ' OR 1=1 --" : 'ordinary',
          startedAt: new Date(Date.UTC(2026, 9, 25, 0, index)).toISOString(),
          turns: index,
        }),
      ),
    );
    expect(repo.starHistory(filters).items.map((item) => item.id)).toEqual(
      repo
        .matches(1, 100, filters)
        .items.map((item) => item.id)
        .reverse(),
    );
  });

  it('returns an empty response for an empty repository or no matching records', () => {
    const { repo } = fixture();
    expect(repo.starHistory()).toEqual({ items: [] });
    repo.putMatch(match('other'));
    expect(repo.starHistory({ opponent: 'absent' })).toEqual({ items: [] });
  });

  it.each([
    { page: '1' },
    { pageSize: '1' },
    { server: 'other' },
    { outcome: 'ongoing' },
    { unknown: 'x' },
    { startedAfter: 'not-a-date' },
    { startedBefore: '2026-10-25' },
    { startedAfter: '2026-10-26T00:00:00Z', startedBefore: '2026-10-25T00:00:00Z' },
    { minTurns: '-1' },
    { maxTurns: '1.5' },
    { minTurns: '11', maxTurns: '10' },
  ])('rejects pagination and invalid filters %j with 400', async (query) => {
    const { app } = await apiFixture();
    const response = await app.inject({
      method: 'GET',
      url: `${endpoint}?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`,
      headers,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toEqual(expect.any(String));
  });
});
