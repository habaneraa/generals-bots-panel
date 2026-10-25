import { Star } from 'lucide-react';
import { StarChange } from './StarChange';
import type { ReactNode } from 'react';
import type {
  MatchAgentStats,
  MatchPlayerSnapshot,
  MatchRecord,
  MatchSnapshot,
} from '../../../../packages/contracts/src/index';

function formatNumber(value: number | null, missing = '—'): string {
  return value === null ? missing : value.toLocaleString('zh-CN');
}

function formatCount(value: number | null): string {
  return formatNumber(value, '服务器未提供');
}

function formatMilliseconds(value: number): string {
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ms`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false });
}

function TimeText({ value }: { value: string | null }) {
  if (!value) return <>—</>;
  return <time dateTime={value}>{formatTimestamp(value)}</time>;
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-3 py-2">
      <dt className="text-[9px] font-semibold uppercase tracking-[0.08em] text-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-xs font-medium text-ink">{children}</dd>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="meta-label">{label}</dt>
      <dd className="mt-0.5 break-words text-[11px] leading-snug text-ink-soft">{children}</dd>
    </div>
  );
}

function CompactItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] text-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-[11px] text-ink-soft">{children}</dd>
    </div>
  );
}

function PlayerStat({
  label,
  children,
  tone = 'text-ink',
  title,
}: {
  label: string;
  children: ReactNode;
  tone?: string;
  title?: string;
}) {
  return (
    <div className="px-1" title={title}>
      <dt className="text-[9px] text-faint">{label}</dt>
      <dd className={`mt-0.5 text-[11px] font-semibold tabular ${tone}`}>{children}</dd>
    </div>
  );
}

function PlayerCard({ player, isWinner }: { player: MatchPlayerSnapshot; isWinner: boolean }) {
  const star = player.stars === null ? '未获取' : player.stars.toLocaleString('zh-CN');
  return (
    <article
      className={`rounded-[3px] border px-2.5 py-2 ${
        player.isSelf ? 'border-teal-line bg-teal-soft/30' : 'border-line bg-surface-subtle'
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-ink">{player.username ?? '服务器未提供'}</span>
        <span className="star-badge" aria-label={`Star ${star}`}>
          <Star size={9} fill="currentColor" aria-hidden="true" />
          {star}
        </span>
        {player.isSelf && (
          <span className="rounded-[2px] bg-teal px-1 py-px text-[8.5px] font-medium leading-none text-white">
            己方
          </span>
        )}
        {isWinner && (
          <span className="rounded-[2px] border border-teal-line px-1 py-px text-[8.5px] font-medium leading-none text-teal-dark">
            胜者
          </span>
        )}
      </div>
      <dl className="mt-1.5 grid grid-cols-5 divide-x divide-line border-t border-line pt-1.5 text-center">
        <PlayerStat label="领地">{formatNumber(player.land)}</PlayerStat>
        <PlayerStat label="兵力">{formatNumber(player.army)}</PlayerStat>
        <PlayerStat label="城市" title="服务器未提供或视野不完整时显示为 —">
          {formatNumber(player.cities)}
        </PlayerStat>
        <PlayerStat label="已见城市" title="视野内可见城市数量的下限">
          {player.visibleCities === null ? '—' : `≥ ${formatNumber(player.visibleCities)}`}
        </PlayerStat>
        <PlayerStat
          label="存活"
          tone={
            player.alive === null ? 'text-ink' : player.alive ? 'text-teal-dark' : 'text-danger'
          }
        >
          {player.alive === null ? '—' : player.alive ? '存活' : '已出局'}
        </PlayerStat>
      </dl>
    </article>
  );
}

