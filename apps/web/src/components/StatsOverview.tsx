import { ArrowUpRight, CirclePause, Flag, Trophy } from 'lucide-react';
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
  );
}
