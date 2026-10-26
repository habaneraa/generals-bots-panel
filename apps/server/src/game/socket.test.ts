import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameSocket } from './socket.js';

class FakeWebSocket extends EventTarget {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  send(packet: string): void {
    this.sent.push(packet);
  }

  readonly close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
  });

  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

const endpoint = 'wss://example.test/socket.io/?EIO=4&transport=websocket';
const handshake = '0{"pingInterval":25000,"pingTimeout":20000}';
const signal = () => new AbortController().signal;

let socket: GameSocket;
let event: ReturnType<typeof vi.fn>;
let error: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  FakeWebSocket.instances = [];
  event = vi.fn();
  error = vi.fn();
  socket = new GameSocket(endpoint, { event, error });
});

afterEach(() => {
  socket.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function connected(): Promise<FakeWebSocket> {
  const connection = socket.connect(signal());
  const transport = FakeWebSocket.instances[0]!;
  transport.receive(handshake);
  transport.receive('40{"sid":"fixture"}');
  await connection;
  return transport;
}

describe('game socket transport', () => {
  it('completes both handshakes, emits packets and forwards game events', async () => {
    const connection = socket.connect(signal());
    const transport = FakeWebSocket.instances[0]!;
    expect(transport.url).toBe(endpoint);
    transport.receive(handshake);
    expect(transport.sent).toEqual(['40']);
    expect(() => socket.emit('join_1v1', 'player')).toThrow('not connected');
    transport.receive('40{"sid":"fixture"}');
    await expect(connection).resolves.toBeUndefined();
    socket.emit('join_1v1', 'player');
    expect(transport.sent.at(-1)).toBe('42["join_1v1","player"]');
    transport.receive('42["game_update",{"turn":2}]');
    expect(event).toHaveBeenCalledWith('game_update', [{ turn: 2 }]);
    expect(error).not.toHaveBeenCalled();
  });

  it('matches acknowledgments to concurrent requests and ignores unknown IDs', async () => {
    const transport = await connected();
    const first = socket.request('first', ['one'], signal());
    const second = socket.request('second', [], signal());
    expect(transport.sent.slice(1)).toEqual(['421["first","one"]', '422["second"]']);
    transport.receive('4399["unknown"]');
    transport.receive('432["two",2]');
    transport.receive('431["one"]');
    await expect(first).resolves.toEqual(['one']);
    await expect(second).resolves.toEqual(['two', 2]);
    expect(error).not.toHaveBeenCalled();
    socket.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('answers pings and resets the negotiated heartbeat deadline', async () => {
    const transport = await connected();
    vi.advanceTimersByTime(44_000);
    transport.receive('2');
    expect(transport.sent.at(-1)).toBe('3');
    vi.advanceTimersByTime(44_000);
    expect(error).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(error).toHaveBeenCalledWith(new Error('Game socket heartbeat timed out'));
    expect(transport.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects duplicate Engine.IO handshakes', async () => {
    const transport = await connected();
    transport.receive(handshake);
    expect(error).toHaveBeenCalledWith(new Error('Duplicate Engine.IO handshake'));
    expect(transport.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects pending requests on malformed acknowledgments and removes their timers', async () => {
    const transport = await connected();
    const replies = Promise.allSettled([
      socket.request('first', [], signal()),
      socket.request('second', [], signal()),
    ]);
    transport.receive('43invalid');
    const failure = new Error('Malformed game acknowledgment');
    expect(await replies).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(error).toHaveBeenCalledWith(failure);
    expect(transport.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    transport.receive('42["game_update",{"turn":2}]');
    transport.dispatchEvent(new Event('error'));
    transport.dispatchEvent(new Event('close'));
    socket.close();
    expect(event).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(transport.close).toHaveBeenCalledOnce();
    await expect(socket.request('later', [], signal())).rejects.toBe(error.mock.calls[0]![0]);
  });

  it('does not expose raw malformed JSON in connection errors', async () => {
    const connection = socket.connect(signal());
    const transport = FakeWebSocket.instances[0]!;
    transport.receive('0{"account":"private-account",');
    await expect(connection).rejects.toThrow('Malformed game socket JSON');
    expect(error).toHaveBeenCalledWith(new Error('Malformed game socket JSON'));
    expect(String(error.mock.calls[0]![0])).not.toContain('private-account');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out a connection that never completes its handshake', async () => {
    const connection = socket.connect(signal());
    const transport = FakeWebSocket.instances[0]!;
    vi.advanceTimersByTime(15_000);
    await expect(connection).rejects.toThrow('Game socket connection timed out');
    expect(transport.close).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out an unacknowledged request before the heartbeat deadline', async () => {
    const transport = await connected();
    const request = socket.request('get_username', ['player'], signal());
    vi.advanceTimersByTime(9_999);
    expect(error).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await expect(request).rejects.toThrow('Game socket acknowledgment timed out');
    expect(transport.close).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not open a transport for an already aborted connection', async () => {
    const abort = new AbortController();
    const reason = new Error('already cancelled');
    abort.abort(reason);
    await expect(socket.connect(abort.signal)).rejects.toBe(reason);
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a pending connection and removes the connection timer', async () => {
    const abort = new AbortController();
    const connection = socket.connect(abort.signal);
    const transport = FakeWebSocket.instances[0]!;
    const reason = new Error('cancel connection');
    abort.abort(reason);
    await expect(connection).rejects.toBe(reason);
    expect(error).toHaveBeenCalledWith(reason);
    expect(transport.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes abort listeners once connection and request promises have resolved', async () => {
    const connectAbort = new AbortController();
    const connection = socket.connect(connectAbort.signal);
    const transport = FakeWebSocket.instances[0]!;
    transport.receive(handshake);
    transport.receive('40');
    await connection;
    connectAbort.abort();
    const requestAbort = new AbortController();
    const request = socket.request('get_username', ['player'], requestAbort.signal);
    transport.receive('431["username"]');
    await expect(request).resolves.toEqual(['username']);
    requestAbort.abort();
    socket.emit('leave_game');
    expect(transport.sent.at(-1)).toBe('42["leave_game"]');
    expect(error).not.toHaveBeenCalled();
    expect(transport.close).not.toHaveBeenCalled();
    socket.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves the abort reason and cleans up an in-flight request', async () => {
    const transport = await connected();
    const abort = new AbortController();
    const request = socket.request('get_username', ['player'], abort.signal);
    const reason = new Error('cancelled by caller');
    abort.abort(reason);
    await expect(request).rejects.toBe(reason);
    expect(error).toHaveBeenCalledWith(reason);
    expect(transport.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
