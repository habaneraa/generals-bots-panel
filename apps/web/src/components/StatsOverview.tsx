import {
  ArrowDownRight,
  ArrowUpRight,
  CirclePause,
  Flag,
  Medal,
  Star,
  Trophy,
  UsersRound,
} from 'lucide-react';
import { useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Stats } from '../../../../packages/contracts/src/index';
import {
  MIN_OPPONENT_COMPLETED_MATCHES,
  summarizeMatchStatistics,
  type OpponentSummary,
  type TurnGroup,
} from '../lib/statsEngine';
import { useMatchStats } from '../hooks/useMatchStats';
import { Notice, Spinner } from './Shared';

type Props = {
  stats: Stats;
  active: boolean;
  refreshKey: string;
};

function OutcomeBar({ group }: { group: TurnGroup }) {
  const outcomes = [
    { label: '胜', value: group.won, className: 'bg-teal' },
    { label: '负', value: group.lost, className: 'bg-danger' },
    { label: '平', value: group.draw, className: 'bg-muted' },
    { label: '中断', value: group.interrupted, className: 'bg-warn' },
    { label: '进行中', value: group.playing, className: 'bg-line' },
  ];

  return (
    <div
      className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-canvas"
      role="img"
      aria-label={`${group.label} 回合：${group.won} 胜、${group.lost} 负、${group.draw} 平、${group.interrupted} 中断、${group.playing} 进行中`}
    >
      {group.records > 0 &&
        outcomes.map(
          ({ label, value, className }) =>
            value > 0 && (
              <span
                key={label}
                className={className}
                style={{ width: `${(value / group.records) * 100}%` }}
              />
            ),
        )}
    </div>
  );
}

function TurnGroupCard({ group }: { group: TurnGroup }) {
  return (
    <article className="rounded-[3px] border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-ink">{group.label} 回合</h3>
          <p className="mt-0.5 text-[10px] text-faint">
            {group.records.toLocaleString('zh-CN')} 场
          </p>
        </div>
        <div className="text-right">
          <strong className="block text-base font-semibold tabular text-teal-dark">
            {group.winRate === null ? '—' : `${(group.winRate * 100).toFixed(1)}%`}
          </strong>
          <span className="text-[9px] text-faint">已完成胜率</span>
        </div>
      </div>
      <OutcomeBar group={group} />
      <p className="mt-2 text-[10px] leading-snug text-muted">
        {group.won} 胜 · {group.lost} 负 · {group.draw} 平
        {group.interrupted > 0 && ` · ${group.interrupted} 中断`}
        {group.playing > 0 && ` · ${group.playing} 进行中`}
      </p>
    </article>
  );
}

function OpponentStarBadge({ stars }: { stars: number | null }) {
  const value = stars === null ? '未获取' : stars.toLocaleString('zh-CN');
  return (
    <span
      className="star-badge"
      aria-label={`Star ${value}`}
      title={`最近一次已完成交手后的星数：${value}`}
    >
      <Star size={9} fill="currentColor" aria-hidden="true" />
      {value}
    </span>
  );
}

