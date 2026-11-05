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
import { PlayerSwitcher } from './components/PlayerSwitcher';
import { PlayerScope } from './hooks/PlayerScope';
import { useDashboard } from './hooks/useDashboard';
import { isRunning } from './lib/format';
import { ReplayWorkspace } from './replay/ReplayWorkspace';

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
    description: '检索全部历史对局，打开详情查看最后记录的快照与 Agent 计步。',
  },
  replay: {
    title: '录像播放器',
    description: '读取本机对局录像，逐帧回看决策与战局变化。',
  },
  logs: {
    title: '运行日志',
    description: '跟随当前运行的事件流，下载本轮完整 JSONL 日志。',
  },
};

function DashboardApp() {
  const model = useDashboard();
  const { dashboard } = model;
  const [activeTab, setActiveTab] = useState<TabId>('start');
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-canvas">
      <aside className="z-30 w-full shrink-0 border-b border-line bg-surface lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-[228px] lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center gap-2.5 px-3 py-3 lg:px-4 lg:py-5">
          <span className="grid size-8 shrink-0 place-items-center rounded-[3px] bg-teal text-white">
            <Flag size={17} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <div>
            <p className="text-[8px] font-semibold uppercase tracking-[0.24em] text-teal">
              Generals
            </p>
            <p className="text-[13px] font-semibold leading-tight tracking-tight text-ink">
              Bot 控制台
            </p>
          </div>
          <span className="ml-auto hidden rounded-[2px] border border-line px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.12em] text-faint lg:inline">
            Local
          </span>
        </div>

        <p className="hidden px-5 pb-2 pt-4 text-[9px] font-semibold uppercase tracking-[0.18em] text-faint lg:block">
          工作区
        </p>
        <Navigation active={activeTab} onChange={setActiveTab} />

        <PlayerSwitcher
          player={model.player}
          players={model.players}
          open={menuOpen}
          pending={model.playerPending}
          pendingAction={model.playerAction}
          error={model.actionError ?? model.loadError}
          onOpenChange={setMenuOpen}
          onSelect={model.selectPlayer}
          onAdd={model.addPlayer}
          onCancelAdd={model.cancelAddPlayer}
          onDelete={model.deletePlayer}
        />
        <div className="hidden px-3 pb-3 lg:block">
          <div className="rounded-[3px] border border-line bg-canvas p-3">
            <div className="flex items-center gap-1.5 text-[10px] text-muted">
              <ShieldCheck size={12} className="text-teal" aria-hidden="true" />
              本地单用户 · 仅回环地址
            </div>
            <p
              className="mt-1.5 truncate font-mono text-[9px] text-faint"
              title={dashboard?.dataDir ?? 'data/'}
            >
              {dashboard?.dataDir ?? 'data/'}
            </p>
          </div>
        </div>
      </aside>
      <PlayerScope.Provider key={dashboard?.player?.id ?? 'empty'} value={dashboard?.player?.id}>
        <DashboardContent
          model={model}
          activeTab={activeTab}
          onAddPlayer={() => setMenuOpen(true)}
        />
      </PlayerScope.Provider>
    </div>
  );
}

