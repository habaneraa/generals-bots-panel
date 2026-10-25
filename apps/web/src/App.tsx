import { Flag, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { RunConfig } from '../../../packages/contracts/src/index';
import { ConfigPanel } from './components/ConfigPanel';
import { LogsPanel } from './components/LogsPanel';
import { MatchHistory } from './components/MatchHistory';
import { Navigation, type TabId } from './components/Navigation';
import { RunOverview } from './components/RunOverview';
import { ConnectionBadge, Notice, Spinner } from './components/Shared';
import { StatsOverview } from './components/StatsOverview';
import { useDashboard } from './hooks/useDashboard';
import { isRunning } from './lib/format';

const tabMeta: Record<TabId, { title: string; description: string }> = {
  start: {
    title: '运行控制台',
    description: '连接你的 Agent，启动真实对局并管理本轮运行参数。',
  },
  stats: {
    title: '战绩统计',
    description: '基于真实对局记录统计胜负、平局与中断情况。',
  },
  history: {
    title: '对局记录',
    description: '检索全部历史对局，展开查看合并后的快照与 Agent 计步。',
  },
  logs: {
    title: '运行日志',
    description: '跟随当前运行的事件流，下载本轮完整 JSONL 日志。',
  },
};

export function App() {
  const { dashboard, connection, loadError, actionError, pending, retry, save, start, stop } =
    useDashboard();
  const [activeTab, setActiveTab] = useState<TabId>('start');
  const [feedback, setFeedback] = useState<string | null>(null);
  const running = dashboard ? isRunning(dashboard.state.phase) : false;
  const meta = tabMeta[activeTab];

  async function onSave(config: RunConfig) {
    setFeedback(null);
    const success = await save(config);
    if (success) setFeedback('运行参数已保存到本机 JSON 文件');
    return success;
  }

  async function onStart(config: RunConfig) {
    setFeedback(null);
    return start(config);
  }

  const hasNotice = Boolean(
    loadError ||
    actionError ||
    feedback ||
    connection === 'reconnecting' ||
    connection === 'disconnected',
  );

  return (
    <div className="min-h-dvh bg-canvas">
      <aside className="z-30 w-full shrink-0 bg-forest-950 text-white lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-[264px] lg:flex-col">
        <div className="flex items-center gap-3 px-4 pb-3 pt-4 lg:px-6 lg:pb-0 lg:pt-7">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-lime text-forest-950 shadow-lg shadow-black/20">
            <Flag size={20} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-lime/70">
              Generals
            </p>
            <p className="mt-0.5 text-[15px] font-semibold tracking-tight text-white">Bot 控制台</p>
          </div>
          <span className="ml-auto hidden items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-[9px] uppercase tracking-[0.16em] text-white/35 lg:inline-flex">
            Local
          </span>
        </div>

        <p className="hidden px-7 pb-3 pt-8 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/30 lg:block">
          工作区
        </p>
        <Navigation active={activeTab} onChange={setActiveTab} />

        <div className="mt-auto hidden p-4 lg:block">
          <div className="rounded-xl bg-white/[0.04] p-3.5 ring-1 ring-white/5">
            <div className="flex items-center gap-2 text-[11px] text-white/45">
              <ShieldCheck size={13} aria-hidden="true" />
              本地单用户 · 仅回环地址
            </div>
            <p
              className="mt-2 truncate font-mono text-[10px] text-white/30"
              title={dashboard?.dataDir ?? 'data/'}
            >
              {dashboard?.dataDir ?? 'data/'}
            </p>
          </div>
        </div>
      </aside>

      <div className="min-w-0 lg:pl-[264px]">
        <div className="mx-auto w-full max-w-[1200px] px-4 pb-10 pt-6 sm:px-6 lg:px-10 lg:pt-9">
          <header className="flex flex-col gap-5 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="animate-rise">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-moss">
                Generals / Bot Panel
              </p>
              <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[30px]">
                {meta.title}
              </h1>
              <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">
                {meta.description}
              </p>
            </div>
            <ConnectionBadge connection={connection} />
          </header>

          {hasNotice && (
            <div className="mt-5 space-y-3">
              {loadError && (
                <Notice
                  action={
                    <button className="btn btn-danger btn-sm" type="button" onClick={retry}>
                      重新连接
                    </button>
                  }
                >
                  {loadError}
                </Notice>
              )}
              {(connection === 'reconnecting' || connection === 'disconnected') && (
                <Notice
                  tone="info"
                  action={
                    <button className="btn btn-secondary btn-sm" type="button" onClick={retry}>
                      <RefreshCw size={13} /> 立即重连
                    </button>
                  }
                >
                  实时连接已断开{connection === 'reconnecting' ? '，正在自动重连' : ''}
                  ；显示的数据可能已过期。
                </Notice>
              )}
              {feedback && <Notice tone="success">{feedback}</Notice>}
              {actionError && <Notice>{actionError}</Notice>}
            </div>
          )}

          {dashboard ? (
            <>
              <div
                id="panel-start"
                className="animate-rise pt-5"
                role="tabpanel"
                aria-labelledby="tab-start"
                tabIndex={0}
                hidden={activeTab !== 'start'}
              >
                <div className="mx-auto grid max-w-4xl gap-5">
                  <RunOverview
                    state={dashboard.state}
                    pending={pending}
                    onStop={() => {
                      setFeedback(null);
                      void stop();
                    }}
                  />
                  <ConfigPanel
                    key={JSON.stringify(dashboard.config)}
                    config={dashboard.config}
                    running={running}
                    pending={pending}
                    actionError={actionError}
                    onSave={onSave}
                    onStart={onStart}
                  />
                </div>
              </div>
              <div
                id="panel-stats"
                className="animate-rise pt-5"
                role="tabpanel"
                aria-labelledby="tab-stats"
                tabIndex={0}
                hidden={activeTab !== 'stats'}
              >
                <StatsOverview stats={dashboard.stats} />
              </div>
              <div
                id="panel-history"
                className="animate-rise pt-5"
                role="tabpanel"
                aria-labelledby="tab-history"
                tabIndex={0}
                hidden={activeTab !== 'history'}
              >
                <MatchHistory refreshKey={JSON.stringify(dashboard.matches)} />
              </div>
              <div
                id="panel-logs"
                className="animate-rise pt-5"
                role="tabpanel"
                aria-labelledby="tab-logs"
                tabIndex={0}
                hidden={activeTab !== 'logs'}
              >
                <LogsPanel
                  entries={dashboard.logs}
                  runId={dashboard.state.run?.id ?? null}
                  active={activeTab === 'logs'}
                />
              </div>
              <footer className="mt-10 flex flex-col gap-2 border-t border-line pt-5 text-[10px] text-faint sm:flex-row sm:items-center sm:justify-between">
                <span className="font-semibold uppercase tracking-[0.18em] text-muted">
                  Generals <span className="font-normal text-faint">Bot Panel</span>
                </span>
                <span className="truncate" title={dashboard.dataDir}>
                  本地持久化 · <span className="font-mono">{dashboard.dataDir}</span>
                </span>
              </footer>
            </>
          ) : (
            <section className="panel mt-5 flex min-h-[420px] flex-col items-center justify-center gap-4 px-6 text-center">
              {loadError ? (
                <>
                  <RefreshCw size={28} className="text-moss" aria-hidden="true" />
                  <h2 className="text-base font-semibold text-ink">暂时无法连接控制台</h2>
                  <p className="max-w-sm text-sm leading-relaxed text-muted">
                    请确认 API 服务可用，然后重新连接。
                  </p>
                  <button className="btn btn-primary mt-1" type="button" onClick={retry}>
                    重新连接
                  </button>
                </>
              ) : (
                <>
                  <span className="text-moss">
                    <Spinner />
                  </span>
                  <h2 className="text-base font-semibold text-ink">正在连接控制台</h2>
                  <p className="max-w-sm text-sm leading-relaxed text-muted">
                    等待 API 与实时事件流返回运行数据。
                  </p>
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
