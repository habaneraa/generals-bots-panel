import {
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  X,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ReplayTimeline, type Replay } from '../../../../packages/contracts/src/replay';
import { ReplayBoard } from './ReplayBoard';
import {
  actionWindow,
  elapsed,
  frameForTurn,
  HISTORY_STEPS,
  playerColors,
  statusNames,
} from './model';
import sourceLicense from './assets/LICENSE.generals-bots?url';
import fontLicense from './assets/OFL.txt?url';
import './replay.css';

/** Pure local player: no dashboard, socket, game engine or API dependency. Remount for a new replay. */
export function ReplayPlayer({
  replay,
  active = true,
  sidebarContent,
}: {
  replay: Replay;
  active?: boolean;
  sidebarContent?: ReactNode;
}) {
  const timeline = useMemo(() => new ReplayTimeline(replay), [replay]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [arrows, setArrows] = useState(true);
  const [history, setHistory] = useState(true);
  const [hidePlayerIds, setHidePlayerIds] = useState(false);
  const [player, setPlayer] = useState<number | null>(null);
  const [targetTurn, setTargetTurn] = useState('');
  const playerRef = useRef<HTMLElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
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

  useEffect(() => {
    const element = playerRef.current;
    if (!active || !element) return;
    const resize = () => {
      const top = Math.max(0, element.getBoundingClientRect().top);
      element.style.setProperty('--replay-top', `${top}px`);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [active]);

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
    if (
      target.closest('dialog') ||
      target.matches('input, select, textarea') ||
      target.isContentEditable
    )
      return;
    if (event.key === ' ' && target.closest('button, a, summary')) return;
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
    <section
      ref={playerRef}
      className="replay-player"
      aria-label="录像播放器"
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      <div className="replay-layout">
        <div className="replay-main">
          <div className="replay-stage">
            <ReplayBoard
              replay={replay}
              cells={cells}
              frame={index}
              actions={visible}
              zoom={zoom}
            />
            <div className="replay-scoreboard">
              <button
                className="replay-scoreboard-toggle"
                type="button"
                aria-label={hidePlayerIds ? '显示玩家 ID' : '隐藏玩家 ID'}
                aria-pressed={hidePlayerIds}
                title={hidePlayerIds ? '点击显示玩家 ID' : '点击隐藏玩家 ID'}
                onClick={() => setHidePlayerIds((value) => !value)}
              />
              <table aria-label="玩家统计 · 当前帧">
                <thead>
                  <tr>
                    <th scope="col">玩家</th>
                    <th scope="col">兵力</th>
                    <th scope="col">领地</th>
                  </tr>
                </thead>
                <tbody>
                  {replay.players.map((entry) => {
                    const score = frame.scores.find((value) => value.index === entry.index);
                    return (
                      <tr key={entry.index}>
                        <th scope="row">
                          <div className="replay-score-player">
                            <span
                              className="replay-player-dot"
                              style={{
                                background: playerColors[entry.index % playerColors.length],
                              }}
                            />
                            {!hidePlayerIds && (
                              <span className="truncate" title={entry.username}>
                                {entry.username}
                              </span>
                            )}
                            {entry.index === replay.perspective && (
                              <span className="replay-self">己方</span>
                            )}
                          </div>
                        </th>
                        <td>{score?.army.toLocaleString() ?? '—'}</td>
                        <td>{score?.land.toLocaleString() ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="replay-controls">
            <div className="replay-transport">
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
                className="btn btn-primary btn-sm replay-play"
                type="button"
                aria-label={isPlaying ? '暂停录像' : index === last ? '重新播放' : '播放录像'}
                onClick={togglePlay}
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                <span>{isPlaying ? '暂停' : index === last ? '重播' : '播放'}</span>
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
            <span className="replay-time tabular">
              {elapsed(frame.at)} / {elapsed(replay.frames[last]!.at)}
            </span>
            <input
              className="replay-scrubber"
              type="range"
              aria-label="录像时间轴"
              aria-valuetext={`${elapsed(frame.at)} / ${elapsed(replay.frames[last]!.at)}`}
              title={`${elapsed(frame.at)} / ${elapsed(replay.frames[last]!.at)}`}
              min={0}
              max={last}
              value={index}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <span className="replay-frame tabular">
              帧 {index + 1} / {replay.frames.length}
            </span>
          </div>
        </div>
        <aside className="replay-sidebar" aria-label="对局信息与回放设置">
          <header className="replay-heading">
            <div className="flex w-full items-center justify-between gap-2">
              <p className="meta-label">LOCAL REPLAY / {replay.server}</p>
              <button
                className="icon-btn size-7"
                type="button"
                aria-label="播放帮助"
                title="播放帮助"
                onClick={() => helpRef.current?.showModal()}
              >
                <CircleHelp size={14} />
              </button>
            </div>
            <h2 className="text-sm font-semibold text-ink">{replay.gameId}</h2>
            <span className="replay-tag">
              己方视角 · {replay.width} × {replay.height} · {replay.frames.length} 帧
            </span>
          </header>
          {sidebarContent}
          {replay.truncated && (
            <p className="my-3 text-xs text-warn" role="status">
              录像不完整：录制达到本地存储上限，仅保留已记录的前缀；最后一帧不是终局。
            </p>
          )}
          <div className="replay-map-toolbar">
            <span>
              回合 <strong className="text-ink">{frame.turn}</strong>{' '}
              <span className="text-faint">/ {replay.frames[last]!.turn}</span>
            </span>
            <div className="flex items-center gap-1">
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
                适应窗口
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
          <form
            className="replay-turn-jump"
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
              历史操作淡化 <span className="text-faint">{HISTORY_STEPS} 步</span>
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
                .slice(-HISTORY_STEPS)
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
        </aside>
      </div>
      <dialog
        ref={helpRef}
        className="replay-help"
        aria-label="录像播放帮助"
        onClick={(event) => {
          if (event.target === event.currentTarget) helpRef.current?.close();
        }}
      >
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">录像播放帮助</h2>
          <button
            className="icon-btn size-7"
            type="button"
            aria-label="关闭播放帮助"
            onClick={() => helpRef.current?.close()}
          >
            <X size={14} />
          </button>
        </header>
        <div className="replay-help-content">
          <section>
            <h3>快捷键</h3>
            <p className="mb-2">点击棋盘后使用，输入框内不触发。</p>
            <dl className="replay-shortcuts">
              <dt>空格</dt>
              <dd>播放 / 暂停</dd>
              <dt>← / →</dt>
              <dd>后退 / 前进一帧</dd>
              <dt>Shift + ← / →</dt>
              <dd>跳转 10 帧</dd>
              <dt>Home / End</dt>
              <dd>跳到开局 / 末帧</dd>
            </dl>
          </section>
          <section>
            <h3>操作箭头</h3>
            <p>
              黄色实线为已提交操作，虚线表示半兵或未提交决策。轨迹仅保留最近 {HISTORY_STEPS}
              步操作，历史操作逐步淡化。提交不等于服务器执行；敌方操作不可得，不推测补画。
            </p>
          </section>
          <section>
            <h3>录像与视野</h3>
            <p>
              迷雾保留当时视野，不包含完整终局。支持导入 replay.json.gz /
              JSON，文件只在浏览器内解析，不上传；旧对局未录制时无法补回棋盘。
            </p>
          </section>
          <p>
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
          </p>
        </div>
      </dialog>
    </section>
  );
}