function DashboardContent({
  model,
  activeTab,
  onAddPlayer,
}: {
  model: ReturnType<typeof useDashboard>;
  activeTab: TabId;
  onAddPlayer: () => void;
}) {
  const { dashboard, connection, loadError, actionError, pending, retry, save, start, stop } =
    model;
  const [feedback, setFeedback] = useState<string | null>(null);
  const running = dashboard ? isRunning(dashboard.state.phase) : false;
  const statsRefreshKey = JSON.stringify(
    dashboard?.matches.map(({ id, opponent, outcome, startedAt, turns }) => ({
      id,
      opponent,
      outcome,
      startedAt,
      turns,
    })) ?? [],
  );
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
    <div className="min-w-0 lg:pl-[228px]">
      <div className="mx-auto w-full max-w-[1240px] px-4 pb-8 pt-5 sm:px-6 lg:px-8 lg:pt-7">
        <header className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-teal">
              Generals / Bot Panel
            </p>
            <h1 className="mt-1 text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              {meta.title}
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-snug text-muted">{meta.description}</p>
          </div>
          <ConnectionBadge connection={connection} />
        </header>

        {hasNotice && (
          <div className="mt-3 space-y-2">
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
                    <RefreshCw size={12} /> 立即重连
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

        {dashboard?.player ? (
          <>
            <div
              id="panel-start"
              className="pt-4"
              role="tabpanel"
              aria-labelledby="tab-start"
              tabIndex={0}
              hidden={activeTab !== 'start'}
            >
              <div className="mx-auto grid max-w-4xl gap-3">
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
                  onSave={onSave}
                  onStart={onStart}
                />
              </div>
            </div>
            <div
              id="panel-stats"
              className="pt-4"
              role="tabpanel"
              aria-labelledby="tab-stats"
              tabIndex={0}
              hidden={activeTab !== 'stats'}
            >
              <StatsOverview
                stats={dashboard.stats}
                active={activeTab === 'stats'}
                refreshKey={statsRefreshKey}
              />
            </div>
            <div
              id="panel-history"
              className="pt-4"
              role="tabpanel"
              aria-labelledby="tab-history"
              tabIndex={0}
              hidden={activeTab !== 'history'}
            >
              <MatchHistory
                refreshKey={JSON.stringify(dashboard.matches)}
                starHistoryRefreshKey={JSON.stringify(
                  dashboard.matches.map(
                    ({
                      id,
                      runId,
                      server,
                      gameId,
                      startedAt,
                      endedAt,
                      opponent,
                      outcome,
                      rating,
                    }) => ({
                      id,
                      runId,
                      server,
                      gameId,
                      startedAt,
                      endedAt,
                      opponent,
                      outcome,
                      rating,
                    }),
                  ),
                )}
              />
            </div>
            <div
              id="panel-replay"
              className="pt-4"
              role="tabpanel"
              aria-labelledby="tab-replay"
              hidden={activeTab !== 'replay'}
            >
              <ReplayWorkspace active={activeTab === 'replay'} />
            </div>
            <div
              id="panel-logs"
              className="pt-4"
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
          </>
        ) : dashboard ? (
          <section className="panel mt-4 flex min-h-[360px] flex-col items-center justify-center gap-3 px-6 text-center">
            <Flag size={26} className="text-teal" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-ink">欢迎，先添加一个 Player</h2>
            <p className="max-w-sm text-xs leading-snug text-muted">
              填写所属服务器和
              userId，昵称由服务器读取并缓存，创建独立工作区。运行参数无需再填写账号文件。
            </p>
            <button className="btn btn-primary mt-1" type="button" onClick={onAddPlayer}>
              添加第一个 Player
            </button>
          </section>
        ) : (
          <section className="panel mt-4 flex min-h-[360px] flex-col items-center justify-center gap-3 px-6 text-center">
            {loadError ? (
              <>
                <RefreshCw size={24} className="text-teal" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-ink">暂时无法连接控制台</h2>
                <p className="max-w-sm text-xs leading-snug text-muted">
                  请确认 API 服务可用，然后重新连接。
                </p>
                <button className="btn btn-primary mt-1" type="button" onClick={retry}>
                  重新连接
                </button>
              </>
            ) : (
              <>
                <span className="text-teal">
                  <Spinner />
                </span>
                <h2 className="text-sm font-semibold text-ink">正在连接控制台</h2>
                <p className="max-w-sm text-xs leading-snug text-muted">
                  等待 API 与实时事件流返回运行数据。
                </p>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

export function App() {
  if (window.location.pathname === '/replay') {
    const playerId = new URLSearchParams(window.location.search).get('playerId') || undefined;
    return (
      <main className="mx-auto max-w-[1320px] p-4 sm:p-6">
        <header className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="meta-label text-teal">GENERALS / LOCAL REPLAY</p>
            <h1 className="mt-1 text-xl font-semibold text-ink">录像播放器</h1>
          </div>
          <a
            className="btn btn-secondary btn-sm"
            href={playerId ? `/?${new URLSearchParams({ playerId })}` : '/'}
          >
            返回控制台
          </a>
        </header>
        <PlayerScope.Provider key={playerId} value={playerId}>
          <ReplayWorkspace />
        </PlayerScope.Provider>
      </main>
    );
  }
  return <DashboardApp />;
}
