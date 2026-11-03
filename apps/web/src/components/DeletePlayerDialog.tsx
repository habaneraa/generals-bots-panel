import { Eye, EyeOff, RefreshCw, Trash2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { Player, PlayerDetails } from '../../../../packages/contracts/src/index';
import { api, errorMessage, isAbortError } from '../api/client';
import { isRunning, phaseLabels } from '../lib/format';
import { Notice, Spinner } from './Shared';

type Props = {
  target: Player;
  fallbackFocus: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onDelete: (id: string, signal: AbortSignal) => Promise<boolean>;
};

export function DeletePlayerDialog({ target, fallbackFocus, onClose, onDelete }: Props) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mutation = useRef<AbortController | null>(null);
  const [details, setDetails] = useState<PlayerDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showId, setShowId] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallback = fallbackFocus.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      mutation.current?.abort();
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
      else fallback?.focus();
    };
  }, [fallbackFocus]);

  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    setLoadError(null);
    setDetails(null);
    void api
      .playerDetails(target.id, request.signal)
      .then((value) => {
        if (request.signal.aborted) return;
        if (value.player.id !== target.id)
          throw new Error('返回的 Player 与删除目标不一致，请重试。');
        setDetails(value);
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted && !isAbortError(error)) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, [target.id, attempt]);

  async function remove() {
    if (!details || details.player.id !== target.id || running || mutation.current) return;
    const request = new AbortController();
    mutation.current = request;
    setPending(true);
    setDeleteError(null);
    try {
      if (await onDelete(target.id, request.signal)) {
        if (!request.signal.aborted) onClose();
      } else if (!request.signal.aborted) {
        setDeleteError('删除未完成，请等待当前操作结束后重试。');
      }
    } catch (error) {
      if (!request.signal.aborted && !isAbortError(error)) setDeleteError(errorMessage(error));
    } finally {
      if (!request.signal.aborted && mutation.current === request) {
        mutation.current = null;
        setPending(false);
      }
    }
  }

  const identity = details?.player ?? target;
  const running = details ? details.active || isRunning(details.phase) : false;
  const counts = details
    ? ([
        ['运行记录', details.runs],
        ['对局记录', details.matches],
        ['统计总局数', details.stats.total],
        ['胜利', details.stats.won],
        ['失败', details.stats.lost],
        ['平局', details.stats.draw],
        ['中断', details.stats.interrupted],
        ['胜率', `${Number((details.stats.winRate * 100).toFixed(1))}%`],
        ['日志文件', details.logs],
        ['录像文件', details.replays],
      ] as const)
    : [];

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-warning`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88dvh] flex-col max-sm:max-h-dvh">
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 id={`${id}-title`} className="text-sm font-semibold text-ink">
            删除 Player
          </h2>
          <button
            className="icon-btn size-7"
            type="button"
            aria-label="关闭删除确认"
            data-autofocus
            onClick={onClose}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 space-y-4 overflow-y-auto p-4">
          <p
            id={`${id}-warning`}
            className="rounded-[3px] border border-danger/40 bg-danger/10 p-3 text-xs font-semibold leading-relaxed text-danger"
          >
            仅从列表中移除此
            Player，本地配置、历史、日志和录像仍保留在磁盘原位置，不影响服务器账号。
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
            <dt className="text-muted">服务器昵称</dt>
            <dd className="break-all font-semibold text-ink">{identity.nickname}</dd>
            <dt className="text-muted">所属服务器</dt>
            <dd className="text-ink">{identity.server}</dd>
            <dt className="text-muted">userId</dt>
            <dd className="min-w-0 space-y-1">
              <button
                className="inline-flex items-center gap-1 text-teal"
                type="button"
                aria-pressed={showId}
                onClick={() => setShowId(!showId)}
              >
                {showId ? (
                  <EyeOff size={12} aria-hidden="true" />
                ) : (
                  <Eye size={12} aria-hidden="true" />
                )}
                {showId ? '隐藏 userId' : '显示 userId'}
              </button>
              {showId && (
                <span className="block break-all font-mono text-ink">{identity.userId}</span>
              )}
            </dd>
            {details && (
              <>
                <dt className="text-muted">运行状态</dt>
                <dd className={running ? 'font-semibold text-danger' : 'text-ink'}>
                  {phaseLabels[details.phase]}（{details.phase}）
                </dd>
                <dt className="text-muted">后台运行任务</dt>
                <dd className="text-ink">{details.active ? '运行中' : '未运行'}</dd>
                <dt className="text-muted">本地数据路径</dt>
                <dd className="break-all font-mono text-ink">{details.dataDir}</dd>
                {counts.map(([label, value]) => (
                  <div className="contents" key={label}>
                    <dt className="text-muted">{label}</dt>
                    <dd className="text-ink">{value}</dd>
                  </div>
                ))}
                <dt className="text-muted">最近运行时间</dt>
                <dd className="text-ink">
                  {details.lastRunAt ? (
                    <time dateTime={details.lastRunAt}>
                      {new Date(details.lastRunAt).toLocaleString('zh-CN', { hour12: false })}
                    </time>
                  ) : (
                    '从未运行'
                  )}
                </dd>
              </>
            )}
          </dl>
          {loading && (
            <p role="status" className="flex items-center gap-2 text-xs text-muted">
              <Spinner />
              正在读取 Player 详情…
            </p>
          )}
          {loadError && (
            <Notice
              action={
                <button
                  className="btn btn-danger btn-sm"
                  type="button"
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  <RefreshCw size={12} aria-hidden="true" />
                  重试详情
                </button>
              }
            >
              {loadError}
            </Notice>
          )}
          {running && (
            <Notice>此 Player 正在运行，请先切换到该 Player 并停止运行，停止完成后再删除。</Notice>
          )}
          {details && !pending && (
            <button
              className="inline-flex items-center gap-1 text-[10px] text-teal"
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              <RefreshCw size={11} aria-hidden="true" />
              刷新运行状态与详情
            </button>
          )}
          {deleteError && <Notice>{deleteError} 请先确认该 Player 已停止运行，再重试。</Notice>}
          {pending && (
            <p role="status" className="flex items-center gap-2 text-xs text-muted">
              <Spinner />
              正在从列表移除，请勿重复提交…
            </p>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button className="btn btn-secondary btn-sm" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-danger btn-sm"
            type="button"
            disabled={loading || !details || running || pending}
            onClick={() => void remove()}
          >
            {pending ? <Spinner /> : <Trash2 size={12} aria-hidden="true" />}从列表移除
          </button>
        </footer>
      </div>
    </dialog>
  );
}
