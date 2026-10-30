import { ArrowUpRight, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { MatchRecord } from '../../../../packages/contracts/src/index';
import { localReplayHref, replayHref } from '../lib/format';
import { usePlayerId } from '../hooks/PlayerScope';
import { MatchDetails } from './MatchDetails';
import { OutcomeBadge } from './OutcomeBadge';

export function MatchDetailsModal({
  match,
  onClose,
}: {
  match: MatchRecord | null;
  onClose: () => void;
}) {
  const playerId = usePlayerId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const matchId = match?.id;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!matchId || !dialog) return;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();

    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [matchId]);

  if (!match) return null;
  const localReplay = localReplayHref(match, playerId);
  const replay = replayHref(match.replayUrl);

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby="match-details-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-full max-h-[88vh] flex-col max-sm:max-h-dvh">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 id="match-details-title" className="text-sm font-semibold text-ink">
              对局详情
            </h2>
            <OutcomeBadge outcome={match.outcome} />
            <span
              className="mono max-w-[260px] truncate text-faint"
              title={match.gameId || match.id}
            >
              {match.gameId || '等待分配'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {localReplay && (
              <a
                className="btn btn-primary btn-sm"
                href={localReplay}
                target="_blank"
                rel="noopener noreferrer"
              >
                站内录像 <ArrowUpRight size={11} aria-hidden="true" />
              </a>
            )}
            {replay && (
              <a
                className="btn btn-secondary btn-sm"
                href={replay}
                target="_blank"
                rel="noopener noreferrer"
              >
                官网回放 <ArrowUpRight size={11} aria-hidden="true" />
              </a>
            )}
            <button
              className="icon-btn size-7"
              type="button"
              aria-label="关闭对局详情"
              data-autofocus
              onClick={onClose}
            >
              <X size={14} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <MatchDetails match={match} />
        </div>
      </div>
    </dialog>
  );
}
