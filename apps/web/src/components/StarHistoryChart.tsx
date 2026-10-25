import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import { TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MatchRecord } from '../../../../packages/contracts/src/index';
import { formatDateTime } from '../lib/format';
import { formatStars, starChangePresentation, starChangeTone } from './StarChange';

export function groupStarHistory(matches: MatchRecord[]): Map<string, MatchRecord[]> {
  const groups = new Map<string, MatchRecord[]>();
  const ordered = [...matches].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  for (const match of ordered) {
    if (!match.rating || (match.rating.before === null && match.rating.after === null)) continue;
    const key = JSON.stringify([match.server, match.rating.username ?? match.runId]);
    const group = groups.get(key) ?? [];
    group.push(match);
    groups.set(key, group);
  }
  return groups;
}

export function starHistoryOption(matches: MatchRecord[]): EChartsCoreOption {
  return {
    animation: false,
    grid: { top: 18, right: 18, bottom: 32, left: 52 },
    tooltip: { trigger: 'item', renderMode: 'richText', confine: true },
    xAxis: {
      type: 'category',
      data: ['赛前', ...matches.map((match) => formatDateTime(match.startedAt))],
      boundaryGap: false,
      axisLabel: { color: '#647878', fontSize: 10, hideOverlap: true },
      axisLine: { lineStyle: { color: '#e1e8e8' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      minInterval: 0.1,
      axisLabel: { color: '#647878', fontSize: 10, formatter: formatStars },
      splitLine: { lineStyle: { color: '#e1e8e8', type: 'dashed' } },
    },
    series: matches.map((match, index) => {
      const rating = match.rating!;
      const color =
        rating.delta === null || rating.delta === 0
          ? '#647878'
          : rating.delta > 0
            ? '#15803d'
            : '#dc2626';
      const change = starChangePresentation(rating);
      const incomparable = rating.delta === null && rating.before !== null && rating.after !== null;
      return {
        type: 'line',
        name: match.gameId || match.id,
        data: [
          [index, incomparable ? null : rating.before],
          [index + 1, rating.after],
        ],
        connectNulls: false,
        symbol: 'circle',
        symbolSize: 7,
        lineStyle: { color, width: 2 },
        itemStyle: { color },
        tooltip: {
          formatter: () =>
            [
              formatDateTime(match.startedAt),
              `对局 ${match.gameId || match.id}`,
              `赛前 ${rating.before === null ? '—' : formatStars(rating.before)}`,
              `赛后 ${rating.after === null ? '—' : formatStars(rating.after)}`,
              `Star 变化 ${change.label}`,
              ...(change.note ? [change.note] : []),
            ].join('\n'),
        },
      };
    }),
  };
}

function AccountStarChart({ matches }: { matches: MatchRecord[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState(false);
  const first = matches[0]!;
  const latest = matches.at(-1)!;
  const latestStars = latest.rating?.after;
  const delta = latest.rating?.delta ?? null;

  const chartRef = useRef<EChartsType | null>(null);
  const appliedSignature = useRef<string | null>(null);
  const signature = JSON.stringify(
    matches.map((match) => [
      match.id,
      match.gameId,
      match.startedAt,
      match.rating?.before,
      match.rating?.after,
      match.rating?.delta,
    ]),
  );
  const latestData = useRef({ matches, signature });

  useEffect(() => {
    latestData.current = { matches, signature };
    if (chartRef.current && appliedSignature.current !== signature) {
      chartRef.current.setOption(starHistoryOption(matches), { notMerge: true });
      appliedSignature.current = signature;
    }
  }, [matches, signature]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let chart: EChartsType | undefined;
    let disposed = false;
    let loading = false;
    let width = 0;
    let height = 0;
    setLoadError(false);
    const resize = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      if (chart) {
        if (width === element.clientWidth && height === element.clientHeight) return;
        width = element.clientWidth;
        height = element.clientHeight;
        chart.resize();
      } else if (!loading) {
        loading = true;
        void import('../lib/starChartEngine')
          .then(({ init }) => {
            if (disposed) return;
            if (!element.clientWidth || !element.clientHeight) {
              loading = false;
              return;
            }
            chart = init(element);
            const current = latestData.current;
            chart.setOption(starHistoryOption(current.matches), { notMerge: true });
            chartRef.current = chart;
            appliedSignature.current = current.signature;
            width = element.clientWidth;
            height = element.clientHeight;
          })
          .catch(() => {
            chart?.dispose();
            chart = undefined;
            chartRef.current = null;
            appliedSignature.current = null;
            if (!disposed) setLoadError(true);
          });
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => {
      disposed = true;
      observer.disconnect();
      chart?.dispose();
      chartRef.current = null;
      appliedSignature.current = null;
    };
  }, []);

  return (
    <div className="min-w-0 rounded-[3px] border border-line bg-surface px-3 pt-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted">
        <span>
          {first.rating?.username ?? '未知账号'} · {first.server} · {matches.length} 场有评分记录
        </span>
        <span className={`font-semibold tabular ${starChangeTone(delta)}`}>
          最近赛后 {latestStars == null ? '未记录' : `${formatStars(latestStars)} ★`}
        </span>
      </div>
      {loadError && (
        <p role="status" className="py-2 text-[11px] text-danger">
          图表加载失败，请刷新页面重试；下方对局列表仍可查看评分。
        </p>
      )}
      <div
        ref={container}
        className="h-48 w-full"
        role="img"
        aria-label={`${first.rating?.username ?? '未知账号'} 的 Star 变化图，按时间从左到右，共 ${matches.length} 场；详细数值见下方对局列表`}
      />
    </div>
  );
}

export function StarHistoryChart({ matches }: { matches: MatchRecord[] }) {
  const groups = useMemo(() => groupStarHistory(matches), [matches]);
  return (
    <section
      className="space-y-2 border-b border-line bg-surface-subtle px-4 py-3"
      aria-label="Star 变化图"
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <TrendingUp size={13} className="text-teal" /> Star 变化
        </h3>
        <span className="text-[9.5px] text-muted">当前页 · 按时间排序 · 绿涨 / 红跌</span>
      </div>
      {groups.size ? (
        [...groups].map(([key, items]) => <AccountStarChart key={key} matches={items} />)
      ) : (
        <p className="py-4 text-center text-[11px] text-muted">
          当前页暂无 Star 记录；旧记录不会补造评分变化。
        </p>
      )}
      <p className="text-[9.5px] leading-relaxed text-faint">
        缺失评分不连线。公开资料采样可能有结算延迟；未采集到赛前或赛后评分时，不计算涨跌。
      </p>
    </section>
  );
}
