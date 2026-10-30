import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Dashboard,
  Player,
  PlayerInput,
  RunConfig,
} from '../../../../packages/contracts/src/index';
import { api, ApiRequestError, errorMessage, isAbortError, playerPath } from '../api/client';

export type Connection = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export type PendingAction = 'save' | 'start' | 'stop' | null;

export function useDashboard() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [playerAction, setPlayerAction] = useState<'add' | 'select' | null>(null);
  const selectedId = useRef<string | undefined>(undefined);
  const confirmedId = useRef<string | undefined>(undefined);
  const existenceProbe = useRef<{
    request: AbortController;
    result: Promise<boolean | null>;
  } | null>(null);
  const scopeGeneration = useRef(0);
  const eventGeneration = useRef(0);
  const deletedIds = useRef(new Set<string>());
  const actionLock = useRef<symbol | null>(null);
  const playerLock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const playerController = useRef<AbortController | null>(null);
  const deletion = useRef<AbortController | null>(null);
  const stream = useRef<EventSource | null>(null);

  const cancelAddPlayer = useCallback(() => {
    if (!playerController.current) return;
    playerController.current.abort();
    playerController.current = null;
    playerLock.current = false;
    setPlayerAction(null);
    setActionError(null);
  }, []);

  const cancelProbe = useCallback(() => {
    existenceProbe.current?.request.abort();
    existenceProbe.current = null;
  }, []);

  const probeScope = useCallback((id: string) => {
    if (existenceProbe.current) return existenceProbe.current.result;
    const request = new AbortController();
    const result = api
      .dashboard(request.signal, id)
      .then(
        () => true,
        (error: unknown) =>
          error instanceof ApiRequestError && error.status === 404 ? false : null,
      )
      .then((exists) => (request.signal.aborted ? null : exists))
      .finally(() => {
        if (existenceProbe.current?.request === request) existenceProbe.current = null;
      });
    existenceProbe.current = { request, result };
    return result;
  }, []);

  const dispose = useCallback(() => {
    scopeGeneration.current++;
    cancelProbe();
    controller.current?.abort();
    actionController.current?.abort();
    playerController.current?.abort();
    playerController.current = null;
    deletion.current?.abort();
    deletion.current = null;
    stream.current?.close();
    stream.current = null;
    actionLock.current = null;
    playerLock.current = false;
  }, [cancelProbe]);

  const loadScope = useCallback(
    async function loadScope(
      playerId?: string,
      loader?: (signal: AbortSignal) => Promise<Dashboard>,
      updateUrl = false,
    ): Promise<boolean> {
      dispose();
      const generation = scopeGeneration.current;
      const request = new AbortController();
      controller.current = request;
      selectedId.current = playerId;
      setDashboard(null);
      setPlayer((current) => (current?.id === playerId ? current : null));
      setPending(null);
      setPlayerAction(loader ? 'select' : null);
      playerLock.current = Boolean(loader);
      setActionError(null);
      setLoadError(null);
      setConnection('connecting');
      const current = () => generation === scopeGeneration.current && !request.signal.aborted;
      const accept = (data: Dashboard) => {
        const next = {
          ...data,
          players: data.players.filter((item) => !deletedIds.current.has(item.id)),
        };
        setDashboard(next);
        setPlayer(next.player);
        setPlayers(next.players);
      };
      try {
        // 引导 GET 先确定默认 Player，之后的 SSE 永远固定在该 Player，不跟随服务端 active。
        const data = await (loader
          ? loader(request.signal)
          : api.dashboard(request.signal, playerId));
        if (!current()) return false;
        if (playerId !== undefined && data.player?.id !== playerId)
          throw new Error('返回的 Player 与当前选择不一致。');
        selectedId.current = data.player?.id;
        confirmedId.current = data.player?.id;
        if (updateUrl) {
          const url = new URL(window.location.href);
          if (url.searchParams.has('playerId')) {
            if (data.player) url.searchParams.set('playerId', data.player.id);
            else url.searchParams.delete('playerId');
            window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
          }
        }
        accept(data);
        if (!data.player) {
          setConnection('connected');
          return true;
        }
        const id = data.player.id;
        const source = new EventSource(playerPath('/api/events', id), { withCredentials: true });
        stream.current = source;
        source.addEventListener('open', () => {
          if (!current()) return;
          cancelProbe();
          setConnection('connected');
        });
        source.addEventListener('dashboard', (event) => {
          if (!current()) return;
          try {
            const next = JSON.parse((event as MessageEvent<string>).data) as Dashboard;
            if (next.player?.id !== id) return;
            cancelProbe();
            eventGeneration.current++;
            accept(next);
            setLoadError(null);
            setConnection('connected');
          } catch {
            setLoadError('收到的实时数据无法解析，请重新连接。');
          }
        });
        source.addEventListener('player-deleted', (event) => {
          if (!current()) return;
          try {
            const next = JSON.parse((event as MessageEvent<string>).data) as { playerId: string };
            if (next.playerId !== id) return;
            // 当前 scope 已失效；先关闭旧流、取消所有旧动作，再读取剩余的默认工作区。
            void loadScope(undefined, undefined, true);
          } catch {
            setLoadError('收到的实时数据无法解析，请重新连接。');
          }
        });
        source.addEventListener('error', () => {
          if (!current()) return;
          setConnection(source.readyState === EventSource.CLOSED ? 'disconnected' : 'reconnecting');
          // 断线时可能错过删除事件。仅探测存在性，不用 GET 快照覆盖当前页面草稿。
          void probeScope(id).then((exists) => {
            if (current() && exists === false) void loadScope(undefined, undefined, true);
          });
        });
        return true;
      } catch (error) {
        if (current() && !isAbortError(error)) {
          if (
            error instanceof ApiRequestError &&
            error.status === 404 &&
            playerId !== undefined &&
            confirmedId.current === playerId
          )
            return loadScope(undefined, undefined, true);
          setLoadError(errorMessage(error));
          setConnection('disconnected');
        }
        return false;
      } finally {
        if (current()) {
          playerLock.current = false;
          setPlayerAction(null);
        }
      }
    },
    [dispose, cancelProbe, probeScope],
  );

  useEffect(() => {
    const initialPlayerId =
      new URLSearchParams(window.location.search).get('playerId') ?? undefined;
    void loadScope(initialPlayerId);
    return dispose;
  }, [loadScope, dispose]);

  const mutate = useCallback(async (action: Exclude<PendingAction, null>, config?: RunConfig) => {
    const id = selectedId.current;
    if (!id || !stream.current || actionLock.current || playerLock.current || deletion.current)
      return false;
    const lock = Symbol(action);
    actionLock.current = lock;
    const generation = scopeGeneration.current;
    const events = eventGeneration.current;
    const request = new AbortController();
    actionController.current = request;
    const current = () => generation === scopeGeneration.current && !request.signal.aborted;
    setPending(action);
    setActionError(null);
    try {
      if (action === 'stop') {
        const data = await api.stop(id, request.signal);
        if (current() && eventGeneration.current === events) setDashboard(data);
      } else {
        if (!config) throw new Error('缺少运行参数。');
        if (action === 'save') {
          const saved = await api.save(config, id, request.signal);
          if (current() && eventGeneration.current === events)
            setDashboard((value) => value && { ...value, config: saved });
        } else {
          const data = await api.start(config, id, request.signal);
          if (current() && eventGeneration.current === events) setDashboard(data);
        }
      }
      return current();
    } catch (error) {
      if (current() && !isAbortError(error)) setActionError(errorMessage(error));
      return false;
    } finally {
      // 旧 Player 的 finally 不能解锁新 Player 正在执行的动作。
      if (actionLock.current === lock) {
        actionLock.current = null;
        setPending(null);
      }
    }
  }, []);

  const selectPlayer = useCallback(
    async (playerId: string) => {
      if (playerLock.current) return false;
      if (playerId === selectedId.current && dashboard) return true;
      return loadScope(playerId, (signal) => api.selectPlayer(playerId, signal), true);
    },
    [dashboard, loadScope],
  );

  const addPlayer = useCallback(
    async (input: PlayerInput) => {
      if (playerLock.current || deletion.current) return false;
      playerLock.current = true;
      setPlayerAction('add');
      setActionError(null);
      const generation = scopeGeneration.current;
      const request = new AbortController();
      playerController.current = request;
      try {
        const data = await api.addPlayer(input, request.signal);
        if (generation !== scopeGeneration.current || request.signal.aborted) return false;
        return await loadScope(data.player?.id, async () => data, true);
      } catch (error) {
        if (
          generation === scopeGeneration.current &&
          !request.signal.aborted &&
          !isAbortError(error)
        )
          setActionError(errorMessage(error));
        return false;
      } finally {
        if (playerController.current === request) {
          playerController.current = null;
          playerLock.current = false;
          setPlayerAction(null);
        }
      }
    },
    [loadScope],
  );

  const deletePlayer = useCallback(
    async (id: string, signal: AbortSignal) => {
      const workspaceId = selectedId.current;
      if (
        !workspaceId ||
        deletion.current ||
        playerLock.current ||
        actionLock.current ||
        signal.aborted
      )
        return false;
      const generation = scopeGeneration.current;
      const events = eventGeneration.current;
      const request = new AbortController();
      const abort = () => {
        request.abort();
        if (deletion.current === request) deletion.current = null;
      };
      signal.addEventListener('abort', abort, { once: true });
      deletion.current = request;
      const current = () => generation === scopeGeneration.current && !request.signal.aborted;
      try {
        const data = await api.deletePlayer(id, workspaceId, request.signal);
        if (!current()) return false;
        deletedIds.current.add(id);
        if (id === workspaceId) return await loadScope(data.player?.id, async () => data, true);
        // 删除其他 Player 仅更新列表；不替换当前配置、运行快照或任何页面草稿。
        const nextPlayers = data.players.filter((item) => !deletedIds.current.has(item.id));
        const newerEvents = eventGeneration.current !== events;
        setPlayers((value) => (newerEvents ? value.filter((item) => item.id !== id) : nextPlayers));
        setDashboard(
          (value) =>
            value && {
              ...value,
              players: newerEvents ? value.players.filter((item) => item.id !== id) : nextPlayers,
            },
        );
        eventGeneration.current++;
        return true;
      } catch (error) {
        if (!current() || isAbortError(error)) return false;
        throw error;
      } finally {
        signal.removeEventListener('abort', abort);
        if (deletion.current === request) deletion.current = null;
      }
    },
    [loadScope],
  );

  return {
    dashboard,
    player,
    players,
    connection,
    loadError,
    actionError,
    pending,
    playerPending: playerAction !== null,
    playerAction,
    retry: () => {
      void loadScope(selectedId.current);
    },
    selectPlayer,
    addPlayer,
    cancelAddPlayer,
    deletePlayer,
    save: (config: RunConfig) => mutate('save', config),
    start: (config: RunConfig) => mutate('start', config),
    stop: () => mutate('stop'),
  };
}
