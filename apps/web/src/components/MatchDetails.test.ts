import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MatchRecord, MatchSnapshot } from '../../../../packages/contracts/src/index';
import { MatchDetails } from './MatchDetails';
import { MatchHistoryRow } from './MatchHistoryRow';

function matchRecord(): MatchRecord {
  const snapshot: MatchSnapshot = {
    turn: 80,
    serverTurn: 160,
    capturedAt: '2026-10-25T06:00:04Z',
    gameType: '1v1',
    teams: [0, 1],
    modifiers: ['speed'],
    torus: false,
    map: { width: 20, height: 15 },
    players: [
      {
        index: 0,
        isSelf: true,
        userId: 'public-self-id',
        username: 'self-player',
        stars: 12,
        team: 0,
        land: 20,
        army: 100,
        cities: 2,
        visibleCities: 2,
        alive: true,
      },
      {
        index: 1,
        isSelf: false,
        userId: null,
        username: 'opponent-player',
        stars: 0,
        team: 1,
        land: 10,
        army: 40,
        cities: null,
        visibleCities: 1,
        alive: false,
      },
    ],
  };
  return {
    id: 'record-id',
    runId: 'run-id',
    mode: 'live',
    server: 'generals',
    gameId: 'game-id',
    opponent: 'opponent-player',
    startedAt: '2026-10-25T06:00:00Z',
    endedAt: '2026-10-25T06:00:04Z',
    outcome: 'won',
    turns: 80,
    replayUrl: null,
    details: {
      initial: { ...snapshot, turn: null, serverTurn: null, map: null },
      last: snapshot,
      durationMs: 4000,
      winnerIndex: 0,
      endReason: 'game_won',
      agent: {
        observations: 8,
        decisions: 4,
        submittedMoves: 3,
        passes: 1,
        skippedMoves: 0,
        splitMoves: 1,
        totalLatencyMs: 40,
        maxLatencyMs: 20,
      },
    },
  };
}

const render = (match: MatchRecord) => renderToStaticMarkup(createElement(MatchDetails, { match }));

describe('MatchDetails', () => {
  it('renders public player values and identifies incomplete terminal information', () => {
    const html = render(matchRecord());
    for (const text of [
      'record-id',
      'run-id',
      'game-id',
      'self-player',
      'opponent-player',
      'public-self-id',
      '公开 ID',
      'Star',
      '20 × 15',
      'serverTurn',
      'game_won',
      '4 秒',
      '策略步数',
      '已提交移动',
      '10 ms',
      '20 ms',
      '最后记录的快照，不一定是完整终局',
      '已提交移动不等于服务器实际执行',
      '已见城市下限',
    ])
      expect(html).toContain(text);
    expect(html).toMatch(/公开 ID：<span[^>]*>服务器未提供<\/span>/);
    expect(html).toContain('Star 0');
    expect(html).toContain('Star 12');
    expect(html).toMatch(/获胜玩家索引<\/dt><dd[^>]*>0<\/dd>/);
  });

  it('merges snapshot identity fields instead of repeating both snapshots', () => {
    const html = render(matchRecord());
    expect(html.match(/public-self-id/g)).toHaveLength(1);
    expect(html.match(/20 × 15/g)).toHaveLength(1);
    expect(html.match(/0 \/ 1/g)).toHaveLength(1);
    expect(html).toContain('首个与最后快照中相同的信息只显示一次');
  });

  it('shows only changed values as first-to-last comparisons', () => {
    const match = matchRecord();
    const initial = match.details?.initial;
    if (!initial) throw new Error('Expected an initial snapshot');
    initial.players = initial.players.map((player) =>
      player.isSelf
        ? { ...player, land: 12, army: 50, cities: 1 }
        : { ...player, alive: true, visibleCities: 0 },
    );
    const html = render(match);
    expect(html).toContain('aria-label="领地：首个记录 12，最后记录 20"');
    expect(html).toContain('aria-label="兵力：首个记录 50，最后记录 100"');
    expect(html).toContain('aria-label="存活：首个记录 存活，最后记录 已出局"');
    expect(html).toContain('aria-label="已见城市下限：首个记录 ≥ 0，最后记录 ≥ 1"');
    expect(html).toMatch(/12<\/span><svg[^>]*>.*?20<\/span>/);
  });

  it('distinguishes unavailable stars from an actual zero', () => {
    const match = matchRecord();
    const details = match.details;
    if (!details?.initial || !details.last) throw new Error('Expected both snapshots');
    const withoutStars = (player: MatchSnapshot['players'][number]) =>
      player.isSelf ? { ...player, stars: null } : player;
    details.initial.players = details.initial.players.map(withoutStars);
    details.last.players = details.last.players.map(withoutStars);
    const html = render(match);
    expect(html).toContain('Star 未获取');
    expect(html).toContain('Star 0');
  });

  it('falls back to the last snapshot for metadata missing from the initial one', () => {
    const html = render(matchRecord());
    expect(html).toContain('记录回合 服务器未提供');
    expect(html).toContain('记录回合 80');
    expect(html).toContain('原始回合（serverTurn） 160');
    expect(html.match(/public-self-id/g)).toHaveLength(1);
  });

  it('does not invent counters or snapshots for older records', () => {
    const match = matchRecord();
    delete match.details;
    const html = render(match);
    expect(html).toContain('此记录的快照和 Agent 计步详情未采集');
    expect(html).toMatch(/时长<\/dt><dd[^>]*>未采集<\/dd>/);
    expect(html).not.toContain('策略步数');
    expect(html).not.toContain('玩家状态');
    expect(html).not.toContain('地图与规则');
  });

  it('keeps each history detail collapsed with an accessible button by default', () => {
    const html = renderToStaticMarkup(
      createElement(
        'table',
        null,
        createElement('tbody', null, createElement(MatchHistoryRow, { match: matchRecord() })),
      ),
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls=');
    expect(html).toContain('class="match-detail-row" hidden=""');
    expect(html).not.toContain('class="match-details');
  });
});
