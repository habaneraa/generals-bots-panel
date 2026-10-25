import { ArrowUpRight, ChevronRight } from 'lucide-react';
import type { MatchRecord } from '../../../../packages/contracts/src/index';
import { formatDateTime, localReplayHref } from '../lib/format';
import { OutcomeBadge } from './OutcomeBadge';
import { StarChange } from './StarChange';

export function MatchHistoryRow({ match, onOpen }: { match: MatchRecord; onOpen: () => void }) {
  const replay = localReplayHref(match);

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
      </td>
      <td>
        <span className="flex max-w-[190px] items-center gap-1.5">
          <span className="mono truncate text-[9.5px] text-faint" title={match.gameId}>
            {match.gameId || '等待分配'}
          </span>
          <span className="shrink-0 rounded-[2px] bg-canvas px-1 py-px text-[8.5px] uppercase tracking-[0.06em] text-muted">
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
      <td>
        <StarChange match={match} />
      </td>
      <td className="text-right">
        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
          {replay ? (
            <a
              className="inline-flex items-center gap-0.5 text-[10.5px] font-medium text-muted transition-colors hover:text-teal-dark"
              href={replay}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`在站内播放器打开对局 ${match.gameId}`}
              title="在新窗口打开站内录像"
            >
              录像 <ArrowUpRight size={11} aria-hidden="true" />
            </a>
          ) : (
            <span
              className="text-[10.5px] text-faint"
              title="本机未采集此局录像，官网回放可在详情中查看"
            >
              未录制
            </span>
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
