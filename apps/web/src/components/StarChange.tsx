import type { MatchRecord } from '../../../../packages/contracts/src/index';

export function formatStars(value: number): string {
  return (Math.abs(value) < 0.05 ? 0 : value).toLocaleString('zh-CN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function starChangePresentation(rating: MatchRecord['rating']): {
  label: string;
  note: string | null;
} {
  if (rating?.delta != null) {
    return {
      label: `${rating.delta > 0 ? '+' : ''}${formatStars(rating.delta)}`,
      note: null,
    };
  }
  if (rating?.before != null && rating.after != null) {
    return {
      label: '不可比较',
      note: '赛前、赛后采样来源或精度不一致，不计算涨跌。',
    };
  }
  if (rating?.before != null) {
    return { label: '缺赛后值', note: '未采集到可用于计算的赛后评分。' };
  }
  if (rating?.after != null) {
    return { label: '缺赛前值', note: '未采集到可用于计算的赛前评分。' };
  }
  return { label: '未记录', note: '未采集到可用于计算的评分。' };
}

export function starChangeTone(delta: number | null): string {
  return delta === null || delta === 0
    ? 'text-muted'
    : delta > 0
      ? 'text-green-700'
      : 'text-red-600';
}

export function StarChange({ match }: { match: MatchRecord }) {
  const rating = match.rating;
  const delta = rating?.delta ?? null;
  const { label, note } = starChangePresentation(rating);
  const before = rating?.before == null ? '—' : formatStars(rating.before);
  const after = rating?.after == null ? '—' : formatStars(rating.after);
  const range = `赛前 ${before}，赛后 ${after}`;
  const description = note ? `${range}。${note}` : range;

  return (
    <span className="inline-flex flex-col items-start gap-0.5 whitespace-nowrap tabular">
      <span
        className={`text-[11px] font-semibold ${starChangeTone(delta)}`}
        title={rating ? description : undefined}
      >
        <span className="sr-only">Star 变化：</span>
        {label}
      </span>
      {rating && (
        <span className="text-[9px] text-faint" aria-label={description}>
          {delta === null ? `赛前 ${before} · 赛后 ${after}` : `${before} → ${after}`}
        </span>
      )}
    </span>
  );
}
