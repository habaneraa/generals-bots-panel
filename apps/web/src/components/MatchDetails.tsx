import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Clock3,
  Cpu,
  Crown,
  Fingerprint,
  MapPinned,
  Swords,
  TriangleAlert,
  User,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  MatchAgentStats,
  MatchPlayerSnapshot,
  MatchRecord,
  MatchSnapshot,
} from '../../../../packages/contracts/src/index';
import { replayHref } from '../lib/format';
import { OutcomeBadge } from './OutcomeBadge';

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

function Detail({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="meta-label">{label}</dt>
      <dd className="mt-1 text-[12px] leading-relaxed break-words text-ink-soft">{children}</dd>
    </div>
  );
}

function InfoCard({
  title,
  icon,
  caption,
  children,
  className = '',
}: {
  title: string;
  icon: ReactNode;
  caption?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 sm:p-5 ${className}`}>
      <h4 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <span className="text-moss">{icon}</span>
        {title}
      </h4>
      {caption && <p className="mt-1 text-[11px] leading-relaxed text-faint">{caption}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

type MetaComparison = { text: string; changed: boolean };

function compareText(first: string | null, last: string | null, missing: string): MetaComparison {
  if (first === null && last === null) return { text: missing, changed: false };
  if (first === null || last === null) return { text: (last ?? first)!, changed: false };
  if (first === last) return { text: first, changed: false };
  return { text: `${first} → ${last}`, changed: true };
}

function snapshotMap(snapshot: MatchSnapshot | null): string | null {
  return snapshot?.map ? `${snapshot.map.width} × ${snapshot.map.height}` : null;
}

function snapshotGameType(snapshot: MatchSnapshot | null): string | null {
  return snapshot?.gameType.trim() || null;
}

function snapshotTeams(snapshot: MatchSnapshot | null): string | null {
  return snapshot && snapshot.teams.length ? snapshot.teams.join(' / ') : null;
}

function snapshotModifiers(snapshot: MatchSnapshot | null): string | null {
  if (!snapshot) return null;
  return snapshot.modifiers.length ? snapshot.modifiers.join('、') : '无';
}

function snapshotTorus(snapshot: MatchSnapshot | null): string | null {
  if (!snapshot) return null;
  return snapshot.torus ? '是' : '否';
}

function MetaItem({ label, comparison }: { label: string; comparison: MetaComparison }) {
  return (
    <div>
      <dt className="meta-label">{label}</dt>
      <dd
        className={`mt-1 text-[12px] leading-relaxed break-words ${
          comparison.changed ? 'text-warn' : 'text-ink-soft'
        }`}
        title={comparison.changed ? '首个与最后快照不一致，按 首个 → 最后 展示' : undefined}
      >
        {comparison.text}
      </dd>
    </div>
  );
}

function SnapshotPoint({ label, snapshot }: { label: string; snapshot: MatchSnapshot | null }) {
  return (
    <div className="rounded-lg border border-line bg-canvas/50 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
          {label}
        </span>
        {snapshot ? (
          <time className="text-[10px] text-muted" dateTime={snapshot.capturedAt}>
            {formatTimestamp(snapshot.capturedAt)}
          </time>
        ) : (
          <span className="text-[10px] text-faint">未采集</span>
        )}
      </div>
      {snapshot && (
        <p className="mt-1.5 font-mono text-[11px] text-ink-soft">
          记录回合 {formatCount(snapshot.turn)} · 原始回合（serverTurn）{' '}
          {formatCount(snapshot.serverTurn)}
        </p>
      )}
    </div>
  );
}

type PlayerIdentity = {
  index: number;
  isSelf: boolean;
  userId: string | null;
  username: string | null;
  stars: number | null;
  team: number | null;
};

type PlayerRow = {
  identity: PlayerIdentity;
  first: MatchPlayerSnapshot | null;
  last: MatchPlayerSnapshot | null;
};

function buildPlayerRows(initial: MatchSnapshot | null, last: MatchSnapshot | null): PlayerRow[] {
  const indices = new Set<number>();
  for (const player of initial?.players ?? []) indices.add(player.index);
  for (const player of last?.players ?? []) indices.add(player.index);

  return [...indices]
    .sort((a, b) => a - b)
    .flatMap((index) => {
      const first = initial?.players.find((player) => player.index === index) ?? null;
      const lastPlayer = last?.players.find((player) => player.index === index) ?? null;
      const source = lastPlayer ?? first;
      if (!source) return [];
      return [
        {
          identity: {
            index,
            isSelf: lastPlayer?.isSelf ?? first?.isSelf ?? false,
            userId: lastPlayer?.userId ?? first?.userId ?? null,
            username: lastPlayer?.username ?? first?.username ?? null,
            stars: lastPlayer?.stars ?? first?.stars ?? null,
            team: lastPlayer?.team ?? first?.team ?? null,
          },
          first,
          last: lastPlayer,
        },
      ];
    });
}

type StatValueProps<T> = {
  label: string;
  first: T | null;
  last: T | null;
  hasFirst: boolean;
  hasLast: boolean;
  format: (value: T | null) => string;
  tone?: (value: T | null) => string;
  title?: string;
};

function StatValue<T>({
  label,
  first,
  last,
  hasFirst,
  hasLast,
  format,
  tone,
  title,
}: StatValueProps<T>) {
  let content: ReactNode;
  if (!hasFirst && !hasLast) {
    content = <span className="text-faint">未采集</span>;
  } else if (!hasFirst || !hasLast) {
    content = <span className="tabular">{format(hasLast ? last : first)}</span>;
  } else if (first === last) {
    content = <span className={`tabular ${tone?.(last) ?? ''}`}>{format(last)}</span>;
  } else {
    content = (
      <span className="inline-flex flex-wrap items-center gap-1">
        <span className="text-[11px] font-normal text-faint tabular">{format(first)}</span>
        <ArrowRight size={10} className="text-faint" aria-hidden="true" />
        <span className={`font-semibold tabular ${tone?.(last) ?? ''}`}>{format(last)}</span>
      </span>
    );
  }

  const description =
    hasFirst && hasLast
      ? `${label}：首个记录 ${format(first)}，最后记录 ${format(last)}`
      : `${label}：${format(hasLast ? last : first)}`;

  return (
    <div className="rounded-lg bg-canvas/70 px-2.5 py-2" title={title}>
      <dt className="text-[10px] leading-tight text-faint">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-medium text-ink" aria-label={description}>
        {content}
      </dd>
    </div>
  );
}

function PlayerCard({
  row,
  hasInitial,
  hasLast,
  winnerIndex,
}: {
  row: PlayerRow;
  hasInitial: boolean;
  hasLast: boolean;
  winnerIndex: number | null;
}) {
  const { identity, first, last } = row;
  const isWinner = winnerIndex === identity.index;
  const initialHasPlayer = Boolean(hasInitial && first);
  const lastHasPlayer = Boolean(hasLast && last);
  const citiesTitle = '服务器未提供或视野不完整时显示为 —';

  return (
    <article
      className={`rounded-xl border p-4 ${
        identity.isSelf ? 'border-forest-700/25 bg-[#f5f9ed]' : 'border-line bg-surface'
      }`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h5 className="truncate text-sm font-semibold text-ink">
              {identity.username ?? '服务器未提供'}
            </h5>
            <span
              className={`rounded-full border px-2 py-0.5 text-[9px] font-medium ${
                identity.isSelf
                  ? 'border-forest-700/20 bg-forest-900/[0.06] text-moss'
                  : 'border-line bg-canvas text-muted'
              }`}
            >
              {identity.isSelf ? '己方' : '其他玩家'}
            </span>
            {isWinner && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#d9c48b] bg-[#f6edcf] px-2 py-0.5 text-[9px] font-medium text-[#836424]">
                <Crown size={10} aria-hidden="true" /> 胜者
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[10px] text-faint">
            公开 ID：
            <span className="mono ml-0.5 text-[11px] text-muted">
              {identity.userId ?? '服务器未提供'}
            </span>
          </p>
        </div>
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-lg ${
            identity.isSelf ? 'bg-forest-900/[0.08] text-forest-800' : 'bg-canvas text-moss'
          }`}
        >
          {identity.isSelf ? <Bot size={16} /> : <User size={16} />}
        </span>
      </header>

      <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10px] text-muted">
        <span className="rounded bg-canvas px-1.5 py-0.5">索引 {identity.index}</span>
        <span className="rounded bg-canvas px-1.5 py-0.5">阵营 {formatCount(identity.team)}</span>
        <span className="rounded bg-canvas px-1.5 py-0.5">
          Star {formatNumber(identity.stars, '未获取')}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <StatValue<number>
          label="领地"
          first={first?.land ?? null}
          last={last?.land ?? null}
          hasFirst={initialHasPlayer}
          hasLast={lastHasPlayer}
          format={(value) => formatNumber(value)}
        />
        <StatValue<number>
          label="兵力"
          first={first?.army ?? null}
          last={last?.army ?? null}
          hasFirst={initialHasPlayer}
          hasLast={lastHasPlayer}
          format={(value) => formatNumber(value)}
        />
        <StatValue<number>
          label="城市"
          first={first?.cities ?? null}
          last={last?.cities ?? null}
          hasFirst={initialHasPlayer}
          hasLast={lastHasPlayer}
          format={(value) => formatNumber(value)}
          title={citiesTitle}
        />
        <StatValue<number>
          label="已见城市下限"
          first={first?.visibleCities ?? null}
          last={last?.visibleCities ?? null}
          hasFirst={initialHasPlayer}
          hasLast={lastHasPlayer}
          format={(value) => (value === null ? '—' : `≥ ${formatNumber(value)}`)}
          title="视野内可见的城市数量下限"
        />
        <StatValue<boolean>
          label="存活"
          first={first?.alive ?? null}
          last={last?.alive ?? null}
          hasFirst={initialHasPlayer}
          hasLast={lastHasPlayer}
          format={(value) => (value === null ? '—' : value ? '存活' : '已出局')}
          tone={(value) => (value === null ? '' : value ? 'text-[#4d7431]' : 'text-danger')}
        />
      </dl>
    </article>
  );
}

