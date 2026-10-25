import { Activity, ArrowUpRight, CirclePause, Flag, Trophy } from 'lucide-react';
import type { Stats } from '../../../../packages/contracts/src/index';

type Props = {
  stats: Stats;
};

export function StatsOverview({ stats }: Props) {
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
    <section aria-labelledby="stats-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="stats-heading" className="panel-heading">
          <Activity size={17} /> 数据概览
        </h2>
        <span className="rounded-full border border-line bg-surface px-3 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
          仅真实记录
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, hint, icon: Icon, featured }) => (
          <article
            key={label}
            className={`relative overflow-hidden rounded-2xl p-5 ${
              featured
                ? 'bg-forest-950 text-white shadow-lift'
                : 'panel border-line bg-surface shadow-card'
            }`}
          >
            {featured && (
              <div
                className="pointer-events-none absolute -right-8 -top-12 size-36 rounded-full bg-lime/10 blur-2xl"
                aria-hidden="true"
              />
            )}
            <div className="relative flex items-start justify-between gap-3">
              <span
                className={`text-[11px] font-medium ${featured ? 'text-white/55' : 'text-muted'}`}
              >
                {label}
              </span>
              <span
                className={`grid size-8 shrink-0 place-items-center rounded-lg ${
                  featured ? 'bg-white/10 text-lime' : 'bg-canvas text-moss'
                }`}
              >
                <Icon size={15} aria-hidden="true" />
              </span>
            </div>
            <strong
              className={`relative mt-5 block text-[32px] font-semibold leading-none tracking-[-0.03em] tabular ${
                featured ? 'text-lime' : 'text-ink'
              }`}
            >
              {value}
            </strong>
            <p
              className={`relative mt-3 text-[11px] leading-relaxed ${
                featured ? 'text-white/40' : 'text-faint'
              }`}
            >
              {hint}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
