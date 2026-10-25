import { Filter, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { matchFiltersSchema } from '../../../../packages/contracts/src/index';
import type { MatchFilters } from '../../../../packages/contracts/src/index';
import { ConfigField } from './ConfigField';
import { Notice } from './Shared';

type FilterDraft = Record<keyof MatchFilters, string>;
const emptyDraft: FilterDraft = {
  server: '',
  outcome: '',
  opponent: '',
  gameId: '',
  startedAfter: '',
  startedBefore: '',
  minTurns: '',
  maxTurns: '',
};

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function HistoryFilters({ onApply }: { onApply: (filters: MatchFilters) => void }) {
  const [draft, setDraft] = useState(emptyDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);

  function update(key: keyof FilterDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors({});
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = matchFiltersSchema.safeParse({
      server: draft.server || undefined,
      outcome: draft.outcome || undefined,
      opponent: draft.opponent.trim() || undefined,
      gameId: draft.gameId.trim() || undefined,
      startedAfter: toIso(draft.startedAfter),
      startedBefore: toIso(draft.startedBefore),
      minTurns: draft.minTurns === '' ? undefined : draft.minTurns,
      maxTurns: draft.maxTurns === '' ? undefined : draft.maxTurns,
    });
    if (!result.success) {
      const next: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        next[key] ??= issue.code === 'custom' ? issue.message : '格式或范围不正确，请检查此字段。';
      }
      setErrors(next);
      return;
    }
    setErrors({});
    onApply(result.data);
  }

  function reset() {
    setDraft(emptyDraft);
    setErrors({});
    onApply({});
  }

  const input = (key: keyof FilterDraft) => ({
    id: `history-${key}`,
    name: key,
    value: draft[key],
    onChange: (event: { target: { value: string } }) => update(key, event.target.value),
    'aria-invalid': Boolean(errors[key]),
    'aria-describedby': `history-${key}-hint`,
  });

  return (
    <form
      className="border-b border-line bg-surface-subtle px-4 py-3"
      onSubmit={submit}
      noValidate
      aria-label="对局历史筛选"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted">
          筛选条件
        </span>
        <div className="flex items-center gap-2">
          <span className="hidden text-[10px] text-faint sm:inline">
            按全部真实记录筛选，时间使用本地时区
          </span>
          <button
            className="btn btn-secondary btn-sm lg:hidden"
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="history-filter-fields"
            onClick={() => setFiltersOpen((current) => !current)}
          >
            <SlidersHorizontal size={11} />
            {filtersOpen ? '收起' : '展开'}筛选
          </button>
        </div>
      </div>

      <div
        id="history-filter-fields"
        className={filtersOpen ? 'mt-3 block' : 'mt-3 hidden lg:block'}
      >
        <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <ConfigField id="history-server" label="服务器" error={errors.server}>
            <select {...input('server')} className="select">
              <option value="">全部服务器</option>
              <option value="generals">generals</option>
              <option value="bots">bots</option>
            </select>
          </ConfigField>
          <ConfigField id="history-outcome" label="结果" error={errors.outcome}>
            <select {...input('outcome')} className="select">
              <option value="">全部结果</option>
              <option value="won">胜利</option>
              <option value="lost">失败</option>
              <option value="draw">平局</option>
              <option value="interrupted">中断</option>
              <option value="playing">进行中</option>
            </select>
          </ConfigField>
          <ConfigField id="history-opponent" label="对手" error={errors.opponent}>
            <input
              {...input('opponent')}
              className="input"
              maxLength={200}
              placeholder="对手名称"
            />
          </ConfigField>
          <ConfigField id="history-gameId" label="对局 ID" error={errors.gameId}>
            <input
              {...input('gameId')}
              className="input font-mono text-[12px]"
              maxLength={256}
              placeholder="对局 ID"
              spellCheck={false}
            />
          </ConfigField>
          <ConfigField
            id="history-startedAfter"
            label="开始时间"
            hint="对局开始不早于此本地时间"
            error={errors.startedAfter}
          >
            <input {...input('startedAfter')} className="input" type="datetime-local" step={1} />
          </ConfigField>
          <ConfigField
            id="history-startedBefore"
            label="结束时间"
            hint="对局开始不晚于此本地时间"
            error={errors.startedBefore}
          >
            <input {...input('startedBefore')} className="input" type="datetime-local" step={1} />
          </ConfigField>
          <ConfigField
            id="history-minTurns"
            label="最小回合"
            hint="0–10,000,000"
            error={errors.minTurns}
          >
            <input
              {...input('minTurns')}
              className="input tabular"
              type="number"
              min={0}
              max={10000000}
              step={1}
            />
          </ConfigField>
          <ConfigField
            id="history-maxTurns"
            label="最大回合"
            hint="0–10,000,000"
            error={errors.maxTurns}
          >
            <input
              {...input('maxTurns')}
              className="input tabular"
              type="number"
              min={0}
              max={10000000}
              step={1}
            />
          </ConfigField>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5">
          <button className="btn btn-ghost btn-sm" type="button" onClick={reset}>
            <RotateCcw size={11} /> 重置
          </button>
          <button className="btn btn-primary btn-sm" type="submit">
            <Filter size={11} /> 筛选
          </button>
        </div>

        {Object.keys(errors).length > 0 && (
          <div className="mt-2.5">
            <Notice>筛选条件有误，请检查标红字段后重试。</Notice>
          </div>
        )}
      </div>
    </form>
  );
}
