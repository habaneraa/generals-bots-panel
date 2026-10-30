import { Download, ListFilter, Terminal } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { LogEntry, LogLevel } from '../../../../packages/contracts/src/index';
import { playerPath } from '../api/client';
import { usePlayerId } from '../hooks/PlayerScope';
import { formatTime } from '../lib/format';

type Props = { entries: LogEntry[]; runId: string | null; active: boolean };

const levelTone: Record<LogLevel, string> = {
  info: 'text-teal-dark',
  warn: 'text-warn',
  error: 'text-danger',
  debug: 'text-faint',
};

export function LogsPanel({ entries, runId, active }: Props) {
  const playerId = usePlayerId();
  const controlId = useId();
  const [level, setLevel] = useState<LogLevel | 'all'>('all');
  const [follow, setFollow] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const visible = level === 'all' ? entries : entries.filter((entry) => entry.level === level);

  useEffect(() => {
    if (active && follow && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
    }
  }, [active, entries, level, follow]);

  return (
    <section id="logs" className="panel overflow-hidden" aria-labelledby="logs-heading">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 id="logs-heading" className="panel-heading">
            <Terminal size={14} /> 实时日志
          </h2>
          <p className="panel-caption">当前运行最近 200 条 · 通过事件流实时更新</p>
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
            <option value="info">INFO · 信息</option>
            <option value="warn">WARN · 警告</option>
            <option value="error">ERROR · 错误</option>
            <option value="debug">DEBUG · 调试</option>
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
              {entries.length ? '没有该级别的日志' : '等待运行输出'}
            </strong>
            <p className="mt-1 max-w-xs text-[10.5px] leading-snug text-muted">
              {entries.length
                ? '切换日志级别，查看其他运行消息。'
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
          {visible.length} / {entries.length} 条
        </span>
      </footer>
    </section>
  );
}
