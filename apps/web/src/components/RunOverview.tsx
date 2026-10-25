import { ArrowUpRight, Clock3, Cpu, Flag, Play, Square, Zap } from 'lucide-react';
import type { RunState } from '../../../../packages/contracts/src/index';
import type { PendingAction } from '../hooks/useDashboard';
import { formatDateTime, formatTime, isRunning, phaseLabels, replayHref } from '../lib/format';
import { Spinner } from './Shared';

type Props = {
  state: RunState;
  pending: PendingAction;
  onStop: () => void;
};

export function RunOverview({ state, pending, onStop }: Props) {
  const running = isRunning(state.phase);
  const replay = replayHref(state.match?.replayUrl ?? null);
  const caption = state.run
    ? `启动于 ${formatDateTime(state.run.startedAt)} · ${state.run.config.server} 服务器`
    : '配置你的 Bot，让下一场对局从这里开始。';
  const maxGames = state.run ? (state.run.config.autopilot ? state.run.config.maxGames : 1) : null;

  return (
    <section
      className="relative overflow-hidden rounded-2xl bg-forest-950 text-white shadow-lift"
      aria-labelledby="run-heading"
    >
      <div
        className="pointer-events-none absolute -right-20 -top-28 size-72 rounded-full bg-lime/10 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
        aria-hidden="true"
      />

      <div className="relative flex flex-col gap-5 p-5 sm:p-7 md:flex-row md:items-center">
        <div
          className={`grid size-14 shrink-0 place-items-center rounded-2xl ring-1 ring-inset ${
            state.phase === 'failed'
              ? 'bg-danger/15 text-[#efb3a1] ring-danger/20'
              : 'bg-white/[0.07] text-lime ring-white/10'
          }`}
        >
          <Cpu size={25} aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`size-1.5 rounded-full ${
                running
                  ? 'animate-pulse bg-lime'
                  : state.phase === 'failed'
                    ? 'bg-[#e1a18c]'
                    : 'bg-white/35'
              }`}
              aria-hidden="true"
            />
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
              Run status
            </span>
          </div>
          <h2
            id="run-heading"
            className="mt-2 text-[22px] font-semibold tracking-tight sm:text-2xl"
          >
            {phaseLabels[state.phase]}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-white/50">{caption}</p>
        </div>

        <div className="w-full md:w-auto">
          {running ? (
            <button
              className="btn w-full border border-white/15 bg-white/[0.06] text-white hover:bg-white/10 md:w-auto"
              type="button"
              onClick={onStop}
              disabled={pending !== null || state.phase === 'stopping'}
            >
              {pending === 'stop' || state.phase === 'stopping' ? (
                <Spinner />
              ) : (
                <Square size={14} fill="currentColor" />
              )}
              {state.phase === 'stopping' ? '正在停止' : '停止运行'}
            </button>
          ) : (
            <button
              className="btn btn-accent w-full md:w-auto"
              form="run-config"
              type="submit"
              name="intent"
              value="start"
              disabled={pending !== null}
            >
              {pending === 'start' ? <Spinner /> : <Play size={15} fill="currentColor" />}
              {pending === 'start' ? '正在启动' : '启动运行'}
            </button>
          )}
        </div>
      </div>

      <dl className="relative grid grid-cols-2 divide-x divide-y divide-white/10 border-t border-white/10 sm:grid-cols-4 sm:divide-y-0">
        <div className="px-5 py-4">
          <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-white/40">
            <Zap size={12} aria-hidden="true" /> 当前回合
          </dt>
          <dd className="mt-2 font-mono text-lg font-medium tabular text-white">
            {state.match ? state.turn : '—'}
          </dd>
        </div>
        <div className="px-5 py-4">
          <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-white/40">
            <Cpu size={12} aria-hidden="true" /> Agent 延迟
          </dt>
          <dd className="mt-2 font-mono text-lg font-medium tabular text-white">
            {state.agentLatencyMs === null ? '—' : `${state.agentLatencyMs} ms`}
          </dd>
        </div>
        <div className="px-5 py-4">
          <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-white/40">
            <Flag size={12} aria-hidden="true" /> 本轮已完成
          </dt>
          <dd className="mt-2 font-mono text-lg font-medium tabular text-white">
            {state.completedGames}
            <span className="ml-1 font-sans text-[11px] font-normal text-white/35">
              / {maxGames ?? '—'} 场
            </span>
          </dd>
        </div>
        <div className="px-5 py-4">
          <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-white/40">
            <Clock3 size={12} aria-hidden="true" /> {state.nextGameAt ? '下次对局' : '当前对局'}
          </dt>
          <dd
            className="mt-2 truncate font-mono text-xs font-medium text-white/90"
            title={state.nextGameAt ? formatTime(state.nextGameAt) : (state.match?.gameId ?? '')}
          >
            {state.nextGameAt ? formatTime(state.nextGameAt) : state.match?.gameId || '—'}
          </dd>
        </div>
      </dl>

      {(state.match || state.run?.error) && (
        <div
          className={`relative flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-3 text-[11px] sm:px-7 ${
            state.run?.error ? 'bg-danger/15 text-[#f1c3b5]' : 'text-white/45'
          }`}
        >
          <span className="min-w-0 break-words">
            {state.run?.error ??
              `对手：${state.match?.opponent || '等待匹配'} · ${state.match?.server} 服务器`}
          </span>
          {replay && (
            <a
              className="inline-flex items-center gap-1 whitespace-nowrap text-lime transition-colors hover:text-lime-strong"
              href={replay}
              target="_blank"
              rel="noopener noreferrer"
            >
              打开回放 <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          )}
        </div>
      )}
    </section>
  );
}
