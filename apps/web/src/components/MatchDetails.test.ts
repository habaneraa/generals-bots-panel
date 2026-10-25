import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MatchRecord, MatchSnapshot } from '../../../../packages/contracts/src/index';
import { MatchDetails } from './MatchDetails';
import { MatchDetailsModal } from './MatchDetailsModal';
import { MatchHistoryRow } from './MatchHistoryRow';

function lastSnapshot(): MatchSnapshot {
  return {
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
}

function matchRecord(): MatchRecord {
  const last = lastSnapshot();
  const initial: MatchSnapshot = {
    ...last,
    turn: 0,
    serverTurn: 1,
    map: null,
    players: last.players.map((player) => ({
      ...player,
      land: 999,
      army: 888,
      cities: 777,
      alive: true,
    })),
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
      initial,
      last,
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
  it('renders only the last recorded snapshot, not the fixed opening values', () => {
    const html = render(matchRecord());
    for (const text of [
      'record-id',
      'run-id',
      'self-player',
      'opponent-player',
      '20 × 15',
      'serverTurn',
      'game_won',
      '4 秒',
      '策略步数',
      '已提交',
      '10 ms',
      '20 ms',
      '已见城市',
      '最后记录的快照不一定是完整终局',
    ])
      expect(html).toContain(text);
    expect(html).not.toContain('999');
    expect(html).not.toContain('888');
    expect(html).not.toContain('首个记录');
    expect(html).not.toContain('公开 ID');
    expect(html).not.toContain('阵营 0');
    expect(html).not.toContain('索引 0');
    expect(html).toContain('aria-label="Star 12"');
    expect(html).toContain('aria-label="Star 0"');
  });

  it('keeps the star next to the player name and omits player index metadata', () => {
    const html = render(matchRecord());
    const namePosition = html.indexOf('self-player');
    const starPosition = html.indexOf('aria-label="Star 12"');
    expect(namePosition).toBeGreaterThan(-1);
    expect(starPosition).toBeGreaterThan(namePosition);
    expect(html).not.toContain('公开 ID');
    expect(html).not.toContain('索引 0');
    expect(html).not.toContain('阵营 0');
  });

  it('distinguishes unavailable stars from an actual zero', () => {
    const match = matchRecord();
    const last = match.details?.last;
    if (!last) throw new Error('Expected a recorded snapshot');
    last.players = last.players.map((player) =>
      player.isSelf ? { ...player, stars: null } : player,
    );
    const html = render(match);
    expect(html).toContain('Star 未获取');
    expect(html).toContain('Star 0');
  });

  it('renders unknown city counts as missing instead of zero', () => {
    const html = render(matchRecord());
    expect(html).toContain('服务器未提供或视野不完整时显示为 —');
    expect(html.match(/最后记录 · /g)).toHaveLength(1);
  });

  it('does not invent counters or snapshots for older records', () => {
    const match = matchRecord();
    delete match.details;
    const html = render(match);
    expect(html).toContain('此记录的快照和 Agent 计步详情未采集');
    expect(html).toContain('未采集');
    expect(html).not.toContain('策略步数');
    expect(html).not.toContain('玩家状态');
    expect(html).not.toContain('地图与规则');
  });
});

describe('MatchDetailsModal', () => {
  it('renders a native dialog wrapper with a close control', () => {
    const html = renderToStaticMarkup(
      createElement(MatchDetailsModal, { match: matchRecord(), onClose: () => {} }),
    );
    expect(html).toContain('<dialog');
    expect(html).toContain('class="modal"');
    expect(html).toContain('aria-labelledby="match-details-title"');
    expect(html).toContain('关闭对局详情');
    expect(html).toContain('game-id');
    expect(html).toContain('self-player');
  });

  it('renders nothing without a selected match', () => {
    const html = renderToStaticMarkup(
      createElement(MatchDetailsModal, { match: null, onClose: () => {} }),
    );
    expect(html).toBe('');
  });
});

describe('MatchHistoryRow', () => {
  it('opens the details dialog instead of expanding inline', () => {
    const html = renderToStaticMarkup(
      createElement(
        'table',
        null,
        createElement(
          'tbody',
          null,
          createElement(MatchHistoryRow, { match: matchRecord(), onOpen: () => {} }),
        ),
      ),
    );
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('打开对局 game-id 详情');
    expect(html).toContain('详情');
    expect(html).not.toContain('aria-expanded');
    expect(html).not.toContain('match-detail-row');
  });
});
