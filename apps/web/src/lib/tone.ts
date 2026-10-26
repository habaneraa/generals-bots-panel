/** 结果与 Star 变化共用的高亮语义：淡绿有利、淡红不利、淡黄持平、灰色未知。 */
export type Tone = 'good' | 'bad' | 'tie' | 'unknown';

const pill =
  'inline-flex items-center whitespace-nowrap rounded-[2px] border px-1.5 py-0.5 text-[10px] font-medium leading-none';

export const tonePill: Record<Tone, string> = {
  good: `${pill} border-green-200 bg-green-50 text-green-700`,
  bad: `${pill} border-red-200 bg-red-50 text-red-600`,
  tie: `${pill} border-amber-200 bg-amber-100 text-amber-700`,
  unknown: `${pill} border-line bg-surface-subtle text-muted`,
};
