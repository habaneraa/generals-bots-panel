import { ArrowUpRight, ChevronRight } from 'lucide-react';
import type { MatchRecord } from '../../../../packages/contracts/src/index';
import { formatDateTime, replayHref } from '../lib/format';
import { OutcomeBadge } from './OutcomeBadge';

export function MatchHistoryRow({ match, onOpen }: { match: MatchRecord; onOpen: () => void }) {
  const replay = replayHref(match.replayUrl);

  return (
    <tr className="match-row">
      <td className="whitespace-nowrap text-[10.5px] tabular text-muted">
        <time dateTime={match.startedAt}>{formatDateTime(match.startedAt)}</time>
      </td>
      <td>
        <span
          className="block max-w-[190px] truncate text-xs font-medium text-ink"
          title={match.opponent || '服务器未提供'}
        >
          {match.opponent || '—'}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[9.5px] text-faint">
          <span className="mono max-w-[120px] truncate" title={match.gameId}>
            {match.gameId || '等待分配'}
          </span>
          <span className="rounded-[2px] bg-canvas px-1 py-px text-[8.5px] uppercase tracking-[0.06em] text-muted">
            {match.server}
          </span>
        </span>
      </td>
      <td className="hidden whitespace-nowrap text-[10.5px] tabular text-muted sm:table-cell">
        {match.turns}
      </td>
      <td>
        <OutcomeBadge outcome={match.outcome} />
      </td>
      <td className="text-right">
        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
          {replay ? (
            <a
              className="inline-flex items-center gap-0.5 text-[10.5px] font-medium text-muted transition-colors hover:text-teal-dark"
              href={replay}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`在新窗口回放对局 ${match.gameId}`}
            >
              回放 <ArrowUpRight size={11} aria-hidden="true" />
            </a>
          ) : (
            <span className="text-[10.5px] text-faint">—</span>
          )}
          <span className="h-3 w-px bg-line" aria-hidden="true" />
          <button
            className="inline-flex items-center gap-0.5 text-[10.5px] font-medium text-teal transition-colors hover:text-teal-dark"
            type="button"
            aria-haspopup="dialog"
            aria-label={`打开对局 ${match.gameId || match.id} 详情`}
            onClick={onOpen}
          >
            详情
            <ChevronRight size={11} aria-hidden="true" />
          </button>
        </div>
      </td>
    </tr>
  );
}
