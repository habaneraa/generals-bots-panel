import type { MatchRecord } from '../../../../packages/contracts/src/index';

export function formatStars(value: number): string {
  return (Math.abs(value) < 0.05 ? 0 : value).toLocaleString('zh-CN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
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
  const label = delta === null ? '未记录' : `${delta > 0 ? '+' : ''}${formatStars(delta)}`;
  const before = rating?.before == null ? '—' : formatStars(rating.before);
  const after = rating?.after == null ? '—' : formatStars(rating.after);

  return (
    <span className="inline-flex flex-col items-start gap-0.5 whitespace-nowrap tabular">
      <span className={`text-[11px] font-semibold ${starChangeTone(delta)}`}>
        <span className="sr-only">Star 变化：</span>
        {label}
      </span>
      {rating && (
        <span className="text-[9px] text-faint" aria-label={`赛前 ${before}，赛后 ${after}`}>
          {before} → {after}
        </span>
      )}
    </span>
  );
}
