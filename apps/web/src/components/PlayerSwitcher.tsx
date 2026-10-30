import { Check, ChevronUp, Eye, EyeOff, Plus, Trash2, Users, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  playerInputSchema,
  type Player,
  type PlayerInput,
} from '../../../../packages/contracts/src/index';
import { DeletePlayerDialog } from './DeletePlayerDialog';
import { Notice, Spinner } from './Shared';

type Props = {
  player: Player | null;
  players: Player[];
  open: boolean;
  pending: boolean;
  pendingAction: 'add' | 'select' | null;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => Promise<boolean>;
  onAdd: (input: PlayerInput) => Promise<boolean>;
  onCancelAdd: () => void;
  onDelete: (id: string, signal: AbortSignal) => Promise<boolean>;
};

export function PlayerSwitcher({
  player,
  players,
  open,
  pending,
  pendingAction,
  error,
  onOpenChange,
  onSelect,
  onAdd,
  onCancelAdd,
  onDelete,
}: Props) {
  const id = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const interaction = useRef(0);
  const wasOpen = useRef(false);
  const submitLock = useRef<symbol | null>(null);
  const [showIds, setShowIds] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<PlayerInput>({ server: 'generals', userId: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<{
    target: Player;
    workspaceId: string | undefined;
  } | null>(null);
  const deleteTarget =
    open &&
    deleting?.workspaceId === player?.id &&
    players.some((item) => item.id === deleting?.target.id)
      ? deleting?.target
      : null;

  const close = useCallback(() => {
    interaction.current++;
    submitLock.current = null;
    onCancelAdd();
    setDeleting(null);
    onOpenChange(false);
    trigger.current?.focus();
  }, [onCancelAdd, onOpenChange]);

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      interaction.current++;
      submitLock.current = null;
      onCancelAdd();
      setShowIds(false);
      setDeleting(null);
      return;
    }
    const newlyOpened = !wasOpen.current;
    wasOpen.current = true;
    if (newlyOpened) setShowIds(false);
    if (deleteTarget) return;
    if (newlyOpened)
      wrapper.current?.querySelector<HTMLElement>('[data-player-autofocus]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close, onCancelAdd, deleteTarget]);

  useEffect(() => {
    setDeleting(null);
  }, [player?.id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || submitLock.current) return;
    const result = playerInputSchema.safeParse(draft);
    if (!result.success) {
      const next: Record<string, string> = {};
      for (const issue of result.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    const lock = Symbol('add');
    submitLock.current = lock;
    const generation = interaction.current;
    try {
      if ((await onAdd(result.data)) && generation === interaction.current) {
        setDraft({ server: 'generals', userId: '' });
        setAdding(false);
        close();
      }
    } finally {
      if (submitLock.current === lock) submitLock.current = null;
    }
  }

  const field = (name: keyof PlayerInput) => ({
    id: `${id}-${name}`,
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': errors[name] ? `${id}-${name}-error` : undefined,
    disabled: pending,
  });

  return (
    <div ref={wrapper} className="relative border-t border-line p-3 lg:mt-auto">
      <button
        ref={trigger}
        className="flex w-full items-center gap-2.5 rounded-[3px] border border-line bg-canvas px-3 py-2 text-left transition-colors hover:border-teal-line"
        type="button"
        aria-label="切换 Player"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-players`}
        onClick={() => (open ? close() : onOpenChange(true))}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-[3px] bg-teal-soft text-teal">
          <Users size={16} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-ink">
            {player?.nickname ?? '添加你的 Player'}
          </span>
          <span className="block text-[9px] text-muted">
            {player ? `${player.server} 服务器` : '独立账号与运行工作区'}
          </span>
        </span>
        <ChevronUp size={13} className="text-faint" aria-hidden="true" />
      </button>

      {open && (
        <section
          id={`${id}-players`}
          role="dialog"
          aria-labelledby={`${id}-heading`}
          aria-busy={pending}
          className="absolute inset-x-3 top-full z-50 mt-1 max-h-[75dvh] overflow-y-auto rounded-[4px] border border-line bg-surface p-3 shadow-xl lg:inset-x-auto lg:bottom-3 lg:left-[calc(100%-4px)] lg:top-auto lg:mt-0 lg:w-[340px]"
        >
          <header className="mb-3 flex items-center justify-between gap-2">
            <h2 id={`${id}-heading`} className="panel-heading">
              <Users size={14} aria-hidden="true" />
              Player 管理
            </h2>
            <button
              className="icon-btn size-7"
              type="button"
              aria-label="关闭 Player 管理"
              data-player-autofocus
              onClick={close}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </header>
          <p className="mb-3 text-[10px] leading-snug text-muted">
            每个 Player 独立保存配置、历史与日志。昵称由服务器读取并缓存，不能编辑。切换不会停止其他
            Player 的运行。
          </p>
          {players.length > 0 ? (
            <>
              <div className="mb-2 flex items-center justify-between text-[10px] text-muted">
                <span>{players.length} 个 Player</span>
                <button
                  className="inline-flex items-center gap-1 text-teal"
                  type="button"
                  aria-pressed={showIds}
                  onClick={() => setShowIds(!showIds)}
                >
                  {showIds ? (
                    <EyeOff size={12} aria-hidden="true" />
                  ) : (
                    <Eye size={12} aria-hidden="true" />
                  )}
                  {showIds ? '隐藏 userId' : '显示 userId'}
                </button>
              </div>
              <ul className="space-y-1">
                {players.map((item) => (
                  <li
                    key={item.id}
                    className={`flex items-center gap-1 rounded-[3px] border ${item.id === player?.id ? 'border-teal-line bg-teal-soft/60' : 'border-line hover:bg-canvas'}`}
                  >
                    <button
                      className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left"
                      type="button"
                      disabled={pending}
                      aria-label={`切换到 ${item.nickname}（${item.server}）`}
                      aria-pressed={item.id === player?.id}
                      onClick={async () => {
                        const generation = interaction.current;
                        if ((await onSelect(item.id)) && generation === interaction.current)
                          close();
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-ink">
                          {item.nickname}
                        </span>
                        <span className="block text-[10px] text-muted">{item.server} 服务器</span>
                        {showIds && (
                          <span className="mt-1 block break-all font-mono text-[10px] text-faint">
                            {item.userId}
                          </span>
                        )}
                      </span>
                      {item.id === player?.id && (
                        <Check size={14} className="shrink-0 text-teal" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      className="icon-btn mr-1.5 size-7 shrink-0 text-danger"
                      type="button"
                      disabled={pending}
                      aria-label={`删除 ${item.nickname}（${item.server}）`}
                      onClick={() => setDeleting({ target: item, workspaceId: player?.id })}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="rounded-[3px] border border-dashed border-line bg-canvas p-3 text-xs text-muted">
              还没有 Player，添加账号后即可开始。
            </p>
          )}

          {!adding && players.length > 0 ? (
            <button
              className="btn btn-secondary btn-sm mt-3 w-full"
              type="button"
              disabled={pending}
              onClick={() => setAdding(true)}
            >
              <Plus size={12} aria-hidden="true" />
              新增 Player
            </button>
          ) : (
            <form
              className="mt-3 space-y-3 border-t border-line pt-3"
              onSubmit={(event) => void submit(event)}
              noValidate
            >
              <h3 className="text-xs font-semibold text-ink">新增 Player</h3>
              <p className="text-[10px] text-muted">
                只需填写服务器和 userId，昵称将向服务器读取并持久缓存。
              </p>
              <label className="field-label" htmlFor={`${id}-server`}>
                所属服务器
                <select
                  {...field('server')}
                  className="select"
                  value={draft.server}
                  onChange={(event) =>
                    setDraft({ ...draft, server: event.target.value as PlayerInput['server'] })
                  }
                >
                  <option value="generals">generals</option>
                  <option value="bots">bots</option>
                </select>
              </label>
              <label className="field-label" htmlFor={`${id}-userId`}>
                userId
                <input
                  {...field('userId')}
                  className="input font-mono"
                  type={showIds ? 'text' : 'password'}
                  value={draft.userId}
                  maxLength={4096}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setDraft({ ...draft, userId: event.target.value })}
                  placeholder="直接填写账号 userId，不是文件路径"
                  required
                />
              </label>
              <label className="flex items-center gap-1.5 text-[10px] text-muted">
                <input
                  type="checkbox"
                  className="accent-teal"
                  checked={showIds}
                  onChange={(event) => setShowIds(event.target.checked)}
                />
                显示 userId
              </label>
              {errors.userId && (
                <p id={`${id}-userId-error`} className="text-[10px] text-danger">
                  请填写 userId（最多 4096 字符）
                </p>
              )}
              <div className="flex justify-end gap-2">
                {(players.length > 0 || pendingAction === 'add') && (
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={() => {
                      interaction.current++;
                      submitLock.current = null;
                      onCancelAdd();
                      setAdding(false);
                    }}
                  >
                    取消
                  </button>
                )}
                <button className="btn btn-primary btn-sm" type="submit" disabled={pending}>
                  {pending ? <Spinner /> : <Plus size={12} aria-hidden="true" />}添加并切换
                </button>
              </div>
            </form>
          )}
          {error && (
            <div className="mt-3">
              <Notice>{error}</Notice>
            </div>
          )}
          {pending && (
            <p role="status" className="mt-2 text-[10px] text-muted">
              {pendingAction === 'add'
                ? '正在向服务器读取昵称，请稍候；可以取消。'
                : '正在切换 Player…'}
            </p>
          )}
        </section>
      )}
      {deleteTarget && (
        <DeletePlayerDialog
          key={deleteTarget.id}
          target={deleteTarget}
          fallbackFocus={trigger}
          onClose={() => setDeleting(null)}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}
