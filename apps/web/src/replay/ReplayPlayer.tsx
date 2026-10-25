import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ReplayTimeline, type Replay } from '../../../../packages/contracts/src/replay';
import { ReplayBoard } from './ReplayBoard';
import { actionWindow, elapsed, frameForTurn, playerColors, statusNames } from './model';
import sourceLicense from './assets/LICENSE.generals-bots?url';
import fontLicense from './assets/OFL.txt?url';
import './replay.css';

/** Pure local player: no dashboard, socket, game engine or API dependency. Remount for a new replay. */
export function ReplayPlayer({ replay, active = true }: { replay: Replay; active?: boolean }) {
  const timeline = useMemo(() => new ReplayTimeline(replay), [replay]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [arrows, setArrows] = useState(true);
  const [history, setHistory] = useState(true);
  const [player, setPlayer] = useState<number | null>(null);
  const [targetTurn, setTargetTurn] = useState('');
  const last = replay.frames.length - 1;
  const { cells, frame } = useMemo(() => timeline.seek(index), [timeline, index]);
  const recent = useMemo(
    () => actionWindow(replay.actions, index, true, player),
    [replay, index, player],
  );
  const visible = useMemo(
    () => (arrows ? actionWindow(replay.actions, index, history, player) : []),
    [replay, index, history, player, arrows],
  );

  const clock = useRef<{ startedAt: number; replayAt: number } | null>(null);
  useEffect(() => {
    clock.current = null;
  }, [playing, active, speed]);

  useEffect(() => {
    if (!playing || !active || index >= last) return;
    const anchor = (clock.current ??= { startedAt: performance.now(), replayAt: frame.at });
    const due = anchor.startedAt + (replay.frames[index + 1]!.at - anchor.replayAt) / speed;
    const timer = window.setTimeout(
      () => {
        // Catch up after expensive paints or batched updates without accumulating clock drift.
        const at = anchor.replayAt + (performance.now() - anchor.startedAt) * speed;
        let next = index + 1;
        while (next < last && replay.frames[next + 1]!.at <= at) next++;
        setIndex(next);
        if (next === last) setPlaying(false);
      },
      Math.max(0, due - performance.now()),
    );
    return () => window.clearTimeout(timer);
  }, [playing, active, index, last, replay, frame.at, speed]);

  function seek(next: number) {
    setPlaying(false);
    setIndex(Math.max(0, Math.min(last, next)));
  }

  function togglePlay() {
    if (index === last) setIndex(0);
    setPlaying((current) => index === last || !current);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.matches('input, select, textarea') || target.isContentEditable) return;
    if (event.key === ' ' && target.closest('button, a')) return;
    if (event.key === ' ') togglePlay();
    else if (event.key === 'ArrowLeft') seek(index - (event.shiftKey ? 10 : 1));
    else if (event.key === 'ArrowRight') seek(index + (event.shiftKey ? 10 : 1));
    else if (event.key === 'Home') seek(0);
    else if (event.key === 'End') seek(last);
    else return;
    event.preventDefault();
  }

  const isPlaying = playing && active && index < last;
  return (
    <section className="replay-player" aria-label="录像播放器" onKeyDown={onKeyDown} tabIndex={0}>
      <header className="replay-heading">
        <div>
          <p className="meta-label">LOCAL REPLAY / {replay.server}</p>
          <h2 className="text-sm font-semibold text-ink">{replay.gameId}</h2>
        </div>
        <span className="replay-tag">
          己方视角 · {replay.width} × {replay.height} · {replay.frames.length} 帧
        </span>
      </header>
      {replay.truncated && (
        <p className="border-b border-warn/30 bg-warn/5 px-4 py-2 text-xs text-warn" role="status">
          录像不完整：录制达到本地存储上限，仅保留已记录的前缀；最后一帧不是终局。
        </p>
      )}
      <div className="replay-layout">
        <div className="min-w-0">
          <div className="replay-map-toolbar">
            <span>
              回合 <strong className="text-ink">{frame.turn}</strong>{' '}
              <span className="text-faint">/ {replay.frames[last]!.turn}</span>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                className="icon-btn size-7"
                type="button"
                aria-label="缩小地图"
                disabled={zoom <= 0.5}
                onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
              >
                <ZoomOut size={13} />
              </button>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setZoom(1)}>
                适应宽度
              </button>
              <button
                className="icon-btn size-7"
                type="button"
                aria-label="放大地图"
                disabled={zoom >= 3}
                onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
              >
                <ZoomIn size={13} />
              </button>
            </div>
          </div>
          <ReplayBoard replay={replay} cells={cells} frame={index} actions={visible} zoom={zoom} />
          <div className="replay-controls">
            <div className="flex items-center justify-between gap-3 text-[10px] text-muted tabular">
              <span>
                {elapsed(frame.at)} / {elapsed(replay.frames[last]!.at)}
              </span>
              <span>
                帧 {index + 1} / {replay.frames.length}
              </span>
            </div>
            <input
              className="replay-scrubber"
              type="range"
              aria-label="录像时间轴"
              min={0}
              max={last}
              value={index}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="跳到开局"
                  disabled={index === 0}
                  onClick={() => seek(0)}
                >
                  <SkipBack size={14} />
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="后退一帧"
                  disabled={index === 0}
                  onClick={() => seek(index - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  className="btn btn-primary min-w-20"
                  type="button"
                  aria-label={isPlaying ? '暂停录像' : index === last ? '重新播放' : '播放录像'}
                  onClick={togglePlay}
                >
                  {isPlaying ? <Pause size={14} /> : <Play size={14} />}{' '}
                  {isPlaying ? '暂停' : index === last ? '重播' : '播放'}
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="前进一帧"
                  disabled={index === last}
                  onClick={() => seek(index + 1)}
                >
                  <ChevronRight size={16} />
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="跳到末帧"
                  disabled={index === last}
                  onClick={() => seek(last)}
                >
                  <SkipForward size={14} />
                </button>
                <select
                  className="select replay-speed"
                  aria-label="播放速度"
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.target.value))}
                >
                  {[0.25, 0.5, 1, 2, 4, 8, 16].map((value) => (
                    <option key={value} value={value}>
                      {value}×
                    </option>
                  ))}
                </select>
              </div>
              <form
                className="flex items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (targetTurn.trim()) seek(frameForTurn(replay, Number(targetTurn)));
                }}
              >
                <input
                  className="input replay-turn-input"
                  aria-label="跳转回合"
                  placeholder="回合"
                  type="number"
                  min={replay.frames[0]!.turn}
                  max={replay.frames[last]!.turn}
                  value={targetTurn}
                  onChange={(event) => setTargetTurn(event.target.value)}
                  required
                />
                <button className="btn btn-secondary btn-sm" type="submit">
                  跳转
                </button>
              </form>
            </div>
          </div>
        </div>
        <aside className="replay-sidebar">
          <h3 className="meta-label">玩家统计 · 当前帧</h3>
          {replay.players.map((entry) => {
            const score = frame.scores.find((value) => value.index === entry.index);
            return (
              <div className="replay-score" key={entry.index}>
                <div className="flex items-center gap-2">
                  <span
                    className="replay-player-dot"
                    style={{ background: playerColors[entry.index % playerColors.length] }}
                  />
                  <strong className="min-w-0 truncate text-xs" title={entry.username}>
                    {entry.username}
                  </strong>
                  {entry.index === replay.perspective && (
                    <span className="text-[9px] text-teal">己方</span>
                  )}
                </div>
                <dl className="mt-2 flex gap-6 text-[10px] text-muted">
                  <div>
                    <dt>兵力</dt>
                    <dd className="text-sm font-semibold tabular text-ink">
                      {score?.army.toLocaleString() ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>领地</dt>
                    <dd className="text-sm font-semibold tabular text-ink">
                      {score?.land.toLocaleString() ?? '—'}
                    </dd>
                  </div>
                </dl>
              </div>
            );
          })}
          <div className="replay-options">
            <label>
              <input
                type="checkbox"
                checked={arrows}
                onChange={(event) => setArrows(event.target.checked)}
              />
              显示操作箭头
            </label>
            <label>
              <input
                type="checkbox"
                checked={history}
                disabled={!arrows}
                onChange={(event) => setHistory(event.target.checked)}
              />
              历史操作淡化 <span className="text-faint">12 帧</span>
            </label>
            <label className="!flex-col !items-start gap-1">
              操作玩家
              <select
                className="select !py-1.5 !text-[11px]"
                value={player ?? 'all'}
                onChange={(event) =>
                  setPlayer(event.target.value === 'all' ? null : Number(event.target.value))
                }
              >
                <option value="all">全部已记录玩家</option>
                {replay.players.map((entry) => (
                  <option key={entry.index} value={entry.index}>
                    {entry.username}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <h3 className="meta-label mt-3">近期操作 · 点击定位</h3>
          <div className="replay-actions">
            {recent.length ? (
              recent
                .slice(-8)
                .reverse()
                .map((action, position) => (
                  <button
                    key={`${action.frame}-${position}`}
                    type="button"
                    onClick={() => seek(action.frame)}
                    className="replay-action"
                    title={`(${Math.floor(action.from / replay.width)}, ${action.from % replay.width}) → (${Math.floor(action.to / replay.width)}, ${action.to % replay.width})`}
                  >
                    <span className="font-mono">T{action.turn}</span>
                    <span>{action.split ? '半兵' : '全兵'} →</span>
                    <span className={action.status === 'sent' ? 'text-teal' : 'text-faint'}>
                      {statusNames[action.status]}
                    </span>
                  </button>
                ))
            ) : (
              <p className="py-3 text-[11px] text-faint">当前没有已记录操作</p>
            )}
          </div>
          <p className="replay-explainer">
            黄色实线为已提交操作，虚线表示半兵或未提交决策。提交不等于服务器执行；敌方操作不可得，不推测补画。
          </p>
        </aside>
      </div>
      <footer className="replay-footer">
        点击棋盘后：空格 播放/暂停 · ← → 单步 · Shift + ← → 跳 10 帧 · Home / End
        首尾。迷雾保留当时视野，不包含完整终局。
        <span className="ml-2 whitespace-nowrap">
          素材许可：
          <a
            className="text-teal hover:underline"
            href={sourceLicense}
            download="LICENSE.generals-bots"
          >
            MIT
          </a>
          {' / '}
          <a className="text-teal hover:underline" href={fontLicense} download="OFL.txt">
            字体 OFL
          </a>
        </span>
      </footer>
    </section>
  );
}