function OpponentRanking({
  title,
  description,
  icon: Icon,
  opponents,
  metric,
  emptyText,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  opponents: OpponentSummary[];
  metric: 'games' | 'winRate';
  emptyText: string;
}) {
  return (
    <article className="min-w-0 rounded-[3px] border border-line bg-surface">
      <header className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <Icon size={13} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-ink">{title}</h3>
          <p className="mt-0.5 text-[9.5px] leading-snug text-faint">{description}</p>
        </div>
      </header>
      {opponents.length ? (
        <ol className="divide-y divide-line px-3">
          {opponents.map((opponent, index) => (
            <li
              key={opponent.name.toLocaleLowerCase('zh-CN')}
              className="flex min-w-0 items-center justify-between gap-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 text-right font-mono text-[10px] tabular text-faint">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <p
                      className="min-w-0 truncate text-[11px] font-medium text-ink"
                      title={opponent.name}
                    >
                      {opponent.name}
                    </p>
                    <OpponentStarBadge stars={opponent.stars} />
                  </div>
                  <p className="mt-0.5 text-[9px] text-faint">
                    {opponent.won} 胜 · {opponent.lost} 负 · {opponent.draw} 平
                    {opponent.interrupted > 0 && ` · ${opponent.interrupted} 中断`}
                    {opponent.playing > 0 && ` · ${opponent.playing} 进行中`}
                  </p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <strong className="block text-[11px] font-semibold tabular text-ink">
                  {metric === 'games'
                    ? `${opponent.games} 场`
                    : opponent.winRate === null
                      ? '—'
                      : `${(opponent.winRate * 100).toFixed(1)}%`}
                </strong>
                <span className="text-[9px] text-faint">
                  {metric === 'games' ? '交手次数' : `${opponent.completed} 场已完成`}
                </span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-3 py-5 text-center text-[10px] text-muted">{emptyText}</p>
      )}
    </article>
  );
}

export function StatsOverview({ stats, active, refreshKey }: Props) {
  const matchData = useMatchStats(active, refreshKey);
  const analysis = useMemo(
    () => (matchData.matches ? summarizeMatchStatistics(matchData.matches) : null),
    [matchData.matches],
  );
  const cards = [
    {
      label: '已完成对局',
      value: stats.total.toLocaleString('zh-CN'),
      hint: '胜负与平局，不含中断',
      icon: Flag,
      featured: false,
    },
    {
      label: '胜利场次',
      value: stats.won.toLocaleString('zh-CN'),
      hint: `${stats.lost} 场失败 · ${stats.draw} 场平局`,
      icon: Trophy,
      featured: false,
    },
    {
      label: '胜率',
      value: `${Number((stats.winRate * 100).toFixed(1))}%`,
      hint: '胜 /（胜 + 负 + 平），中断不参与',
      icon: ArrowUpRight,
      featured: true,
    },
    {
      label: '中断场次',
      value: stats.interrupted.toLocaleString('zh-CN'),
      hint: '停止或异常结束的对局',
      icon: CirclePause,
      featured: false,
    },
  ];

  return (
    <section className="space-y-4" aria-label="战绩统计">
      <section aria-label="数据概览">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-faint">
            真实记录概览
          </span>
          <span className="rounded-[2px] border border-line bg-surface px-2 py-0.5 text-[9px] uppercase tracking-[0.08em] text-faint">
            仅真实记录
          </span>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(({ label, value, hint, icon: Icon, featured }) => (
            <article
              key={label}
              className={`rounded-[4px] border p-3.5 ${
                featured ? 'border-teal-line bg-teal-soft/55' : 'border-line bg-surface'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] font-medium text-muted">{label}</span>
                <Icon
                  size={14}
                  className={featured ? 'text-teal' : 'text-faint'}
                  aria-hidden="true"
                />
              </div>
              <strong
                className={`mt-2 block text-[26px] font-semibold leading-none tracking-[-0.02em] tabular ${
                  featured ? 'text-teal-dark' : 'text-ink'
                }`}
              >
                {value}
              </strong>
              <p className="mt-2 text-[10px] leading-snug text-faint">{hint}</p>
            </article>
          ))}
        </div>
      </section>

      {active && matchData.loading && !matchData.matches && (
        <div
          className="flex items-center gap-2 rounded-[3px] border border-line bg-surface px-3 py-3 text-[11px] text-muted"
          role="status"
        >
          <Spinner /> 正在读取完整对局样本…
        </div>
      )}
      {active && matchData.error && (
        <Notice
          action={
            <button className="btn btn-danger btn-sm" type="button" onClick={matchData.retry}>
              重试统计
            </button>
          }
        >
          对局统计读取失败：{matchData.error}
        </Notice>
      )}

      {active && analysis && (
        <>
          <section className="panel overflow-hidden" aria-labelledby="turn-stats-heading">
            <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
              <div>
                <h2 id="turn-stats-heading" className="panel-heading">
                  <ArrowDownRight size={14} /> 回合数与结果
                </h2>
                <p className="mt-1 text-[10px] text-muted">
                  对比不同回合区间的胜负分布；进行中和中断不计入胜率。
                </p>
              </div>
              <span className="rounded-[2px] border border-line bg-canvas px-2 py-0.5 text-[9.5px] tabular text-muted">
                {analysis.turnGroups
                  .reduce((sum, group) => sum + group.records, 0)
                  .toLocaleString('zh-CN')}{' '}
                场有效回合
              </span>
            </header>
            <div className="grid gap-2 p-3 sm:grid-cols-3">
              {analysis.turnGroups.map((group) => (
                <TurnGroupCard key={group.label} group={group} />
              ))}
            </div>
            <footer className="border-t border-line bg-surface-subtle px-4 py-2 text-[9.5px] leading-snug text-faint">
              区间为 0–99、100–499、500+；胜率 = 胜 /（胜 + 负 + 平）。
              {analysis.unclassifiedTurns > 0 &&
                ` ${analysis.unclassifiedTurns} 场记录的回合数无效，未纳入分组。`}
            </footer>
          </section>

          <section className="panel overflow-hidden" aria-labelledby="opponent-stats-heading">
            <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
              <div>
                <h2 id="opponent-stats-heading" className="panel-heading">
                  <UsersRound size={14} /> 对手统计
                </h2>
                <p className="mt-1 text-[10px] text-muted">
                  按对手名称聚合历史对局；中断和进行中计入交手次数，不计入胜率。
                </p>
              </div>
              <span className="rounded-[2px] border border-line bg-canvas px-2 py-0.5 text-[9.5px] tabular text-muted">
                {analysis.opponents.length.toLocaleString('zh-CN')} 名对手
              </span>
            </header>
            <div className="grid gap-2 p-3 xl:grid-cols-3">
              <OpponentRanking
                title="最常遇到"
                description="按交手总次数排序"
                icon={UsersRound}
                opponents={analysis.frequentOpponents}
                metric="games"
                emptyText="暂无对手记录"
              />
              <OpponentRanking
                title="对阵胜率最高"
                description={`至少 ${MIN_OPPONENT_COMPLETED_MATCHES} 场已完成对局`}
                icon={Medal}
                opponents={analysis.highestWinRateOpponents}
                metric="winRate"
                emptyText={`暂无达到 ${MIN_OPPONENT_COMPLETED_MATCHES} 场门槛的对手`}
              />
              <OpponentRanking
                title="对阵胜率最低"
                description={`至少 ${MIN_OPPONENT_COMPLETED_MATCHES} 场已完成对局`}
                icon={ArrowDownRight}
                opponents={analysis.lowestWinRateOpponents}
                metric="winRate"
                emptyText={`暂无达到 ${MIN_OPPONENT_COMPLETED_MATCHES} 场门槛的对手`}
              />
            </div>
            <footer className="border-t border-line bg-surface-subtle px-4 py-2 text-[9.5px] leading-snug text-faint">
              胜率榜仅比较至少 {MIN_OPPONENT_COMPLETED_MATCHES}{' '}
              场已完成对局的对手；常遇榜按全部交手记录统计。
            </footer>
          </section>
        </>
      )}
    </section>
  );
}
