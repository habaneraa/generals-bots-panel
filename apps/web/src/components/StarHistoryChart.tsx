import type { TooltipComponentOption } from 'echarts/components';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StarHistoryItem } from '../../../../packages/contracts/src/index';
import { formatDateTime } from '../lib/format';
import { formatStars } from './StarChange';

type PlotPoint = {
  value: [number, number | null];
  record?: StarHistoryItem;
  source?: NonNullable<StarHistoryItem['rating']>['source'];
  symbolSize?: number;
};

function observationTime(match: StarHistoryItem): number {
  return Date.parse(match.endedAt ?? match.startedAt);
}

export function groupStarHistory(matches: StarHistoryItem[]): Map<string, StarHistoryItem[]> {
  const accounts = new Map<string, Set<string>>();
  for (const match of matches) {
    if (match.rating?.username == null) continue;
    const run = JSON.stringify([match.server, match.runId]);
    const names = accounts.get(run) ?? new Set<string>();
    names.add(match.rating.username);
    accounts.set(run, names);
  }
  const groups = new Map<string, StarHistoryItem[]>();
  const ordered = [...matches].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  for (const match of ordered) {
    const names = accounts.get(JSON.stringify([match.server, match.runId]));
    const username = match.rating?.username ?? (names?.size === 1 ? [...names][0] : null);
    const key = JSON.stringify([match.server, username ?? match.runId]);
    const group = groups.get(key) ?? [];
    group.push(match);
    groups.set(key, group);
  }
  for (const [key, items] of groups) {
    if (!items.some((match) => match.rating?.after != null)) groups.delete(key);
  }
  return groups;
}

export function starHistoryOption(matches: StarHistoryItem[]): EChartsCoreOption {
  const points: PlotPoint[] = matches.map((record) => ({
    value: [observationTime(record), record.rating?.after ?? null],
    record,
    source: record.rating?.source ?? null,
  }));
  points.sort((a, b) => a.value[0] - b.value[0]);
  const first = points.find((point) => point.value[1] !== null)?.record;
  if (
    first?.rating?.delta != null &&
    first.rating.before !== null &&
    first.rating.source !== null
  ) {
    const beforeTime = Date.parse(first.startedAt);
    if (beforeTime < observationTime(first)) {
      points.push({
        value: [beforeTime, first.rating.before],
        record: first,
        source: first.rating.source,
      });
      points.sort((a, b) => a.value[0] - b.value[0]);
    }
  }

  const measured: PlotPoint[] = [];
  const gaps: [number, number | null][] = [];
  const connected = new Set<PlotPoint>();
  let previous: PlotPoint | undefined;
  let previousIndex = -1;
  for (const [index, point] of points.entries()) {
    if (point.value[1] !== null) {
      if (previous) {
        if (point.source != null && point.source === previous.source) {
          connected.add(previous);
          connected.add(point);
          if (index > previousIndex + 1) {
            gaps.push(previous.value, point.value, [point.value[0], null]);
          }
        } else {
          // A change of sampling source is not a missing comparable observation.
          measured.push({ value: [point.value[0], null] });
        }
      }
      previous = point;
      previousIndex = index;
    }
    measured.push(point);
  }
  for (const point of measured) {
    point.symbolSize = point.value[1] !== null && !connected.has(point) ? 4 : 0;
  }

  const tooltip: TooltipComponentOption = {
    trigger: 'axis',
    renderMode: 'richText',
    confine: true,
    transitionDuration: 0,
    shadowBlur: 0,
    borderWidth: 1,
    borderColor: '#dce5e3',
    backgroundColor: '#fff',
    padding: [7, 9],
    textStyle: { color: '#37534a', fontSize: 11 },
    axisPointer: { type: 'line', lineStyle: { color: '#b9cbc4', type: 'dashed', width: 1 } },
    formatter: (params) => {
      const item = (Array.isArray(params) ? params : [params]).find(
        (item) => item.seriesId === 'stars',
      );
      const point = item?.data as PlotPoint | undefined;
      if (!point?.record) return '';
      const value = point.value[1];
      const source = point.source === 'public-profile' ? '公开采样' : '游戏事件';
      return `${formatDateTime(new Date(point.value[0]).toISOString())}\n${value === null ? '未采集评分' : `${formatStars(value)} Star · ${point.source == null ? '来源未知' : source}`}`;
    },
  };
  return {
    animation: false,
    grid: { top: 36, right: 18, bottom: 68, left: 52 },
    tooltip,
    toolbox: {
      top: 0,
      right: 12,
      itemSize: 13,
      itemGap: 16,
      iconStyle: { borderColor: '#7c8e87', borderWidth: 1.3 },
      emphasis: { iconStyle: { borderColor: '#008080' } },
      feature: {
        dataZoom: {
          yAxisIndex: 'none',
          title: { zoom: '框选放大', back: '返回上一区间' },
          brushStyle: { color: 'transparent', borderColor: '#008080', borderWidth: 1 },
        },
        myPan: {
          show: true,
          title: '拖动平移',
          icon: 'path://M12 2L8 6M12 2L16 6M12 2V22M12 22L8 18M12 22L16 18M2 12L6 8M2 12L6 16M2 12H22M22 12L18 8M22 12L18 16',
          onclick: (_model: unknown, api: Pick<EChartsType, 'dispatchAction'>) => {
            api.dispatchAction({
              type: 'takeGlobalCursor',
              key: 'dataZoomSelect',
              dataZoomSelectActive: false,
            });
          },
        },
        restore: { title: '恢复完整历史' },
      },
    },
    xAxis: {
      type: 'time',
      boundaryGap: false,
      splitNumber: 5,
      axisLabel: { color: '#8a9b92', fontSize: 10, hideOverlap: true },
      axisLine: { lineStyle: { color: '#e0e8e3' } },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      minInterval: 0.1,
      splitNumber: 4,
      axisLabel: { color: '#8a9b92', fontSize: 10, formatter: formatStars },
      splitLine: { lineStyle: { color: '#edf1ee', width: 1 } },
    },
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: 0,
        start: 0,
        end: 100,
        filterMode: 'none',
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        preventDefaultMouseMove: true,
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        start: 0,
        end: 100,
        filterMode: 'none',
        bottom: 15,
        left: 52,
        right: 18,
        height: 18,
        borderColor: '#dce5df',
        backgroundColor: '#fff',
        fillerColor: 'transparent',
        showDataShadow: false,
        showDetail: false,
        brushSelect: true,
        brushStyle: { color: 'transparent', borderColor: '#008080', borderWidth: 1 },
        handleSize: 14,
        moveHandleSize: 0,
        handleStyle: { color: '#fff', borderColor: '#739f90', borderWidth: 1 },
      },
    ],
    series: [
      {
        id: 'stars',
        type: 'line',
        data: measured,
        showSymbol: true,
        showAllSymbol: true,
        symbol: 'circle',
        connectNulls: false,
        lineStyle: { width: 1.8, color: '#008080' },
        itemStyle: { color: '#008080' },
        emphasis: { scale: false },
        z: 3,
      },
      {
        id: 'missing',
        type: 'line',
        data: gaps,
        showSymbol: false,
        connectNulls: false,
        silent: true,
        lineStyle: { width: 1.4, type: 'dashed', color: '#84aaa0' },
        tooltip: { show: false },
        emphasis: { disabled: true },
        z: 2,
      },
    ],
  };
}

