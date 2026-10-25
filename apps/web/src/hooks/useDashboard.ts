import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dashboard, RunConfig } from '../../../../packages/contracts/src/index';
import { api, errorMessage, isAbortError } from '../api/client';

export type Connection = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export type PendingAction = 'save' | 'start' | 'stop' | null;

export function useDashboard() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [attempt, setAttempt] = useState(0);
  const actionLock = useRef(false);
  const mounted = useRef(true);
  const eventGeneration = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let receivedEvent = false;
    setConnection('connecting');
    setLoadError(null);

    void api.dashboard(controller.signal).then(
      (data) => {
        if (!disposed && !receivedEvent) setDashboard(data);
      },
      (error: unknown) => {
        if (!disposed && !receivedEvent && !isAbortError(error)) setLoadError(errorMessage(error));
      },
    );

    const source = new EventSource('/api/events', { withCredentials: true });
    const onOpen = () => {
      if (!disposed) setConnection('connected');
    };
    const onDashboard = (event: MessageEvent<string>) => {
      if (disposed) return;
      try {
        const data = JSON.parse(event.data) as Dashboard;
        receivedEvent = true;
        eventGeneration.current++;
        setDashboard(data);
        setLoadError(null);
        setConnection('connected');
      } catch {
        setLoadError('收到的实时数据无法解析，请重新连接。');
      }
    };
    const onError = () => {
      if (!disposed) {
        setConnection(source.readyState === EventSource.CLOSED ? 'disconnected' : 'reconnecting');
      }
    };
    source.addEventListener('open', onOpen);
    source.addEventListener('dashboard', onDashboard);
    source.addEventListener('error', onError);

    return () => {
      disposed = true;
      controller.abort();
      source.removeEventListener('open', onOpen);
      source.removeEventListener('dashboard', onDashboard);
      source.removeEventListener('error', onError);
      source.close();
    };
  }, [attempt]);

  const mutate = useCallback(async (action: Exclude<PendingAction, null>, config?: RunConfig) => {
    if (actionLock.current) return false;
    actionLock.current = true;
    setPending(action);
    setActionError(null);
    const generation = eventGeneration.current;
    try {
      if (action === 'stop') {
        const data = await api.stop();
        if (mounted.current && eventGeneration.current === generation) setDashboard(data);
      } else {
        if (!config) throw new Error('缺少运行参数。');
        if (action === 'save') {
          const saved = await api.save(config);
          if (mounted.current && eventGeneration.current === generation)
            setDashboard((current) => current && { ...current, config: saved });
        } else {
          const data = await api.start(config);
          if (mounted.current && eventGeneration.current === generation) setDashboard(data);
        }
      }
      return true;
    } catch (error) {
      if (mounted.current) setActionError(errorMessage(error));
      return false;
    } finally {
      actionLock.current = false;
      if (mounted.current) setPending(null);
    }
  }, []);

  return {
    dashboard,
    connection,
    loadError,
    actionError,
    pending,
    retry: () => setAttempt((current) => current + 1),
    save: (config: RunConfig) => mutate('save', config),
    start: (config: RunConfig) => mutate('start', config),
    stop: () => mutate('stop'),
  };
}
