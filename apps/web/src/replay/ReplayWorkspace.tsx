import { Clapperboard, Download, FolderOpen, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { parseReplay, type Replay } from '../../../../packages/contracts/src/replay';
import { api, errorMessage, isAbortError } from '../api/client';
import { Notice, Spinner } from '../components/Shared';
import { readReplayFile, replayAddress, replaySource } from './model';
import { ReplayPlayer } from './ReplayPlayer';

export function ReplayWorkspace({ active = true }: { active?: boolean }) {
  const [server, setServer] = useState<'generals' | 'bots'>('generals');
  const [gameId, setGameId] = useState('');
  const [replay, setReplay] = useState<Replay | null>(null);
  const [revision, setRevision] = useState(0);
  const [source, setSource] = useState<'server' | 'file'>('file');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load(serverName: 'generals' | 'bots', id: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const value = parseReplay(await api.replay(serverName, id, controller.signal));
      if (request !== generation.current) return;
      setReplay(value);
      setRevision(request);
      setSource('server');
    } catch (cause) {
      if (request === generation.current && !isAbortError(cause)) setError(errorMessage(cause));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }

  function cancelPending() {
    generation.current++;
    abortRef.current?.abort();
  }

  useEffect(() => {
    const openHash = () => {
      const value = replaySource(window.location.hash);
      if (!value) return;
      setServer(value.server);
      setGameId(value.gameId);
      void load(value.server, value.gameId);
    };
    openHash();
    window.addEventListener('hashchange', openHash);
    return () => {
      window.removeEventListener('hashchange', openHash);
      cancelPending();
    };
  }, []);

  async function importFile(file: File) {
    abortRef.current?.abort();
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const value = await readReplayFile(file);
      if (request !== generation.current) return;
      setReplay(value);
      setRevision(request);
      setSource('file');
      setServer(value.server);
      setGameId(value.gameId);
    } catch (cause) {
      if (request === generation.current) setError(`无法读取录像：${errorMessage(cause)}`);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }

  const openPanel = (
    <section className="panel">
      <form
        className="replay-open"
        onSubmit={(event) => {
          event.preventDefault();
          void load(server, gameId.trim());
        }}
      >
        <label className="field-label">
          服务器
          <select
            className="select !w-28"
            value={server}
            onChange={(event) => setServer(event.target.value as 'generals' | 'bots')}
          >
            <option value="generals">公共服</option>
            <option value="bots">Bot 服</option>
          </select>
        </label>
        <label className="field-label min-w-36 flex-1">
          游戏 ID
          <input
            className="input"
            placeholder="输入本机已保存的游戏 ID"
            value={gameId}
            onChange={(event) => setGameId(event.target.value)}
            maxLength={256}
            required
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={loading || !gameId.trim()}>
          <FolderOpen size={14} />
          读取录像
        </button>
        <span className="self-center text-[10px] text-faint">或</span>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => fileRef.current?.click()}
          title="导入 replay.json.gz / JSON，仅在浏览器内解析，不上传；未录制的旧对局无法补回棋盘。"
          disabled={loading}
        >
          <Upload size={14} />
          导入文件
        </button>
        <input
          className="sr-only"
          type="file"
          accept=".gz,.json,application/gzip,application/json"
          ref={fileRef}
          aria-label="选择录像文件"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
            event.target.value = '';
          }}
        />
      </form>
    </section>
  );
  const notices = (
    <>
      {error && <Notice>{error}</Notice>}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted" role="status">
          <Spinner />
          正在读取并校验录像…
        </div>
      )}
    </>
  );

  if (replay) {
    return (
      <ReplayPlayer
        key={revision}
        replay={replay}
        active={active && !loading}
        sidebarContent={
          <>
            <div className="replay-source">
              <span>
                {source === 'file' ? '本地文件' : '本机录像库'} ·{' '}
                {new Date(replay.startedAt).toLocaleString('zh-CN')}
              </span>
              <span>
                {replay.outcome === 'interrupted'
                  ? '中断录像'
                  : replay.outcome === null
                    ? '未标记结束'
                    : '已结束'}{' '}
                · 原始视野记录
              </span>
              {source === 'server' && (
                <a
                  className="inline-flex items-center gap-1 text-teal hover:underline"
                  href={`${replayAddress(replay.server, replay.gameId)}/download`}
                  download
                >
                  <Download size={12} />
                  下载录像
                </a>
              )}
            </div>
            <details className="replay-load">
              <summary>读取 / 导入其他录像</summary>
              {openPanel}
            </details>
            {notices}
          </>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {openPanel}
      {notices}
      {!loading && (
        <section className="panel replay-empty">
          <div>
            <Clapperboard size={30} className="mx-auto mb-3 text-teal" />
            <h2 className="text-sm font-semibold text-ink">选择录像开始回放</h2>
          </div>
        </section>
      )}
    </div>
  );
}
