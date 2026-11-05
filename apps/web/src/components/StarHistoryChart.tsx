import type { TooltipComponentOption } from 'echarts/components';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import { ArrowUpRight, ChartNoAxesCombined, RotateCcw, Scan } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StarHistoryItem } from '../../../../packages/contracts/src/index';
import { formatDateTime } from '../lib/format';
import { formatStars } from './StarChange';

export type StarHistoryAxis = 'matches' | 'time';

type PlotPoint = {
  gameNumber?: number;
  baseline?: boolean;
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

export function starHistoryOption(
  matches: StarHistoryItem[],
  axis: StarHistoryAxis = 'matches',
): EChartsCoreOption {
  const ordered = [...matches].sort((a, b) => observationTime(a) - observationTime(b));
  const points: PlotPoint[] = ordered.map((record, index) => ({
    value: [axis === 'time' ? observationTime(record) : index + 1, record.rating?.after ?? null],
    gameNumber: index + 1,
    record,
    source: record.rating?.source ?? null,
  }));
  const first = points.find((point) => point.value[1] !== null)?.record;
  if (
    first?.rating?.delta != null &&
    first.rating.before !== null &&
    first.rating.source !== null
  ) {
    const beforeTime = Date.parse(first.startedAt);
    if (beforeTime < observationTime(first)) {
      points.push({
        value: [
          axis === 'time'
            ? beforeTime
            : points.find((point) => point.record === first)!.value[0] - 1,
          first.rating.before,
        ],
        baseline: true,
        gameNumber: points.find((point) => point.record === first)!.gameNumber! - 1,
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
    point.symbolSize =
      point.value[1] !== null && (!connected.has(point) || matches.length <= 60) ? 5 : 0;
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
      const rawPoint = item?.data as PlotPoint | undefined;
      const point = rawPoint?.record
        ? rawPoint
        : points.find((candidate) => candidate.value[0] === rawPoint?.value[0] && candidate.record);
      if (!point?.record) return '';
      const value = point.value[1];
      const source = point.source === 'public-profile' ? '公开采样' : '游戏事件';
      return `第 ${point.gameNumber} 局${point.baseline ? ' · 初始评分' : ''} · ${formatDateTime(point.baseline ? point.record.startedAt : (point.record.endedAt ?? point.record.startedAt))}\n${value === null ? '未采集评分' : `${formatStars(value)} Star · ${point.source == null ? '来源未知' : source}`}\n点击查看对局 ↗`;
    },
  };
  return {
    animation: false,
    grid: { top: 18, right: 20, bottom: 76, left: 54 },
    tooltip,
    // Keep the box-zoom controller mounted; React renders the visible controls.
    toolbox: {
      itemSize: 0,
      itemGap: 0,
      showTitle: false,
      feature: {
        dataZoom: {
          yAxisIndex: 'none',
          brushStyle: { color: 'rgba(0,128,128,0.08)', borderColor: '#008080', borderWidth: 1 },
        },
      },
    },
    xAxis: {
      type: axis === 'time' ? 'time' : 'value',
      minInterval: axis === 'matches' ? 1 : undefined,
      min: axis === 'matches' ? 0 : 'dataMin',
      max: axis === 'matches' ? Math.max(1, ordered.length) : 'dataMax',
      boundaryGap: false,
      splitNumber: 5,
      axisLabel: {
        color: '#8a9b92',
        fontSize: 10,
        hideOverlap: true,
        formatter:
          axis === 'matches'
            ? (value: number) => (Number.isInteger(value) && value >= 0 ? String(value) : '')
            : undefined,
      },
      axisLine: { onZero: false, lineStyle: { color: '#e0e8e3' } },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      min: ({ min, max }: { min: number; max: number }) =>
        Math.max(0, Math.floor((min - Math.max((max - min) * 0.15, 0.2)) * 10) / 10),
      max: ({ min, max }: { min: number; max: number }) =>
        Math.ceil((max + Math.max((max - min) * 0.15, 0.2)) * 10) / 10,
      minInterval: 0.1,
      splitNumber: 4,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#8a9b92', fontSize: 10, formatter: formatStars },
      splitLine: { lineStyle: { color: '#edf1ee', width: 1 } },
    },
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: 0,
        start: 0,
        end: 100,
        filterMode: 'filter',
        zoomOnMouseWheel: 'ctrl',
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        preventDefaultMouseMove: true,
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        start: 0,
        end: 100,
        filterMode: 'filter',
        bottom: 10,
        left: 52,
        right: 18,
        height: 22,
        borderColor: '#dce5df',
        backgroundColor: '#f7faf9',
        dataBackground: { lineStyle: { color: '#b1c9c1' }, areaStyle: { color: '#e6efeb' } },
        selectedDataBackground: {
          lineStyle: { color: '#008080' },
          areaStyle: { color: '#d7eae4' },
        },
        fillerColor: 'rgba(0,128,128,0.08)',
        showDataShadow: true,
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
        lineStyle: { width: 2, color: '#008080' },
        itemStyle: { color: '#008080' },
        emphasis: { scale: true, itemStyle: { borderColor: '#fff', borderWidth: 2 } },
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

type ChartProps = {
  matches: StarHistoryItem[];
  onOpenMatch?: (match: StarHistoryItem) => void;
};

function AccountStarChart({ matches, onOpenMatch }: ChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const [axis, setAxis] = useState<StarHistoryAxis>('matches');
  const [boxZoom, setBoxZoom] = useState(false);
  const boxZoomRef = useRef(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const ordered = useMemo(
    () => [...matches].sort((a, b) => observationTime(a) - observationTime(b)),
    [matches],
  );
  const sampled = ordered.filter((match) => match.rating?.after != null);
  const latest = sampled.at(-1)!;
  const selected = ordered.find((match) => match.id === selectedId) ?? latest;
  const selectedIndex = ordered.indexOf(selected);
  const peak = sampled.reduce((value, match) => Math.max(value, match.rating!.after!), 0);
  const account =
    sampled.find((match) => match.rating?.username != null)?.rating?.username ?? '未知账号';
  const chartRef = useRef<EChartsType | null>(null);
  const appliedSignature = useRef<string | null>(null);
  const appliedAxis = useRef(axis);
  const signature = JSON.stringify([
    axis,
    matches.map((match) => [
      match.id,
      match.runId,
      match.server,
      match.gameId,
      match.startedAt,
      match.endedAt,
      match.rating,
    ]),
  ]);
  const latestData = useRef({ matches: ordered, signature, axis, onOpenMatch });

  useEffect(() => {
    latestData.current = { matches: ordered, signature, axis, onOpenMatch };
    const chart = chartRef.current;
    if (!chart || appliedSignature.current === signature) return;
    const zoom = (
      chart.getOption().dataZoom as
        | {
            start: number;
            end: number;
            startValue?: number;
            endValue?: number;
          }[]
        | undefined
    )?.[0];
    chart.setOption(starHistoryOption(ordered, axis), { notMerge: true });
    if (
      appliedAxis.current === axis &&
      zoom &&
      (zoom.start !== 0 || zoom.end !== 100) &&
      typeof zoom.startValue === 'number' &&
      typeof zoom.endValue === 'number'
    ) {
      chart.dispatchAction(
        { type: 'dataZoom', startValue: zoom.startValue, endValue: zoom.endValue },
        { silent: true },
      );
    }
    if (boxZoomRef.current) {
      chart.dispatchAction({
        type: 'takeGlobalCursor',
        key: 'dataZoomSelect',
        dataZoomSelectActive: true,
      });
    }
    appliedSignature.current = signature;
    appliedAxis.current = axis;
  }, [ordered, signature, axis, onOpenMatch]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let chart: EChartsType | undefined;
    let disposed = false;
    let loading = false;
    let width = 0;
    let height = 0;
    setLoadError(false);
    const nearest = (value: number) => {
      const current = latestData.current;
      const firstIndex = current.matches.findIndex((match) => match.rating?.after != null);
      const first = current.matches[firstIndex];
      const baseline =
        first?.rating?.before != null &&
        first.rating.delta != null &&
        first.rating.source != null &&
        Date.parse(first.startedAt) < observationTime(first)
          ? first
          : undefined;
      let distance = baseline
        ? Math.abs((current.axis === 'time' ? Date.parse(baseline.startedAt) : firstIndex) - value)
        : Infinity;
      return current.matches.reduce<StarHistoryItem | undefined>((closest, match, index) => {
        const x = current.axis === 'time' ? observationTime(match) : index + 1;
        const nextDistance = Math.abs(x - value);
        if (nextDistance >= distance) return closest;
        distance = nextDistance;
        return match;
      }, baseline);
    };
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
            chart.setOption(starHistoryOption(current.matches, current.axis), { notMerge: true });
            chartRef.current = chart;
            appliedSignature.current = current.signature;
            appliedAxis.current = current.axis;
            if (boxZoomRef.current) {
              chart.dispatchAction({
                type: 'takeGlobalCursor',
                key: 'dataZoomSelect',
                dataZoomSelectActive: true,
              });
            }
            chart.on('updateAxisPointer', (event: unknown) => {
              const info = event as { axesInfo?: { axisDim: string; value: number }[] };
              const value = info.axesInfo?.find((info) => info.axisDim === 'x')?.value;
              if (value != null) {
                const match = nearest(value);
                if (match) setSelectedId(match.id);
              }
            });
            let pointerDown: [number, number] | undefined;
            chart.getZr().on('mousedown', (event) => {
              pointerDown = [event.offsetX, event.offsetY];
            });
            chart.getZr().on('click', (event) => {
              if (!chart || !chart.containPixel('grid', [event.offsetX, event.offsetY])) return;
              if (
                pointerDown &&
                Math.hypot(event.offsetX - pointerDown[0], event.offsetY - pointerDown[1]) > 5
              )
                return;
              if (boxZoomRef.current) return;
              const value = chart.convertFromPixel({ xAxisIndex: 0 }, event.offsetX) as number;
              const match = nearest(value);
              if (match) latestData.current.onOpenMatch?.(match);
            });
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

  function selectBox(active: boolean) {
    boxZoomRef.current = active;
    setBoxZoom(active);
    chartRef.current?.dispatchAction({
      type: 'takeGlobalCursor',
      key: 'dataZoomSelect',
      dataZoomSelectActive: active,
    });
  }

  function showRange(count?: number) {
    selectBox(false);
    if (!count || count >= ordered.length) {
      chartRef.current?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
    } else {
      const start = ordered.length - count;
      chartRef.current?.dispatchAction({
        type: 'dataZoom',
        startValue: axis === 'time' ? observationTime(ordered[start]!) : start + 1,
        endValue: axis === 'time' ? observationTime(ordered.at(-1)!) : ordered.length,
      });
    }
  }

  return (
    <div className="min-w-0 rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4 px-4 pt-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span className="size-1.5 rounded-full bg-teal" />
            <span className="max-w-48 truncate font-medium text-ink-soft" title={account}>
              {account}
            </span>
            <span className="text-faint">{matches[0]!.server}</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="tabular text-[30px] font-semibold leading-tight tracking-tight text-ink">
              {formatStars(latest.rating!.after!)}
            </span>
            <span className="text-[11px] text-muted">Star</span>
          </div>
          <p className="mt-1 text-[10px] text-faint">
            最新采样 · {formatDateTime(latest.endedAt ?? latest.startedAt)}
          </p>
        </div>
        <div className="flex items-center gap-5 py-1 text-[10px] text-muted">
          <div>
            <p>历史最高</p>
            <p className="mt-1 tabular text-sm font-medium text-ink-soft">{formatStars(peak)}</p>
          </div>
          <div className="border-l border-line pl-5">
            <p>采样覆盖</p>
            <p className="mt-1 tabular text-sm font-medium text-ink-soft">
              {sampled.length}
              <span className="text-[10px] font-normal text-faint"> / {ordered.length} 局</span>
            </p>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-y border-line bg-surface-subtle px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted">横轴</span>
          <div
            className="flex rounded border border-line bg-surface p-0.5"
            role="group"
            aria-label={`${account} 的横轴模式`}
          >
            {(['matches', 'time'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={axis === mode}
                className={`rounded-sm px-3 py-1 text-[11px] transition-colors ${axis === mode ? 'bg-teal font-medium text-white' : 'text-muted hover:bg-canvas hover:text-ink'}`}
                onClick={() => {
                  selectBox(false);
                  setAxis(mode);
                }}
              >
                {mode === 'matches' ? '局数' : '时间'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={ordered.length <= 30}
            onClick={() => showRange(30)}
          >
            最近 30 局
          </button>
          <button
            type="button"
            className={`btn btn-sm ${boxZoom ? 'btn-primary' : 'btn-ghost'}`}
            aria-pressed={boxZoom}
            onClick={() => selectBox(!boxZoom)}
          >
            <Scan size={12} />
            框选
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => showRange()}>
            <RotateCcw size={12} />
            全部
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between px-4 pt-3 text-[9px] text-faint">
        <span>STAR</span>
        <span>纵轴自动缩放 · {axis === 'matches' ? '每局等距' : '真实时间间隔'}</span>
      </div>
      {loadError && (
        <p role="status" className="px-4 py-2 text-[11px] text-danger">
          图表加载失败，请刷新页面重试；下方对局列表仍可查看评分。
        </p>
      )}
      <div
        ref={container}
        className="h-72 w-full outline-offset-[-3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal sm:h-80"
        role="img"
        tabIndex={0}
        aria-label={`${account} 的完整 Star 历史图，点击查看对局；左右键选择对局，Enter 打开；可框选放大、拖动平移，Ctrl + 滚轮缩放；虚线表示缺失区间`}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onOpenMatch?.(selected);
          }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            const index = Math.max(
              0,
              Math.min(ordered.length - 1, selectedIndex + (event.key === 'ArrowLeft' ? -1 : 1)),
            );
            setSelectedId(ordered[index]!.id);
          }
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-subtle px-4 py-2.5">
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="font-medium text-ink-soft">第 {selectedIndex + 1} 局</span>
          <span>{formatDateTime(selected.endedAt ?? selected.startedAt)}</span>
          <span className="tabular font-medium text-teal">
            {selected.rating?.after == null
              ? '未采集评分'
              : `${formatStars(selected.rating.after)} Star`}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!onOpenMatch}
          onClick={() => onOpenMatch?.(selected)}
        >
          查看对局
          <ArrowUpRight size={12} />
        </button>
      </div>
    </div>
  );
}

export function StarHistoryChart({ matches, onOpenMatch }: ChartProps) {
  const groups = useMemo(() => groupStarHistory(matches), [matches]);
  return (
    <section
      className="space-y-3 border-b border-line bg-canvas/40 px-3 py-4 sm:px-4"
      aria-label="Star 历史图"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-semibold text-ink">
          <ChartNoAxesCombined size={14} className="text-teal" />
          Star 历史
        </h3>
        {groups.size > 0 && (
          <span className="text-[10px] text-muted">点击图表查看对局 · 拖动底部滑块缩放</span>
        )}
      </header>
      {groups.size ? (
        [...groups].map(([key, items]) => (
          <AccountStarChart key={key} matches={items} onOpenMatch={onOpenMatch} />
        ))
      ) : (
        <p className="py-6 text-center text-[11px] text-muted">暂无可用的赛后 Star 记录</p>
      )}
      {groups.size > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px] text-faint">
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-teal" />
            已采样评分
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t border-dashed border-teal/50" />
            缺失区间
          </span>
          <span>采样来源变化时断开连线 · Ctrl + 滚轮缩放</span>
        </div>
      )}
    </section>
  );
}
