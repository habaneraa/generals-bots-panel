import { Check, LockKeyhole, Save, Settings2 } from 'lucide-react';
import type { FormEvent } from 'react';
import type { RunConfig } from '../../../../packages/contracts/src/index';
import type { PendingAction } from '../hooks/useDashboard';
import { useRunConfig } from '../hooks/useRunConfig';
import { ConfigField, ToggleField } from './ConfigField';
import { Notice, Spinner } from './Shared';

type Props = {
  config: RunConfig;
  running: boolean;
  pending: PendingAction;
  onSave: (config: RunConfig) => Promise<boolean>;
  onStart: (config: RunConfig) => Promise<boolean>;
};

function SectionLabel({ index, children }: { index: string; children: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-teal">
        {index} · {children}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function ConfigPanel({ config, running, pending, onSave, onStart }: Props) {
  const { draft, errors, dirty, update, validate } = useRunConfig(config);
  const locked = running || pending !== null;
  const badge = running ? (
    <span className="inline-flex items-center gap-1 rounded-[2px] border border-line bg-canvas px-1.5 py-0.5 text-[9px] font-medium text-muted">
      <LockKeyhole size={10} aria-hidden="true" /> 运行中已锁定
    </span>
  ) : dirty ? (
    <span className="inline-flex items-center gap-1 rounded-[2px] border border-warn/25 bg-warn/[0.06] px-1.5 py-0.5 text-[9px] font-medium text-warn">
      <span className="size-1 rounded-full bg-warn" aria-hidden="true" /> 有未保存更改
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-[2px] border border-teal-line bg-teal-soft/60 px-1.5 py-0.5 text-[9px] font-medium text-teal-dark">
      <Check size={10} aria-hidden="true" /> 已同步配置
    </span>
  );
  const described = (id: string) => ({
    id,
    name: id,
    'aria-invalid': Boolean(errors[id]),
    'aria-describedby': `${id}-hint`,
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const intent = submitter instanceof HTMLButtonElement ? submitter.value : 'save';
    const valid = validate();
    if (!valid) return;
    if (intent === 'start') await onStart(valid);
    else await onSave(valid);
  }

  return (
    <section id="configuration" className="panel" aria-labelledby="config-heading">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="config-heading" className="panel-heading">
              <Settings2 size={14} /> 运行参数
            </h2>
            {badge}
          </div>
          <p className="panel-caption">连接你的 Agent，定义本轮运行方式。</p>
        </div>
      </header>

      <form id="run-config" onSubmit={(event) => void onSubmit(event)} noValidate>
        <fieldset className="min-w-0" disabled={locked}>
          <legend className="sr-only">运行配置</legend>
          <div className="px-4 py-4">
            <SectionLabel index="01">Agent 启动</SectionLabel>
            <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2">
              <ConfigField
                id="command"
                label="Agent 命令（必填）"
                hint="填写实际启动命令，例如 bash、python3 或可执行文件路径。"
                error={errors.command}
                wide
              >
                <input
                  {...described('command')}
                  className="input font-mono text-[12px]"
                  value={draft.command}
                  onChange={(event) => update('command', event.target.value)}
                  placeholder="例如 bash"
                  required
                  autoComplete="off"
                  spellCheck={false}
                />
              </ConfigField>
              <ConfigField
                id="args"
                label="启动参数"
                hint="每行一个参数，不按空格拆分；最多 100 项，每项最多 4096 字符。"
                error={errors.args}
                wide
              >
                <textarea
                  {...described('args')}
                  className="textarea"
                  value={draft.args}
                  onChange={(event) => update('args', event.target.value)}
                  placeholder={'例如：\n/path/to/agent.py\n--strategy=balanced'}
                  rows={3}
                  spellCheck={false}
                />
              </ConfigField>
              <ConfigField
                id="cwd"
                label="Agent 工作目录"
                hint="留空使用运行器默认目录。"
                error={errors.cwd}
              >
                <input
                  {...described('cwd')}
                  className="input font-mono text-[12px]"
                  value={draft.cwd}
                  onChange={(event) => update('cwd', event.target.value)}
                  placeholder="/path/to/agent"
                  autoComplete="off"
                  spellCheck={false}
                />
              </ConfigField>
            </div>

            <div className="mt-5">
              <SectionLabel index="02">对局与调度</SectionLabel>
            </div>
            <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2">
              <ConfigField
                id="protocol"
                label="通信协议"
                hint="与 Agent 的输入输出协议保持一致。"
                error={errors.protocol}
              >
                <select
                  {...described('protocol')}
                  className="select"
                  value={draft.protocol}
                  onChange={(event) =>
                    update('protocol', event.target.value === 'stdio' ? 'stdio' : 'jsonl')
                  }
                >
                  <option value="jsonl">JSONL</option>
                  <option value="stdio">STDIO</option>
                </select>
              </ConfigField>
              <ConfigField
                id="agentTimeoutMs"
                label="Agent 超时 / ms"
                hint="100–300,000 毫秒"
                error={errors.agentTimeoutMs}
              >
                <input
                  {...described('agentTimeoutMs')}
                  className="input tabular"
                  type="number"
                  min={100}
                  max={300000}
                  step={1}
                  value={draft.agentTimeoutMs}
                  onChange={(event) => update('agentTimeoutMs', event.target.value)}
                />
              </ConfigField>
              <ConfigField
                id="cooldownMs"
                label="对局间隔 / ms"
                hint="0–300,000 毫秒"
                error={errors.cooldownMs}
              >
                <input
                  {...described('cooldownMs')}
                  className="input tabular"
                  type="number"
                  min={0}
                  max={300000}
                  step={1}
                  value={draft.cooldownMs}
                  onChange={(event) => update('cooldownMs', event.target.value)}
                />
              </ConfigField>
              <ConfigField
                id="maxGames"
                label="最大对局数"
                hint="1–10,000 场"
                error={errors.maxGames}
              >
                <input
                  {...described('maxGames')}
                  className="input tabular"
                  type="number"
                  min={1}
                  max={10000}
                  step={1}
                  value={draft.maxGames}
                  onChange={(event) => update('maxGames', event.target.value)}
                />
              </ConfigField>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <ToggleField
                id="autopilot"
                label="自动连续对局"
                hint="开启后按间隔继续，直到达到最大对局数；关闭后仅运行单局。"
                checked={draft.autopilot}
                onChange={(value) => update('autopilot', value)}
              />
              <ToggleField
                id="dryRun"
                label="Dry-run"
                hint="只观察和推理，不发送移动；仍会加入真实对局队列。"
                checked={draft.dryRun}
                onChange={(value) => update('dryRun', value)}
              />
              <ToggleField
                id="autoRestart"
                label="失败自动重启"
                hint="运行失败后在 failed 停留满 60 秒，自动按原配置从头重启；手动停止不会重启。"
                checked={draft.autoRestart}
                onChange={(value) => update('autoRestart', value)}
              />
            </div>
          </div>
        </fieldset>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-subtle px-4 py-2.5">
          <span className="text-[10px] leading-snug text-faint">
            {running ? '停止运行后可修改参数' : '启动会保存并使用当前表单参数'}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            type="submit"
            name="intent"
            value="save"
            disabled={locked}
          >
            {pending === 'save' ? <Spinner /> : <Save size={12} />}
            {pending === 'save' ? '正在保存' : '保存参数'}
          </button>
        </footer>
      </form>

      {Object.keys(errors).length > 0 && (
        <div className="px-4 pb-3">
          <Notice>参数校验未通过，请检查标红的字段后重试。</Notice>
        </div>
      )}
    </section>
  );
}
