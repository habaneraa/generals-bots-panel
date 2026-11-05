import { ChevronLeft, ChevronRight, History, Inbox } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MatchRecord, StarHistoryItem } from '../../../../packages/contracts/src/index';
import { api, errorMessage, isAbortError } from '../api/client';
import { usePlayerId } from '../hooks/PlayerScope';
import { useMatchHistory } from '../hooks/useMatchHistory';
import { useStarHistory } from '../hooks/useStarHistory';
import { HistoryFilters } from './HistoryFilters';
import { MatchDetailsModal } from './MatchDetailsModal';
import { MatchHistoryRow } from './MatchHistoryRow';
import { StarHistoryChart } from './StarHistoryChart';
import { EmptyState, Notice, Spinner } from './Shared';

type Props = {
  refreshKey: string;
  starHistoryRefreshKey: string;
};

export function MatchHistory({ refreshKey, starHistoryRefreshKey }: Props) {
  const { data, filters, page, loading, error, applyFilters, setPage, retry } =
    useMatchHistory(refreshKey);
  const starHistory = useStarHistory(filters, starHistoryRefreshKey);
  const [selected, setSelected] = useState<MatchRecord | null>(null);
  const playerId = usePlayerId();
  const [target, setTarget] = useState<{ id: string; playerId: string } | null>(null);
  const [detail, setDetail] = useState<{
    target: NonNullable<typeof target>;
    match?: MatchRecord;
    error?: string;
  } | null>(null);
  const currentTarget = target?.playerId === playerId ? target : null;
  const currentDetail = detail?.target === currentTarget ? detail : null;

  useEffect(() => {
    if (!target || !playerId || target.playerId !== playerId) return;
    const controller = new AbortController();
    let active = true;
    void api.match(target.id, controller.signal, playerId).then(
      (match) => {
        if (active) setDetail({ target, match });
      },
      (error: unknown) => {
        if (active && !isAbortError(error)) setDetail({ target, error: errorMessage(error) });
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [target, playerId]);

  function openHistoryMatch(match: StarHistoryItem) {
    if (!playerId) return;
    setSelected(null);
    setTarget({ id: match.id, playerId });
  }

  function closeDetails() {
    setTarget(null);
    setSelected(null);
  }

  const openedMatch = currentTarget ? (currentDetail?.match ?? null) : selected;
  const hasFilters = Object.values(filters).some((value) => value !== undefined);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20)));

  return (
    <section id="history" className="panel overflow-hidden" aria-labelledby="history-heading">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="history-heading" className="panel-heading">
              <History size={14} /> 对局历史
            </h2>
            {loading && data && (
              <span className="text-teal">
                <Spinner />
              </span>
            )}
          </div>
        </div>
        {data && (
          <span className="rounded-[2px] border border-line bg-canvas px-2 py-0.5 text-[9.5px] font-medium tabular text-muted">
            {hasFilters ? '已筛选' : '全部'} · {data.total.toLocaleString('zh-CN')} 场
          </span>
        )}
      </header>

      <HistoryFilters onApply={applyFilters} />

      {starHistory.data && (
        <StarHistoryChart matches={starHistory.data.items} onOpenMatch={openHistoryMatch} />
      )}
      {currentTarget && !currentDetail && (
        <div className="flex items-center gap-2 px-4 py-3 text-[11px] text-muted" role="status">
          <Spinner /> 正在打开对局…
          <button type="button" className="btn btn-ghost btn-sm" onClick={closeDetails}>
            取消
          </button>
        </div>
      )}
      {currentDetail?.error && (
        <div className="px-4 py-2.5">
          <Notice
            action={
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => setTarget({ ...currentTarget! })}
              >
                重试
              </button>
            }
          >
            对局读取失败：{currentDetail.error}
          </Notice>
        </div>
      )}
      {!starHistory.data && starHistory.loading && (
        <div className="flex items-center gap-2 px-4 py-3 text-[11px] text-muted" role="status">
          <Spinner /> 正在读取 Star 历史…
        </div>
      )}
      {starHistory.error && (
        <div className="px-4 py-2.5">
          <Notice
            action={
              <button className="btn btn-danger btn-sm" type="button" onClick={starHistory.retry}>
                重试 Star 历史
              </button>
            }
          >
            Star 历史读取失败：{starHistory.error}
          </Notice>
        </div>
      )}

      {error && (
        <div className="px-4 py-2.5">
          <Notice
            action={
              <button className="btn btn-danger btn-sm" type="button" onClick={retry}>
                重试
              </button>
            }
          >
            {error}
          </Notice>
        </div>
      )}

      {!data && loading ? (
        <div
          className="flex min-h-44 items-center justify-center gap-2 text-[11px] text-muted"
          role="status"
        >
          <Spinner /> 正在读取对局记录…
        </div>
      ) : data?.items.length ? (
        <div className="overflow-visible sm:overflow-x-auto">
          <table className="data-table match-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>对手</th>
                <th>对局 ID</th>
                <th className="hidden sm:table-cell">回合</th>
                <th>结果</th>
                <th>Star 变化</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((match) => (
                <MatchHistoryRow
                  key={match.id}
                  match={match}
                  onOpen={() => {
                    setTarget(null);
                    setSelected(match);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !error && (
          <EmptyState
            icon={<Inbox size={22} />}
            title={hasFilters ? '没有符合条件的真实对局' : '暂无真实对局'}
            description={
              hasFilters
                ? '请调整筛选条件或重置全部后重试。'
                : '启动运行后，真实对局记录会自动出现在这里。'
            }
          />
        )
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-subtle px-4 py-2.5">
        <span className="text-[10px] text-muted">
          {data
            ? `${hasFilters ? '已筛选' : '共'} ${data.total} 场真实对局 · 每页 ${data.pageSize} 条`
            : '每页 20 条'}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            className="icon-btn size-7"
            type="button"
            aria-label="上一页"
            disabled={page <= 1 || (!data && loading)}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={13} />
          </button>
          <span className="min-w-12 text-center text-[10.5px] tabular text-ink-soft">
            {page}
            <span className="text-faint"> / {totalPages}</span>
          </span>
          <button
            className="icon-btn size-7"
            type="button"
            aria-label="下一页"
            disabled={!data || page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </footer>

      <MatchDetailsModal
        match={data?.items.find((match) => match.id === openedMatch?.id) ?? openedMatch}
        onClose={closeDetails}
      />
    </section>
  );
}
