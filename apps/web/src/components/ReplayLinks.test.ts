// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MatchRecord } from '../../../../packages/contracts/src/index';
import { MatchDetailsModal } from './MatchDetailsModal';
import { MatchHistoryRow } from './MatchHistoryRow';

function match(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: 'record-id',
    runId: 'run-id',
    mode: 'live',
    server: 'generals',
    gameId: 'game-1',
    opponent: 'opponent',
    startedAt: '2026-10-25T00:00:00Z',
    endedAt: '2026-10-25T00:01:00Z',
    outcome: 'won',
    turns: 120,
    localReplay: true,
    replayUrl: 'https://generals.io/replays/game-1',
    ...overrides,
  };
}

function renderRow(record: MatchRecord): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    createElement(
      'table',
      null,
      createElement(
        'tbody',
        null,
        createElement(MatchHistoryRow, { match: record, onOpen: () => {} }),
      ),
    ),
  );
  return container;
}

function renderDetails(record: MatchRecord): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    createElement(MatchDetailsModal, { match: record, onClose: () => {} }),
  );
  return container;
}

describe('history replay destinations', () => {
  it.each(['generals', 'bots'] as const)(
    'opens %s recordings in the on-site player, not the official website',
    (server) => {
      const row = renderRow(match({ server }));
      const link = row.querySelector('a')!;
      expect(link.getAttribute('href')).toBe(`/replay#replay=${server}/game-1`);
      expect(link.textContent).toContain('录像');
      expect(link.target).toBe('_blank');
      expect(link.rel).toContain('noopener');
      expect(row.querySelectorAll('a')).toHaveLength(1);
      expect(row.innerHTML).not.toContain('https://generals.io');
    },
  );

  it.each([undefined, false])(
    'does not fall back to an external link without a local recording (%s)',
    (localReplay) => {
      const row = renderRow(match({ localReplay }));
      expect(row.querySelector('a')).toBeNull();
      expect(row.textContent).toContain('未录制');
      expect(row.querySelector('[aria-haspopup="dialog"]')).not.toBeNull();
    },
  );

  it('can open local recordings independently of the official replay URL', () => {
    expect(
      renderRow(match({ replayUrl: null }))
        .querySelector('a')
        ?.getAttribute('href'),
    ).toBe('/replay#replay=generals/game-1');
  });

  it('does not generate an empty replay destination', () => {
    expect(renderRow(match({ gameId: '' })).querySelector('a')).toBeNull();
  });

  it('labels on-site and official replay links separately in the details', () => {
    const details = renderDetails(match());
    const links = [...details.querySelectorAll('a')];
    expect(links).toHaveLength(2);
    expect(links[0]!.textContent).toContain('站内录像');
    expect(links[0]!.getAttribute('href')).toBe('/replay#replay=generals/game-1');
    expect(links[1]!.textContent).toContain('官网回放');
    expect(links[1]!.href).toBe('https://generals.io/replays/game-1');
    expect(links[1]!.rel).toContain('noopener');
  });

  it('retains the official replay in details for older unrecorded games', () => {
    const links = renderDetails(match({ localReplay: undefined })).querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]!.textContent).toContain('官网回放');
    expect(links[0]!.href).toBe('https://generals.io/replays/game-1');
  });

  it('never renders unsafe official replay URLs', () => {
    expect(
      renderDetails(match({ localReplay: false, replayUrl: 'javascript:alert(1)' })).querySelector(
        'a',
      ),
    ).toBeNull();
  });
});
