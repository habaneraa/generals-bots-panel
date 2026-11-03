import { Download, ListFilter, Terminal } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry, LogLevel } from '../../../../packages/contracts/src/index';
import { api, errorMessage, isAbortError, playerPath } from '../api/client';
import { usePlayerId } from '../hooks/PlayerScope';
import { formatTime } from '../lib/format';

type Props = { entries: LogEntry[]; runId: string | null; active: boolean };

const levelTone: Record<LogLevel, string> = {
  info: 'text-teal-dark',
  warn: 'text-warn',
  error: 'text-danger',
  debug: 'text-faint',
};

const levelOrder: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function mergeEntries(...groups: LogEntry[][]): LogEntry[] {
  const unique = new Map<number, LogEntry>();
  for (const entry of groups.flat()) unique.set(entry.id, entry);
  return [...unique.values()].sort((a, b) => a.id - b.id);
}

export function LogsPanel({ entries, runId, active }: Props) {
  const playerId = usePlayerId();
  const controlId = useId();
  const [level, setLevel] = useState<LogLevel | 'all'>('all');
  const [follow, setFollow] = useState(true);
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pageRequest = useRef<AbortController | null>(null);
  const liveRequest = useRef<AbortController | null>(null);
  const previousEntries = useRef(entries);
  const liveCursor = useRef<number | null>(null);
  const liveTarget = useRef<number | null>(null);
  const restoreViewport = useRef<{ top: number; height: number } | null>(null);
  const [reconcileVersion, setReconcileVersion] = useState(0);
  const scopeKey = `${playerId ?? ''}\u0000${runId ?? ''}`;
  const scope = useRef(scopeKey);
  const allEntries = useMemo(() => mergeEntries(history, entries), [history, entries]);
  const visible = useMemo(
    () =>
      level === 'all'
        ? allEntries
        : allEntries.filter((entry) => levelOrder[entry.level] >= levelOrder[level]),
    [allEntries, level],
  );

  useEffect(() => {
    if (scope.current === scopeKey) return;
    scope.current = scopeKey;
    pageRequest.current?.abort();
    liveRequest.current?.abort();
    pageRequest.current = null;
    liveRequest.current = null;
    setHistory([]);
    setHasMore(true);
    setLoadingOlder(false);
    setHistoryError(null);
    restoreViewport.current = null;
    previousEntries.current = [];
    liveCursor.current = null;
    liveTarget.current = null;
  }, [playerId, runId, scopeKey]);

  useEffect(
    () => () => {
      pageRequest.current?.abort();
      liveRequest.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const currentIds = new Set(entries.map((entry) => entry.id));
    const dropped = previousEntries.current.filter((entry) => !currentIds.has(entry.id));
    previousEntries.current = entries;
    if (dropped.length) setHistory((current) => mergeEntries(current, dropped));
  }, [entries]);

  useEffect(() => {
    const latest = entries.at(-1)?.id;
    if (!runId || !playerId || latest === undefined) return;
    liveTarget.current = Math.max(liveTarget.current ?? latest, latest);
    if (liveCursor.current === null) {
      liveCursor.current = latest;
      return;
    }
    if (liveTarget.current <= liveCursor.current + 1 || liveRequest.current) return;

    const request = new AbortController();
    let failed = false;
    liveRequest.current = request;
    void (async () => {
      let cursor = liveCursor.current!;
      const target = liveTarget.current!;
      while (cursor < target && !request.signal.aborted) {
        const page = await api.logs(runId, { afterId: cursor }, request.signal, playerId);
        if (request.signal.aborted) return;
        if (!page.entries.length) {
          cursor = target;
          break;
        }
        setHistory((current) => mergeEntries(current, page.entries));
        const next = page.entries.at(-1)!.id;
        if (next <= cursor) {
          cursor = target;
          break;
        }
        cursor = next;
      }
      liveCursor.current = cursor;
    })()
      .catch((error: unknown) => {
        failed = true;
        if (!isAbortError(error)) setHistoryError(errorMessage(error));
      })
      .finally(() => {
        if (liveRequest.current === request) liveRequest.current = null;
        if (request.signal.aborted || failed) return;
        if ((liveTarget.current ?? 0) > (liveCursor.current ?? 0) + 1)
          setReconcileVersion((value) => value + 1);
      });
  }, [entries, playerId, reconcileVersion, runId]);

  useLayoutEffect(() => {
    if (!viewport.current) return;
    if (restoreViewport.current) {
      const previous = restoreViewport.current;
      viewport.current.scrollTop = previous.top + (viewport.current.scrollHeight - previous.height);
      restoreViewport.current = null;
      return;
    }
    if (active && follow) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [active, follow, visible]);

  const loadOlder = async () => {
    const oldestId = allEntries[0]?.id;
    if (!runId || !playerId || oldestId === undefined || loadingOlder) return;
    pageRequest.current?.abort();
    const request = new AbortController();
    pageRequest.current = request;
    if (viewport.current) {
      restoreViewport.current = {
        top: viewport.current.scrollTop,
        height: viewport.current.scrollHeight,
      };
    }
    setLoadingOlder(true);
    setHistoryError(null);
    try {
      const page = await api.logs(runId, { beforeId: oldestId }, request.signal, playerId);
      if (request.signal.aborted) return;
      if (page.entries.length) setHistory((current) => mergeEntries(page.entries, current));
      else restoreViewport.current = null;
      setHasMore(page.hasMore);
    } catch (error) {
      if (!isAbortError(error)) setHistoryError(errorMessage(error));
      restoreViewport.current = null;
    } finally {
      if (pageRequest.current === request) {
        pageRequest.current = null;
        setLoadingOlder(false);
      }
    }
  };

  return (
    <section id="logs" className="panel overflow-hidden" aria-labelledby="logs-heading">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 id="logs-heading" className="panel-heading">
            <Terminal size={14} /> 实时日志
          </h2>
          <p className="panel-caption">最新记录实时更新 · 可加载本轮完整历史</p>
        </div>
        {runId && playerId ? (
          <a
            className="icon-btn"
            href={playerPath(`/api/runs/${encodeURIComponent(runId)}/logs/download`, playerId)}
            aria-label="下载本轮完整 JSONL 日志"
            title="下载完整 JSONL 日志"
          >
            <Download size={14} />
          </a>
        ) : (
          <button className="icon-btn" disabled aria-label="暂无可下载日志">
            <Download size={14} />
          </button>
        )}
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-subtle px-4 py-2">
        <label
          className="flex items-center gap-1.5 text-[10px] text-muted"
          htmlFor={`${controlId}-level`}
        >
          <ListFilter size={11} />
          <span className="sr-only">日志级别</span>
          <select
            id={`${controlId}-level`}
            name={`${controlId}-level`}
            className="cursor-pointer rounded-[2px] border border-line bg-surface px-1.5 py-1 text-[10px] text-ink-soft focus:border-teal focus:outline-none"
            value={level}
            onChange={(event) => setLevel(event.target.value as LogLevel | 'all')}
            aria-label="日志级别筛选"
          >
            <option value="all">全部级别</option>
            <option value="debug">DEBUG 及以上</option>
            <option value="info">INFO 及以上</option>
            <option value="warn">WARN 及以上</option>
            <option value="error">ERROR 及以上</option>
          </select>
        </label>
        <label
          className="flex cursor-pointer items-center gap-1.5 text-[10px] text-muted"
          htmlFor={`${controlId}-follow`}
        >
          <input
            id={`${controlId}-follow`}
            name={`${controlId}-follow`}
            className="size-3 accent-teal"
            type="checkbox"
            checked={follow}
            onChange={(event) => setFollow(event.target.checked)}
          />
          <span>自动跟随</span>
        </label>
      </div>

      <div
        className="h-[min(58vh,640px)] min-h-72 overflow-auto overscroll-contain bg-surface"
        ref={viewport}
        tabIndex={0}
        role="region"
        aria-label="实时日志内容"
      >
        {runId && playerId && allEntries.length >= 200 && hasMore ? (
          <div className="border-b border-line/60 px-4 py-2 text-center">
            <button
              className="text-[10px] text-teal hover:underline disabled:text-faint"
              type="button"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
            >
              {loadingOlder ? '正在加载…' : '加载更早日志'}
            </button>
            {historyError ? <p className="mt-1 text-[10px] text-danger">{historyError}</p> : null}
          </div>
        ) : null}
        {visible.length > 0 ? (
          <ol className="divide-y divide-line/60">
            {visible.map((entry) => (
              <li
                key={entry.id}
                className="grid grid-cols-[52px_38px_minmax(0,1fr)] items-start gap-1.5 px-4 py-1.5 font-mono text-[10.5px] leading-snug"
              >
                <time className="text-[9.5px] text-faint" dateTime={entry.time}>
                  {formatTime(entry.time)}
                </time>
                <span
                  className={`text-[8.5px] font-semibold uppercase tracking-[0.04em] ${levelTone[entry.level]}`}
                >
                  {entry.level}
                </span>
                <span className="break-words whitespace-pre-wrap text-ink-soft">
                  {entry.message}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
            <span className="grid size-9 place-items-center rounded-[3px] border border-line bg-canvas text-teal">
              <Terminal size={20} />
            </span>
            <strong className="mt-3 text-xs font-medium text-ink">
              {allEntries.length ? '没有符合阈值的日志' : '等待运行输出'}
            </strong>
            <p className="mt-1 max-w-xs text-[10.5px] leading-snug text-muted">
              {allEntries.length
                ? '选择更低的最低级别，可显示更多运行消息。'
                : '启动后，Agent 的运行日志将在这里实时显示。'}
            </p>
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-line bg-surface-subtle px-4 py-2 font-mono text-[9.5px] text-faint">
        <span className="flex items-center gap-1.5">
          <span
            className={`size-1.5 rounded-full ${runId ? 'bg-teal' : 'bg-line-strong'}`}
            aria-hidden="true"
          />
          {runId ? `运行 ${runId.slice(0, 8)}` : '尚未创建运行'}
        </span>
        <span className="tabular">
          {visible.length} / {allEntries.length} 条
        </span>
      </footer>
    </section>
  );
}