function AgentStats({ agent }: { agent: MatchAgentStats }) {
  const metrics: Array<[string, string]> = [
    ['观察', agent.observations.toLocaleString('zh-CN')],
    ['策略步数', agent.decisions.toLocaleString('zh-CN')],
    ['已提交', agent.submittedMoves.toLocaleString('zh-CN')],
    ['Pass', agent.passes.toLocaleString('zh-CN')],
    ['跳过', agent.skippedMoves.toLocaleString('zh-CN')],
    ['分兵', agent.splitMoves.toLocaleString('zh-CN')],
    ['总耗时', formatMilliseconds(agent.totalLatencyMs)],
    [
      '平均耗时',
      agent.decisions > 0 ? formatMilliseconds(agent.totalLatencyMs / agent.decisions) : '—',
    ],
    ['最大耗时', formatMilliseconds(agent.maxLatencyMs)],
  ];

  return (
    <dl className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-[2px] border border-line bg-line sm:grid-cols-9">
      {metrics.map(([label, value]) => (
        <div key={label} className="bg-surface px-2 py-1.5">
          <dt className="text-[9px] text-faint">{label}</dt>
          <dd className="mt-0.5 whitespace-nowrap font-mono text-[10.5px] tabular text-ink">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function MatchDetails({ match }: { match: MatchRecord }) {
  const details = match.details;
  const snapshot: MatchSnapshot | null = details?.last ?? null;
  const players = snapshot?.players ?? [];
  const winnerIndex = details?.winnerIndex ?? null;

  const duration =
    details?.durationMs == null
      ? '未采集'
      : `${(details.durationMs / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 3 })} 秒`;
  const endReason = details ? (details.endReason ?? '服务器未提供') : '未采集';
  const winner = !details
    ? '未采集'
    : details.winnerIndex === null
      ? '服务器未提供'
      : (players.find((player) => player.index === details.winnerIndex)?.username ??
        `玩家 #${details.winnerIndex}`);

  return (
    <div className="space-y-3 p-3.5 sm:p-4">
      <dl className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-[2px] border border-line sm:grid-cols-4 sm:divide-y-0">
        <Metric label="时长">{duration}</Metric>
        <Metric label="已记录回合">{formatCount(match.turns)}</Metric>
        <Metric label="终局原因">{endReason}</Metric>
        <Metric label="获胜玩家">{winner}</Metric>
      </dl>

      <dl className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4">
        <Detail label="开始时间">
          <TimeText value={match.startedAt} />
        </Detail>
        <Detail label="结束时间">
          {match.endedAt ? <TimeText value={match.endedAt} /> : '尚未记录结束'}
        </Detail>
        <Detail label="Star 变化">
          <StarChange match={match} />
          {match.rating?.source === 'public-profile' && (
            <p className="mt-1 text-[9px] text-faint">公开资料采样，可能有结算延迟</p>
          )}
        </Detail>
        <Detail label="服务器">{match.server}</Detail>
        <Detail label="对手">{match.opponent || '服务器未提供'}</Detail>
      </dl>

      {details ? (
        <>
          <section className="border-t border-line pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-1.5">
              <h4 className="text-xs font-semibold text-ink">地图与规则</h4>
              {snapshot && (
                <span className="text-[9.5px] text-faint">
                  最后记录 · {formatTimestamp(snapshot.capturedAt)}
                </span>
              )}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-5 gap-y-1.5 sm:grid-cols-5">
              <CompactItem label="地图尺寸">
                {snapshot?.map ? `${snapshot.map.width} × ${snapshot.map.height}` : '未采集'}
              </CompactItem>
              <CompactItem label="对局类型">{snapshot?.gameType.trim() || '未提供'}</CompactItem>
              <CompactItem label="阵营配置">
                {snapshot && snapshot.teams.length ? snapshot.teams.join(' / ') : '未提供'}
              </CompactItem>
              <CompactItem label="规则修饰项">
                {!snapshot
                  ? '未提供'
                  : snapshot.modifiers.length
                    ? snapshot.modifiers.join('、')
                    : '无'}
              </CompactItem>
              <CompactItem label="环绕地图">
                {snapshot ? (snapshot.torus ? '是' : '否') : '未采集'}
              </CompactItem>
            </dl>
            <p className="mt-1.5 font-mono text-[10px] text-muted">
              {snapshot
                ? `记录回合 ${formatCount(snapshot.turn)} · 原始回合（serverTurn） ${formatCount(snapshot.serverTurn)}`
                : '未采集最后快照。'}
            </p>
          </section>

          <section className="border-t border-line pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-1.5">
              <h4 className="text-xs font-semibold text-ink">玩家状态</h4>
              <span className="text-[9.5px] text-faint">最后记录</span>
            </div>
            {players.length ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {players.map((player) => (
                  <PlayerCard
                    key={player.index}
                    player={player}
                    isWinner={winnerIndex === player.index}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[10.5px] text-muted">玩家信息未采集。</p>
            )}
            <p className="mt-1.5 text-[9.5px] leading-snug text-faint">
              城市未知显示为 —；已见城市为视野内可见数量的下限。
            </p>
          </section>

          <section className="border-t border-line pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-1.5">
              <h4 className="text-xs font-semibold text-ink">Agent 计步与推理</h4>
              <span className="text-[9.5px] text-faint">提交不代表服务器执行</span>
            </div>
            <AgentStats agent={details.agent} />
            <p className="mt-1.5 text-[9.5px] text-faint">平均耗时按策略步数计算。</p>
          </section>

          <div className="flex flex-wrap items-start justify-between gap-2 border-t border-line pt-2 text-[9.5px] text-faint">
            <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-0.5">
              <span className="min-w-0 break-all">
                运行 <span className="mono text-muted">{match.runId}</span>
              </span>
              <span className="min-w-0 break-all">
                记录 <span className="mono text-muted">{match.id}</span>
              </span>
            </div>
            <p className="max-w-md text-right leading-snug">
              最后记录的快照不一定是完整终局；城市数未提供时不计为 0。
            </p>
          </div>
        </>
      ) : (
        <p className="border-t border-line pt-2 text-[10.5px] leading-snug text-muted">
          此记录的快照和 Agent 计步详情未采集。
        </p>
      )}
    </div>
  );
}
