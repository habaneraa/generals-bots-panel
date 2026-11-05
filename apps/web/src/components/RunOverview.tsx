import { ArrowUpRight, Clock3, Cpu, Flag, Play, Square, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RunState } from '../../../../packages/contracts/src/index';
import type { PendingAction } from '../hooks/useDashboard';
import { formatTime, isRunning, phaseLabels, replayHref } from '../lib/format';
import { Spinner } from './Shared';

type Props = {
  state: RunState;
  pending: PendingAction;
  onStop: () => void;
};

function PhaseDuration({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const duration = [
    hours > 0 ? `${hours} 小时` : '',
    minutes > 0 ? `${minutes} 分` : '',
    `${seconds % 60} 秒`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className="whitespace-nowrap text-sm font-normal tabular text-muted">（{duration}）</span>
  );
}

export function RunOverview({ state, pending, onStop }: Props) {
  const running = isRunning(state.phase);
  const replay = replayHref(state.match?.replayUrl ?? null);
  const maxGames = state.run ? (state.run.config.autopilot ? state.run.config.maxGames : 1) : null;
  const failed = state.phase === 'failed';

  return (
    <section
      className="overflow-hidden rounded-[4px] border border-line bg-surface"
      aria-labelledby="run-heading"
    >
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div
          className={`grid size-9 shrink-0 place-items-center rounded-[3px] ${
            failed ? 'bg-danger/[0.08] text-danger' : 'bg-teal-soft text-teal'
          }`}
        >
          <Cpu size={19} aria-hidden="true" />
        </div>

        <h2
          id="run-heading"
          className="min-w-0 flex-1 text-lg font-semibold leading-snug tracking-tight"
        >
          {phaseLabels[state.phase]}
          <PhaseDuration key={state.phaseStartedAt} since={state.phaseStartedAt} />
        </h2>

        <div className="w-full sm:w-auto">
          {running ? (
            <button
              className="btn btn-secondary w-full sm:w-auto"
              type="button"
              onClick={onStop}
              disabled={pending !== null || state.phase === 'stopping'}
            >
              {pending === 'stop' || state.phase === 'stopping' ? (
                <Spinner />
              ) : (
                <Square size={12} fill="currentColor" />
              )}
              {state.phase === 'stopping' ? '正在停止' : '停止运行'}
            </button>
          ) : (
            <button
              className="btn btn-primary w-full sm:w-auto"
              form="run-config"
              type="submit"
              name="intent"
              value="start"
              disabled={pending !== null}
            >
              {pending === 'start' ? <Spinner /> : <Play size={13} fill="currentColor" />}
              {pending === 'start' ? '正在启动' : '启动运行'}
            </button>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 divide-x divide-y divide-line border-t border-line sm:grid-cols-4 sm:divide-y-0">
        <div className="px-4 py-2.5">
          <dt className="flex items-center gap-1 text-[9px] uppercase tracking-[0.08em] text-faint">
            <Zap size={10} aria-hidden="true" /> 当前回合
          </dt>
          <dd className="mt-1 font-mono text-sm font-semibold tabular text-ink">
            {state.match ? state.turn : '—'}
          </dd>
        </div>
        <div className="px-4 py-2.5">
          <dt className="flex items-center gap-1 text-[9px] uppercase tracking-[0.08em] text-faint">
            <Cpu size={10} aria-hidden="true" /> Agent 延迟
          </dt>
          <dd className="mt-1 font-mono text-sm font-semibold tabular text-ink">
            {state.agentLatencyMs === null ? '—' : `${state.agentLatencyMs} ms`}
          </dd>
        </div>
        <div className="px-4 py-2.5">
          <dt className="flex items-center gap-1 text-[9px] uppercase tracking-[0.08em] text-faint">
            <Flag size={10} aria-hidden="true" /> 本轮已完成
          </dt>
          <dd className="mt-1 font-mono text-sm font-semibold tabular text-ink">
            {state.completedGames}
            <span className="ml-1 font-sans text-[10px] font-normal text-faint">
              / {maxGames ?? '—'} 场
            </span>
          </dd>
        </div>
        <div className="px-4 py-2.5">
          <dt className="flex items-center gap-1 text-[9px] uppercase tracking-[0.08em] text-faint">
            <Clock3 size={10} aria-hidden="true" /> {state.nextGameAt ? '下次对局' : '当前对局'}
          </dt>
          <dd
            className="mt-1 truncate font-mono text-[11px] font-medium text-ink"
            title={state.nextGameAt ? formatTime(state.nextGameAt) : (state.match?.gameId ?? '')}
          >
            {state.nextGameAt ? formatTime(state.nextGameAt) : state.match?.gameId || '—'}
          </dd>
        </div>
      </dl>

      {(state.match || state.run?.error) && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-[10.5px] ${
            state.run?.error ? 'bg-danger/[0.045] text-danger' : 'bg-surface-subtle text-muted'
          }`}
        >
          <span className="min-w-0 break-words">
            {state.run?.error ??
              `对手：${state.match?.opponent || '等待匹配'} · ${state.match?.server} 服务器`}
            {state.phase === 'failed' && state.autoRestartAt && (
              <span className="ml-1 text-warn" role="status" aria-live="polite">
                · 将于 {formatTime(state.autoRestartAt)} 自动重启
              </span>
            )}
          </span>
          {replay && (
            <a
              className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-teal transition-colors hover:text-teal-dark"
              href={replay}
              target="_blank"
              rel="noopener noreferrer"
            >
              打开回放 <ArrowUpRight size={11} aria-hidden="true" />
            </a>
          )}
        </div>
      )}
    </section>
  );
}