function AgentStats({ agent }: { agent: MatchAgentStats }) {
  const counts: Array<[string, number]> = [
    ['观察次数', agent.observations],
    ['策略步数', agent.decisions],
    ['已提交移动', agent.submittedMoves],
    ['Pass 次数', agent.passes],
    ['跳过移动', agent.skippedMoves],
    ['分兵移动', agent.splitMoves],
  ];
  const latencies: Array<[string, string]> = [
    ['推理总耗时', formatMilliseconds(agent.totalLatencyMs)],
    [
      '平均推理耗时',
      agent.decisions > 0
        ? formatMilliseconds(agent.totalLatencyMs / agent.decisions)
        : '无策略步数',
    ],
    ['最大推理耗时', formatMilliseconds(agent.maxLatencyMs)],
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
      <div>
        <p className="meta-label">计步</p>
        <dl className="mt-2 grid grid-cols-3 gap-2">
          {counts.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-canvas/70 px-2.5 py-2">
              <dt className="text-[10px] leading-tight text-faint">{label}</dt>
              <dd className="mt-0.5 text-[13px] font-medium tabular text-ink">
                {value.toLocaleString('zh-CN')}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <p className="meta-label">推理耗时</p>
        <dl className="mt-2 space-y-1.5">
          {latencies.map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-3 border-b border-line/70 pb-1.5 last:border-0"
            >
              <dt className="text-[11px] text-muted">{label}</dt>
              <dd className="text-right font-mono text-[11px] tabular text-ink-soft">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export function MatchDetails({ match }: { match: MatchRecord }) {
  const { details } = match;
  const replay = replayHref(match.replayUrl);
  const initial = details?.initial ?? null;
  const last = details?.last ?? null;
  const hasInitial = Boolean(initial);
  const hasLast = Boolean(last);
  const playerRows = buildPlayerRows(initial, last);
  const winnerIndex = details?.winnerIndex ?? null;

  const map = compareText(snapshotMap(initial), snapshotMap(last), '未采集');
  const gameType = compareText(snapshotGameType(initial), snapshotGameType(last), '服务器未提供');
  const teams = compareText(snapshotTeams(initial), snapshotTeams(last), '未提供');
  const modifiers = compareText(snapshotModifiers(initial), snapshotModifiers(last), '未提供');
  const torus = compareText(snapshotTorus(initial), snapshotTorus(last), '未采集');
  const hasMetaConflict = [map, gameType, teams, modifiers, torus].some((item) => item.changed);

  const duration =
    details?.durationMs == null
      ? '未采集'
      : `${(details.durationMs / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 3 })} 秒`;

  return (
    <section
      className="match-details bg-canvas/70 px-4 py-5 sm:px-6 sm:py-6"
      aria-label={`对局 ${match.gameId || match.id} 详情`}
    >
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-sm font-semibold tracking-tight text-ink">对局详情</h3>
            <OutcomeBadge outcome={match.outcome} />
          </div>
          {replay ? (
            <a
              className="btn btn-secondary btn-sm"
              href={replay}
              target="_blank"
              rel="noopener noreferrer"
            >
              打开回放 <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          ) : (
            <span className="text-[11px] text-faint">暂无回放</span>
          )}
        </header>

        <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
          <InfoCard title="对局信息" icon={<Swords size={15} />}>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3.5 min-[440px]:grid-cols-2">
              <Detail label="开始时间">
                <TimeText value={match.startedAt} />
              </Detail>
              <Detail label="结束时间">
                {match.endedAt ? <TimeText value={match.endedAt} /> : '尚未记录结束'}
              </Detail>
              <Detail label="时长">{duration}</Detail>
              <Detail label="已记录回合">{formatCount(match.turns)}</Detail>
              <Detail label="服务器">{match.server}</Detail>
              <Detail label="对手">{match.opponent || '服务器未提供'}</Detail>
              <Detail label="终局原因">
                {details ? (details.endReason ?? '服务器未提供') : '未采集'}
              </Detail>
              <Detail label="获胜玩家索引">
                {details ? formatCount(details.winnerIndex) : '未采集'}
              </Detail>
            </dl>
          </InfoCard>

          <InfoCard
            title="标识"
            icon={<Fingerprint size={15} />}
            caption="运行、记录与对局 ID 用于定位原始数据。"
          >
            <dl className="space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <dt className="meta-label pt-0.5">运行 ID</dt>
                <dd className="mono min-w-0 break-all text-right text-[11px] text-ink-soft">
                  {match.runId}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="meta-label pt-0.5">记录 ID</dt>
                <dd className="mono min-w-0 break-all text-right text-[11px] text-ink-soft">
                  {match.id}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="meta-label pt-0.5">对局 ID</dt>
                <dd className="mono min-w-0 break-all text-right text-[11px] text-ink-soft">
                  {match.gameId || '等待分配'}
                </dd>
              </div>
            </dl>
          </InfoCard>
        </div>

        {details ? (
          <>
            <InfoCard
              title="地图与规则"
              icon={<MapPinned size={15} />}
              caption="首个与最后快照中相同的信息只显示一次；不一致时按 首个 → 最后 展示。"
            >
              <dl className="grid grid-cols-1 gap-x-4 gap-y-3.5 min-[440px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
                <MetaItem label="地图尺寸" comparison={map} />
                <MetaItem label="对局类型" comparison={gameType} />
                <MetaItem label="阵营配置" comparison={teams} />
                <MetaItem label="规则修饰项" comparison={modifiers} />
                <MetaItem label="环绕地图（torus）" comparison={torus} />
              </dl>
              {hasMetaConflict && (
                <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-warn">
                  <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                  标记 → 的字段在首个与最后快照中不一致，已同时保留两侧数值。
                </p>
              )}
              <div className="mt-4 grid gap-2.5 border-t border-line pt-4 sm:grid-cols-2">
                <SnapshotPoint label="首个记录的快照" snapshot={initial} />
                <SnapshotPoint label="最后记录的快照" snapshot={last} />
              </div>
            </InfoCard>

            <section aria-label="玩家状态">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                  <Users size={15} className="text-moss" /> 玩家状态
                </h4>
                <span className="inline-flex items-center gap-1 text-[10px] text-faint">
                  数值格式：首个记录 <ArrowRight size={10} aria-hidden="true" />{' '}
                  最后记录，相同值只显示一次
                </span>
              </div>
              {playerRows.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {playerRows.map((row) => (
                    <PlayerCard
                      key={row.identity.index}
                      row={row}
                      hasInitial={hasInitial}
                      hasLast={hasLast}
                      winnerIndex={winnerIndex}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs text-muted">
                  玩家信息未采集。
                </p>
              )}
              <p className="mt-2 text-[10px] leading-relaxed text-faint">
                城市：服务器未提供或视野不完整时显示为 —；已见城市仅表示视野内可见数量的下限。
              </p>
            </section>

            <InfoCard
              title="Agent 计步与推理"
              icon={<Cpu size={15} />}
              caption="平均推理耗时按策略步数计算；已提交移动不等于服务器实际执行。"
            >
              <AgentStats agent={details.agent} />
            </InfoCard>

            <p className="flex items-start gap-2 rounded-xl border border-warn/20 bg-warn/[0.06] px-3.5 py-2.5 text-[11px] leading-relaxed text-warn">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                最后记录的快照，不一定是完整终局。城市数未提供或视野不完整时不计为
                0；记录回合与原始服务器回合（serverTurn）已分开展示。
              </span>
            </p>
          </>
        ) : (
          <p className="flex items-start gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
            <Clock3 size={14} className="mt-0.5 shrink-0 text-moss" aria-hidden="true" />
            此记录的快照和 Agent 计步详情未采集。
          </p>
        )}
      </div>
    </section>
  );
}
