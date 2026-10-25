import { ChevronLeft, ChevronRight, History, Inbox } from 'lucide-react';
import { useMatchHistory } from '../hooks/useMatchHistory';
import { MatchHistoryRow } from './MatchHistoryRow';
import { HistoryFilters } from './HistoryFilters';
import { EmptyState, Notice, Spinner } from './Shared';

type Props = {
  refreshKey: string;
};

export function MatchHistory({ refreshKey }: Props) {
  const { data, filters, page, loading, error, applyFilters, setPage, retry } =
    useMatchHistory(refreshKey);
  const hasFilters = Object.values(filters).some((value) => value !== undefined);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20)));

  return (
    <section id="history" className="panel overflow-hidden" aria-labelledby="history-heading">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-7 sm:py-5">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 id="history-heading" className="panel-heading">
              <History size={17} /> 对局历史
            </h2>
            {loading && data && (
              <span className="text-moss">
                <Spinner />
              </span>
            )}
          </div>
          <p className="panel-caption">查询真实对局记录，筛选条件应用于全部历史。</p>
        </div>
        {data && (
          <span className="rounded-full border border-line bg-canvas px-3 py-1 text-[10px] font-medium tabular text-muted">
            {hasFilters ? '已筛选' : '全部'} · {data.total.toLocaleString('zh-CN')} 场
          </span>
        )}
      </header>

      <HistoryFilters onApply={applyFilters} />

      {error && (
        <div className="px-5 py-4 sm:px-7">
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
          className="flex min-h-56 items-center justify-center gap-2.5 text-xs text-muted"
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
                <th>对手 / 对局</th>
                <th className="hidden sm:table-cell">回合</th>
                <th>结果</th>
                <th className="text-right">回放</th>
                <th className="text-right">详情</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((match) => (
                <MatchHistoryRow key={match.id} match={match} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !error && (
          <EmptyState
            icon={<Inbox size={26} />}
            title={hasFilters ? '没有符合条件的真实对局' : '暂无真实对局'}
            description={
              hasFilters
                ? '请调整筛选条件或重置全部后重试。'
                : '启动运行后，真实对局记录会自动出现在这里。'
            }
          />
        )
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas/40 px-5 py-3.5 sm:px-7">
        <span className="text-[11px] text-muted">
          {data
            ? `${hasFilters ? '已筛选' : '共'} ${data.total} 场真实对局 · 每页 ${data.pageSize} 条`
            : '每页 20 条'}
        </span>
        <div className="flex items-center gap-2">
          <button
            className="icon-btn size-8"
            type="button"
            aria-label="上一页"
            disabled={page <= 1 || (!data && loading)}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-14 text-center text-xs tabular text-ink-soft">
            {page}
            <span className="text-faint"> / {totalPages}</span>
          </span>
          <button
            className="icon-btn size-8"
            type="button"
            aria-label="下一页"
            disabled={!data || page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </footer>
    </section>
  );
}
