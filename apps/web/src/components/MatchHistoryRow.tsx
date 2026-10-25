import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import type { MatchRecord } from '../../../../packages/contracts/src/index';
import { formatDateTime, replayHref } from '../lib/format';
import { MatchDetails } from './MatchDetails';
import { OutcomeBadge } from './OutcomeBadge';

export function MatchHistoryRow({ match }: { match: MatchRecord }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const replay = replayHref(match.replayUrl);

  return (
    <>
      <tr className="match-row">
        <td className="whitespace-nowrap text-xs tabular text-muted">
          <time dateTime={match.startedAt}>{formatDateTime(match.startedAt)}</time>
        </td>
        <td>
          <span
            className="block max-w-[200px] truncate text-[13px] font-medium text-ink"
            title={match.opponent || '服务器未提供'}
          >
            {match.opponent || '—'}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-[10px] text-faint">
            <span className="mono max-w-[130px] truncate" title={match.gameId}>
              {match.gameId || '等待分配'}
            </span>
            <span className="rounded bg-canvas px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-muted">
              {match.server}
            </span>
          </span>
        </td>
        <td className="hidden whitespace-nowrap text-xs tabular text-muted sm:table-cell">
          {match.turns}
        </td>
        <td>
          <OutcomeBadge outcome={match.outcome} />
        </td>
        <td className="text-right">
          {replay ? (
            <a
              className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-moss transition-colors hover:text-forest-800"
              href={replay}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`在新窗口回放对局 ${match.gameId}`}
            >
              回放 <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          ) : (
            <span className="text-xs text-faint">—</span>
          )}
        </td>
        <td className="text-right">
          <button
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium text-moss transition-colors hover:bg-canvas hover:text-forest-800"
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-label={`${expanded ? '收起' : '展开'}对局 ${match.gameId || match.id} 详情`}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? '收起' : '详情'}
            <ChevronDown
              size={14}
              className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
        </td>
      </tr>
      <tr id={detailsId} className="match-detail-row" hidden={!expanded}>
        <td colSpan={6} className="p-0">
          {expanded && <MatchDetails match={match} />}
        </td>
      </tr>
    </>
  );
}
