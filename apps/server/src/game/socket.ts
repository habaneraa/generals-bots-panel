export function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
}

interface Pending<T> {
  resolve(value: T): void;
  reject(error: Error): void;
}

interface SocketCallbacks {
  event(event: string, args: unknown[]): void;
  error(error: Error): void;
}

/** Engine.IO 4 / Socket.IO default namespace over Node's native WebSocket. */
export class GameSocket {
  private socket: WebSocket | null = null;
  private connected = false;
  private engineOpened = false;
  private failure: Error | null = null;
  private heartbeat: ReturnType<typeof setTimeout> | null = null;
  private heartbeatMs = 60_000;
  private connection: Pending<void> | null = null;
  private requests = new Map<number, Pending<unknown[]>>();
  private sequence = 0;

  constructor(
    private readonly endpoint: string,
    private readonly callbacks: SocketCallbacks,
  ) {}

  connect(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError(signal));
    if (this.failure) return Promise.reject(this.failure);
    if (this.socket) return Promise.reject(new Error('Game socket already started'));
    const connection = this.waitForPending<void>(
      signal,
      15_000,
      'Game socket connection timed out',
      (pending) => {
        this.connection = pending;
        return () => {
          this.connection = null;
        };
      },
    );
    try {
      this.socket = new WebSocket(this.endpoint);
      this.socket.addEventListener('message', this.onMessage);
      this.socket.addEventListener('error', this.onError);
      this.socket.addEventListener('close', this.onClose);
    } catch {
      this.fail(new Error('Unable to create game WebSocket'));
    }
    return connection;
  }

  emit(event: string, ...args: unknown[]): void {
    this.send('42' + JSON.stringify([event, ...args]));
  }

  request(event: string, args: unknown[], signal: AbortSignal): Promise<unknown[]> {
    if (signal.aborted) return Promise.reject(abortError(signal));
    if (this.failure) return Promise.reject(this.failure);
    if (!this.connected) return Promise.reject(new Error('Game socket is not connected'));
    const id = ++this.sequence;
    const request = this.waitForPending<unknown[]>(
      signal,
      10_000,
      'Game socket acknowledgment timed out',
      (pending) => {
        this.requests.set(id, pending);
        return () => {
          this.requests.delete(id);
        };
      },
    );
    try {
      this.send('42' + id + JSON.stringify([event, ...args]));
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error('Unable to send game request'));
    }
    return request;
  }

  private waitForPending<T>(
    signal: AbortSignal,
    timeoutMs: number,
    timeoutMessage: string,
    register: (pending: Pending<T>) => () => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const abort = () => this.fail(abortError(signal));
      const timeout = setTimeout(() => this.fail(new Error(timeoutMessage)), timeoutMs);
      let cleanupPending = () => {};
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        cleanupPending();
      };
      cleanupPending = register({
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  private send(packet: string): void {
    if (this.failure) throw this.failure;
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error('Game socket is not connected');
    }
    this.socket.send(packet);
  }

  private readonly onMessage = ({ data }: MessageEvent): void => {
    try {
      if (typeof data !== 'string') throw new Error('Binary game packets are unsupported');
      if (data.startsWith('0')) {
        if (this.engineOpened) throw new Error('Duplicate Engine.IO handshake');
        const open: unknown = JSON.parse(data.slice(1));
        if (typeof open !== 'object' || open === null || Array.isArray(open)) {
          throw new Error('Malformed Engine.IO handshake');
        }
        const { pingInterval, pingTimeout } = open as Record<string, unknown>;
        if (
          typeof pingInterval !== 'number' ||
          typeof pingTimeout !== 'number' ||
          !Number.isSafeInteger(pingInterval) ||
          !Number.isSafeInteger(pingTimeout) ||
          pingInterval <= 0 ||
          pingTimeout <= 0 ||
          pingInterval + pingTimeout > 2_147_483_647
        ) {
          throw new Error('Malformed game heartbeat settings');
        }
        this.engineOpened = true;
        this.heartbeatMs = pingInterval + pingTimeout;
        this.armHeartbeat();
        this.socket!.send('40');
      } else if (data === '2') {
        if (!this.engineOpened) throw new Error('Game ping before handshake');
        this.socket!.send('3');
        this.armHeartbeat();
      } else if (data.startsWith('40')) {
        if (!this.engineOpened) throw new Error('Socket.IO connection before handshake');
        if (data.length > 2) {
          const connection: unknown = JSON.parse(data.slice(2));
          if (typeof connection !== 'object' || connection === null || Array.isArray(connection)) {
            throw new Error('Malformed Socket.IO connection');
          }
        }
        this.connected = true;
        this.connection?.resolve();
      } else if (data.startsWith('42')) {
        if (!this.connected) throw new Error('Game event before connection');
        const packet: unknown = JSON.parse(data.slice(2));
        if (!Array.isArray(packet) || typeof packet[0] !== 'string' || !packet[0]) {
          throw new Error('Malformed game event');
        }
        this.callbacks.event(packet[0], packet.slice(1));
      } else if (data.startsWith('43')) {
        if (!this.connected) throw new Error('Game acknowledgment before connection');
        const match = /^43(\d+)(\[.*\])$/s.exec(data);
        if (!match) throw new Error('Malformed game acknowledgment');
        const id = Number(match[1]);
        const reply: unknown = JSON.parse(match[2]!);
        if (!Number.isSafeInteger(id) || id < 1 || !Array.isArray(reply)) {
          throw new Error('Malformed game acknowledgment');
        }
        this.requests.get(id)?.resolve(reply);
      } else if (data.startsWith('44')) {
        throw new Error('Socket.IO connection rejected');
      } else if (data === '1' || data.startsWith('41')) {
        throw new Error('Game server disconnected');
      } else {
        throw new Error('Unsupported game socket packet');
      }
    } catch (error) {
      // Never include raw packet contents (which may contain an account ID).
      this.fail(
        error instanceof SyntaxError
          ? new Error('Malformed game socket JSON')
          : error instanceof Error
            ? error
            : new Error('Malformed game socket packet'),
      );
    }
  };

  private readonly onError = (): void => {
    this.fail(new Error('Game WebSocket connection failed'));
  };

  private readonly onClose = (): void => {
    this.fail(new Error('Game WebSocket disconnected'));
  };

  private armHeartbeat(): void {
    if (this.heartbeat) clearTimeout(this.heartbeat);
    this.heartbeat = setTimeout(
      () => this.fail(new Error('Game socket heartbeat timed out')),
      this.heartbeatMs,
    );
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.connected = false;
    if (this.heartbeat) clearTimeout(this.heartbeat);
    this.heartbeat = null;
    this.connection?.reject(error);
    for (const request of [...this.requests.values()]) request.reject(error);
    this.requests.clear();
    if (this.socket) {
      this.socket.removeEventListener('message', this.onMessage);
      this.socket.removeEventListener('error', this.onError);
      this.socket.removeEventListener('close', this.onClose);
      if (this.socket.readyState !== WebSocket.CLOSED) this.socket.close();
    }
    this.callbacks.error(error);
  }

  close(): void {
    this.fail(new Error('Game socket closed'));
  }
}