function AccountStarChart({
  matches,
  showAccount,
}: {
  matches: StarHistoryItem[];
  showAccount: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState(false);
  const account =
    matches.find((match) => match.rating?.username != null)?.rating?.username ?? '未知账号';
  const chartRef = useRef<EChartsType | null>(null);
  const appliedSignature = useRef<string | null>(null);
  const signature = JSON.stringify(
    matches.map((match) => [
      match.id,
      match.runId,
      match.server,
      match.gameId,
      match.startedAt,
      match.endedAt,
      match.rating,
    ]),
  );
  const latestData = useRef({ matches, signature });

  useEffect(() => {
    latestData.current = { matches, signature };
    if (chartRef.current && appliedSignature.current !== signature) {
      const option = starHistoryOption(matches);
      const zoom = (
        chartRef.current.getOption().dataZoom as
          | {
              start: number;
              end: number;
              startValue: number;
              endValue: number;
            }[]
          | undefined
      )?.[0];
      chartRef.current.setOption(option, { notMerge: true });
      if (
        zoom &&
        (zoom.start !== 0 || zoom.end !== 100) &&
        typeof zoom.startValue === 'number' &&
        typeof zoom.endValue === 'number'
      ) {
        chartRef.current.dispatchAction(
          { type: 'dataZoom', startValue: zoom.startValue, endValue: zoom.endValue },
          { silent: true },
        );
      }
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
    <div className="min-w-0">
      {showAccount && (
        <p className="text-[10px] text-muted">
          {account} · {matches[0]!.server}
        </p>
      )}
      {loadError && (
        <p role="status" className="py-2 text-[11px] text-danger">
          图表加载失败，请刷新页面重试；下方对局列表仍可查看评分。
        </p>
      )}
      <div
        ref={container}
        className="h-72 w-full sm:h-80"
        role="img"
        aria-label={`${account} 的完整 Star 历史图，可框选放大、拖动平移；虚线表示缺失区间`}
      />
    </div>
  );
}

export function StarHistoryChart({ matches }: { matches: StarHistoryItem[] }) {
  const groups = useMemo(() => groupStarHistory(matches), [matches]);
  return (
    <section
      className="space-y-2 border-b border-line bg-surface px-4 py-3"
      aria-label="Star 历史图"
    >
      <h3 className="text-xs font-semibold text-ink">Star 历史</h3>
      {groups.size ? (
        [...groups].map(([key, items]) => (
          <AccountStarChart key={key} matches={items} showAccount={groups.size > 1} />
        ))
      ) : (
        <p className="py-4 text-center text-[11px] text-muted">暂无可用的赛后 Star 记录</p>
      )}
    </section>
  );
}
