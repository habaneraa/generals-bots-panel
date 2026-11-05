import { useEffect, useRef, useState } from 'react';
import { runConfigSchema } from '../../../../packages/contracts/src/index';
import type { RunConfig } from '../../../../packages/contracts/src/index';

type NumericKey = 'agentTimeoutMs' | 'cooldownMs' | 'maxGames';
export type RunDraft = Omit<RunConfig, NumericKey | 'args'> &
  Record<NumericKey, string> & { args: string };

const fieldLabels: Record<keyof RunConfig, string> = {
  mode: '运行模式',
  command: 'Agent 命令',
  args: '启动参数',
  cwd: '工作目录',
  protocol: '通信协议',
  agentTimeoutMs: 'Agent 超时',
  autopilot: '自动连续对局',
  cooldownMs: '对局间隔',
  maxGames: '最大对局数',
  dryRun: 'Dry-run',
  autoRestart: '失败自动重启',
};

function toDraft(config: RunConfig): RunDraft {
  return {
    ...config,
    args: config.args.join('\n'),
    agentTimeoutMs: String(config.agentTimeoutMs),
    cooldownMs: String(config.cooldownMs),
    maxGames: String(config.maxGames),
  };
}

function numeric(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

export function useRunConfig(config: RunConfig) {
  const [draft, setDraft] = useState(() => toDraft(config));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const focusFrame = useRef<number | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(config));

  useEffect(
    () => () => {
      // 校验后的焦点任务只属于当前表单，不能在卸载后滚动或聚焦新 Player 的工作区。
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
      focusFrame.current = null;
    },
    [],
  );

  function update<K extends keyof RunDraft>(key: K, value: RunDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function validate(): RunConfig | null {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = null;
    const result = runConfigSchema.safeParse({
      ...draft,
      args: draft.args.split(/\r?\n/).filter((line) => line.length > 0),
      agentTimeoutMs: numeric(draft.agentTimeoutMs),
      cooldownMs: numeric(draft.cooldownMs),
      maxGames: numeric(draft.maxGames),
    });
    if (result.success) {
      setErrors({});
      return result.data;
    }
    const next: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      const label = fieldLabels[key as keyof RunConfig] ?? '运行参数';
      next[key] ??=
        issue.code === 'custom' ? issue.message : `${label}格式不正确，请检查下方说明与取值范围。`;
    }
    setErrors(next);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null;
      const form = document.getElementById('run-config');
      const invalid = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
      invalid?.focus();
      if (!invalid) form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return null;
  }

  return { draft, errors, dirty, update, validate };
}
