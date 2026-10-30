import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { MatchFilters, MatchRecord } from '../../../../packages/contracts/src/index.js';
import { createApp } from '../app.js';
import { PlayerManager } from '../player-manager.js';
import type { Repository } from './repository.js';

const resources: {
  dir: string;
  repo: Repository;
  manager: PlayerManager;
  app?: FastifyInstance;
}[] = [];
afterEach(async () => {
  for (const { dir, manager, app } of resources.splice(0)) {
    try {
      await app?.close();
    } finally {
      await manager.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'panel-filters-'));
  const manager = new PlayerManager(
    dir,
    dir,
    async () => {
      throw new Error('Network access is forbidden in storage tests');
    },
    async () => 'test player',
  );
  await manager.add({ server: 'bots', userId: 'test-account' });
  const resource: (typeof resources)[number] = {
    dir,
    manager,
    repo: manager.controller().repository,
  };
  resources.push(resource);
  return resource;
}
function match(id: string, overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id,
    runId: 'filter-run',
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
function ids(repo: Repository, filters: MatchFilters = {}) {
  return repo.matches(1, 100, filters).items.map((record) => record.id);
}

describe('match field filters', () => {
  it('combines every filter with AND and matches server/outcome exactly', async () => {
    const { repo } = await fixture();
    const target = match('target', {
      opponent: 'prefix Needle suffix',
      gameId: 'prefix-42-suffix',
    });
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
    const filters: MatchFilters = {
      server: 'bots',
      outcome: 'won',
      opponent: 'Needle',
      gameId: '42',
      startedAfter: target.startedAt,
      startedBefore: target.startedAt,
      minTurns: 10,
      maxTurns: 10,
    };
    expect(repo.matches(1, 20, filters)).toMatchObject({ items: [target], total: 1 });
    expect(ids(repo, { server: 'generals' })).toEqual(['excluded-0']);
    expect(ids(repo, { outcome: 'lost' })).toEqual(['excluded-1']);
  });

  it.each(['gameId', 'opponent'] as const)(
    'treats LIKE metacharacters and SQL text literally in %s',
    async (field) => {
      const { repo } = await fixture();
      const samples = ['%', '_', '\\', 'a%_\\b', "' OR 1=1 --"];
      samples.forEach((value, index) =>
        repo.putMatch(match(`literal-${index}`, { [field]: `prefix${value}suffix` })),
      );
      repo.putMatch(match('decoy', { [field]: 'prefixaXYZbsuffix' }));
      for (const [index, value] of samples.entries()) {
        const expected =
          value === '%' || value === '_' || value === '\\'
            ? ['literal-3', `literal-${index}`]
            : [`literal-${index}`];
        expect(ids(repo, { [field]: value })).toEqual(expected);
      }
      expect(repo.matches(1, 20, { [field]: '%' }).total).toBe(2);
    },
  );

  it('uses inclusive UTC boundaries and normalizes positive and negative timezone offsets', async () => {
    const { repo } = await fixture();
    repo.putMatch(match('before', { startedAt: '2026-10-24T23:59:59.999Z' }));
    repo.putMatch(match('lower'));
    repo.putMatch(match('upper', { startedAt: '2026-10-25T01:00:00.000Z' }));
    repo.putMatch(match('after', { startedAt: '2026-10-25T01:00:00.001Z' }));
    expect(
      ids(repo, {
        startedAfter: '2026-10-25T08:00:00+08:00',
        startedBefore: '2026-10-24T20:00:00-05:00',
      }),
    ).toEqual(['upper', 'lower']);
    expect(
      ids(repo, {
        startedAfter: '2026-10-25T00:00:00Z',
        startedBefore: '2026-10-25T00:00:00Z',
      }),
    ).toEqual(['lower']);
    expect(ids(repo, { startedAfter: '2026-10-25T01:00:00Z' })).toEqual(['after', 'upper']);
    expect(ids(repo, { startedBefore: '2026-10-25T00:00:00Z' })).toEqual(['lower', 'before']);
  });

  it('distinguishes ongoing games from every finished outcome including interruptions', async () => {
    const { repo } = await fixture();
    for (const outcome of ['won', 'lost', 'draw', 'interrupted', null] as const) {
      repo.putMatch(
        match(outcome ?? 'playing', {
          outcome,
          endedAt: outcome ? '2026-10-25T00:01:00.000Z' : null,
        }),
      );
    }
    for (const outcome of ['won', 'lost', 'draw', 'interrupted', 'playing'] as const) {
      expect(ids(repo, { outcome })).toEqual([outcome]);
      expect(repo.matches(1, 20, { outcome }).total).toBe(1);
    }
  });

  it('includes turn boundaries and supports either side of the range including zero', async () => {
    const { repo } = await fixture();
    for (const turns of [0, 9, 10, 20, 21]) repo.putMatch(match(`turn-${turns}`, { turns }));
    expect(ids(repo, { minTurns: 10, maxTurns: 20 })).toEqual(['turn-20', 'turn-10']);
    expect(ids(repo, { minTurns: 20 })).toEqual(['turn-21', 'turn-20']);
    expect(ids(repo, { maxTurns: 9 })).toEqual(['turn-9', 'turn-0']);
    expect(ids(repo, { minTurns: 0, maxTurns: 0 })).toEqual(['turn-0']);
  });

  it('keeps stable timestamp ties and filtered counts across pages including empty pages', async () => {
    const { repo } = await fixture();
    repo.putMatch(match('older', { startedAt: '2026-10-24T00:00:00.000Z' }));
    for (const id of ['first', 'second', 'third']) repo.putMatch(match(id));
    repo.putMatch(match('excluded', { server: 'generals', startedAt: '2026-10-26T00:00:00.000Z' }));
    expect(repo.matches(1, 2, { server: 'bots' })).toMatchObject({
      total: 4,
      page: 1,
      pageSize: 2,
    });
    expect(repo.matches(1, 2, { server: 'bots' }).items.map((record) => record.id)).toEqual([
      'third',
      'second',
    ]);
    expect(repo.matches(2, 2, { server: 'bots' }).items.map((record) => record.id)).toEqual([
      'first',
      'older',
    ]);
    expect(repo.matches(2, 2, { server: 'bots' }).total).toBe(4);
    expect(repo.matches(3, 2, { server: 'bots' })).toEqual({
      items: [],
      total: 4,
      page: 3,
      pageSize: 2,
    });
    expect(repo.matches(1, 20, { opponent: 'absent' })).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });

  it('returns empty history and zero statistics for a new database', async () => {
    const { repo } = await fixture();
    expect(repo.matches()).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    expect(repo.stats()).toEqual({
      total: 0,
      won: 0,
      lost: 0,
      draw: 0,
      interrupted: 0,
      winRate: 0,
    });
  });
});

async function apiFixture() {
  const resource = await fixture();
  resource.app = await createApp(resource.manager, join(resource.dir, 'no-web'));
  return { ...resource, app: resource.app };
}
const headers = { host: 'localhost:3000' };

describe('GET /api/matches query validation', () => {
  it('uses shared defaults and passes parsed combined filters and pagination to storage', async () => {
    const { repo, app } = await apiFixture();
    repo.putMatch(match('target', { opponent: 'prefix %_\\ suffix', gameId: 'prefix-42-suffix' }));
    repo.putMatch(match('excluded', { server: 'generals' }));
    const defaultResponse = await app.inject({ method: 'GET', url: '/api/matches', headers });
    expect(defaultResponse.statusCode).toBe(200);
    expect(defaultResponse.json()).toMatchObject({ total: 2, page: 1, pageSize: 20 });
    const query = new URLSearchParams({
      page: '1',
      pageSize: '1',
      server: 'bots',
      outcome: 'won',
      opponent: '  %_\\  ',
      gameId: '42',
      startedAfter: '2026-10-25T08:00:00+08:00',
      startedBefore: '2026-10-24T19:00:00-05:00',
      minTurns: '10',
      maxTurns: '10',
    });
    const response = await app.inject({ method: 'GET', url: `/api/matches?${query}`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 1,
      items: [{ id: 'target' }],
    });
    query.set('page', '2');
    const emptyPage = await app.inject({ method: 'GET', url: `/api/matches?${query}`, headers });
    expect(emptyPage.json()).toEqual({ total: 1, page: 2, pageSize: 1, items: [] });
  });

  it.each([
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: 'NaN' },
    { page: '1000001' },
    { pageSize: '0' },
    { pageSize: '101' },
    { pageSize: '1.5' },
    { server: 'other' },
    { outcome: 'ongoing' },
    { mode: 'demo' },
    { mode: 'live' },
    { unknown: 'x' },
    { startedAfter: 'not-a-date' },
    { startedBefore: '2026-10-25' },
    { startedAfter: '2026-02-30T00:00:00Z' },
    { startedBefore: '2026-10-25T00:00:00' },
    { startedAfter: '2026-10-25T08:00:01+08:00', startedBefore: '2026-10-25T00:00:00Z' },
    { minTurns: '-1' },
    { maxTurns: '1.5' },
    { minTurns: 'NaN' },
    { maxTurns: '10000001' },
    { minTurns: '11', maxTurns: '10' },
    { opponent: 'x'.repeat(201) },
    { gameId: 'x'.repeat(257) },
  ])('rejects invalid or unknown query %j with 400', async (query) => {
    const { app } = await apiFixture();
    const response = await app.inject({
      method: 'GET',
      url: `/api/matches?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`,
      headers,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toEqual(expect.any(String));
  });

  it('accepts equal zero-turn boundaries and playing/interrupted filters without conflating them', async () => {
    const { repo, app } = await apiFixture();
    repo.putMatch(match('playing', { outcome: null, endedAt: null, turns: 0 }));
    repo.putMatch(match('interrupted', { outcome: 'interrupted', turns: 0 }));
    for (const outcome of ['playing', 'interrupted']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/matches?outcome=${outcome}&minTurns=0&maxTurns=0`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ total: 1, items: [{ id: outcome }] });
    }
  });
});
