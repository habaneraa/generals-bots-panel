import { Download, ListFilter, Terminal } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { LogEntry, LogLevel } from '../../../../packages/contracts/src/index';
import { formatTime } from '../lib/format';

type Props = { entries: LogEntry[]; runId: string | null; active: boolean };

const levelTone: Record<LogLevel, string> = {
  info: 'text-[#9dc57b]',
  warn: 'text-[#d9b56a]',
  error: 'text-[#e5a18d]',
  debug: 'text-[#7f9a8b]',
};

export function LogsPanel({ entries, runId, active }: Props) {
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
    <section
      id="logs"
      className="overflow-hidden rounded-2xl border border-forest-800 bg-forest-950 text-white shadow-lift"
      aria-labelledby="logs-heading"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-white/[0.02] px-5 py-4 sm:px-6">
        <div>
          <h2 id="logs-heading" className="flex items-center gap-2 text-[15px] font-semibold">
            <Terminal size={17} className="text-lime" /> 实时日志
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-white/40">
            当前运行最近 200 条 · 通过事件流实时更新
          </p>
        </div>
        {runId ? (
          <a
            className="inline-flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            href={`/api/runs/${encodeURIComponent(runId)}/logs/download`}
            aria-label="下载本轮完整 JSONL 日志"
            title="下载完整 JSONL 日志"
          >
            <Download size={16} />
          </a>
        ) : (
          <button
            className="inline-flex size-9 items-center justify-center rounded-lg border border-white/10 text-white/25"
            disabled
            aria-label="暂无可下载日志"
          >
            <Download size={16} />
          </button>
        )}
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-2.5 sm:px-6">
        <label
          className="flex items-center gap-2 text-[11px] text-white/40"
          htmlFor={`${controlId}-level`}
        >
          <ListFilter size={13} />
          <span className="sr-only">日志级别</span>
          <select
            id={`${controlId}-level`}
            name={`${controlId}-level`}
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/65 focus:outline-none"
            value={level}
            onChange={(event) => setLevel(event.target.value as LogLevel | 'all')}
            aria-label="日志级别筛选"
          >
            <option value="all" className="text-ink">
              全部级别
            </option>
            <option value="info" className="text-ink">
              INFO · 信息
            </option>
            <option value="warn" className="text-ink">
              WARN · 警告
            </option>
            <option value="error" className="text-ink">
              ERROR · 错误
            </option>
            <option value="debug" className="text-ink">
              DEBUG · 调试
            </option>
          </select>
        </label>
        <label
          className="flex cursor-pointer items-center gap-2 text-[11px] text-white/40"
          htmlFor={`${controlId}-follow`}
        >
          <input
            id={`${controlId}-follow`}
            name={`${controlId}-follow`}
            className="size-3.5 accent-lime-strong"
            type="checkbox"
            checked={follow}
            onChange={(event) => setFollow(event.target.checked)}
          />
          <span>自动跟随</span>
        </label>
      </div>

      <div
        className="h-[min(62vh,720px)] min-h-80 overflow-auto overscroll-contain"
        ref={viewport}
        tabIndex={0}
        role="region"
        aria-label="实时日志内容"
      >
        {visible.length > 0 ? (
          <ol className="divide-y divide-white/5">
            {visible.map((entry) => (
              <li
                key={entry.id}
                className="grid grid-cols-[58px_40px_minmax(0,1fr)] items-start gap-2 px-5 py-2.5 font-mono text-[11px] leading-relaxed sm:px-6"
              >
                <time className="text-[10px] text-white/25" dateTime={entry.time}>
                  {formatTime(entry.time)}
                </time>
                <span
                  className={`text-[9px] font-semibold uppercase tracking-[0.06em] ${levelTone[entry.level]}`}
                >
                  {entry.level}
                </span>
                <span className="break-words whitespace-pre-wrap text-white/65">
                  {entry.message}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white/35">
              <Terminal size={24} />
            </span>
            <strong className="mt-4 text-xs font-medium text-white/65">
              {entries.length ? '没有该级别的日志' : '等待运行输出'}
            </strong>
            <p className="mt-1.5 max-w-xs text-[11px] leading-relaxed text-white/30">
              {entries.length
                ? '切换日志级别，查看其他运行消息。'
                : '启动后，Agent 的运行日志将在这里实时显示。'}
            </p>
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-3 font-mono text-[10px] text-white/35 sm:px-6">
        <span className="flex items-center gap-2">
          <span
            className={`size-1.5 rounded-full ${runId ? 'bg-lime' : 'bg-white/25'}`}
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
