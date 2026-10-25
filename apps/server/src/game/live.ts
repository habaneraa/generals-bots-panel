import { setTimeout as delay } from 'node:timers/promises';
import { GameSocket, abortError } from './socket.js';
import { GameState } from './state.js';
import { fetchDuelStars } from './ratings.js';
import { isGameEnd } from './types.js';
import type { AgentAction, GameConnection, GameEnd, GameFrame, SubmitStatus } from './types.js';

const SERVERS = {
  generals: 'wss://ws.generals.io',
  bots: 'wss://botws.generals.io',
};
// Public client v31.4.3 queue argument, not an account credential.
const CLIENT_KEY = 'sd09fjdZ03i0ejwi_changeme';
const DIRECTIONS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

function identity(frame: GameFrame): string {
  const view = frame.observation;
  return JSON.stringify([frame.gameId, view.player_id, view.types.length, view.types[0]!.length]);
}

/** Direct game connection. Chrome, CDP and browser scheduling are not involved. */
export class SocketGame implements GameConnection {
  private readonly state = new GameState();
  private readonly socket: GameSocket;
  private readonly userId: string;
  private readonly listeners = new Set<() => void>();
  private connected = false;
  private closed = false;
  private waiting = false;
  private failure: Error | null = null;
  private botApi = false;
  private attackIndex = 0;
  private pendingIndex = 0;
  private gameIdentity: string | null = null;
  private gameId: string | null = null;
  private ratingsGameId: string | null = null;
  private ratingsAbort = new AbortController();

  constructor(
    private readonly server: 'generals' | 'bots',
    userId: string,
    endpoint?: string,
    private readonly log?: (message: string) => void,
  ) {
    this.userId = userId.trim();
    if (!this.userId) throw new Error('A game account ID is required');
    this.socket = new GameSocket(
      endpoint ?? `${SERVERS[server]}/socket.io/?EIO=4&transport=websocket`,
      {
        event: (event, args) => {
          if (event === 'error_set_username' && !args[0]) return;
          if (event === 'gio_error' || event.startsWith('error_')) {
            // Server error payloads may contain account information.
            throw new Error('Game server rejected the request');
          }
          if (event.startsWith('game_')) {
            this.state.update(event, args[0]);
            if (event === 'game_start') this.collectStars();
            this.notify();
          }
        },
        error: (error) => {
          this.failure ??= error;
          this.notify();
        },
      },
    );
  }

  async connect(signal: AbortSignal): Promise<void> {
    if (this.connected) throw new Error('Game connection already started');
    try {
      await this.socket.connect(signal);
      const reply = await this.socket.request('get_username', [this.userId], signal);
      const username = reply[0];
      if (typeof username !== 'string' || !username.trim()) {
        throw new Error('Choose a game username before starting the bot');
      }
      this.botApi = username.startsWith('[Bot]');
      this.connected = true;
      this.log?.(`Connected to ${this.server} game server`);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  async join(signal: AbortSignal): Promise<GameFrame | GameEnd> {
    this.assertOpen(signal);
    if (this.waiting) throw new Error('A game state wait is already active');
    this.state.reset();
    this.attackIndex = this.pendingIndex = 0;
    this.gameIdentity = this.gameId = null;
    this.socket.emit('leave_game');
    if (this.botApi) {
      this.socket.emit('join_1v1', this.userId);
    } else {
      this.socket.emit('join_1v1', this.userId, CLIENT_KEY, null, null, true);
    }
    const value = await this.waitFor(() => this.state.current(), 3_600_000, signal);
    this.gameId = value.gameId;
    if (!isGameEnd(value)) this.gameIdentity = identity(value);
    return this.finishRating(value, signal);
  }

  getResult(): GameEnd | null {
    const current = this.state.current();
    return current && isGameEnd(current) ? current : null;
  }

  getSnapshot() {
    return this.state.getSnapshot();
  }

  next(lastTurn: number, signal: AbortSignal): Promise<GameFrame | GameEnd> {
    this.assertOpen(signal);
    if (!this.gameId) return Promise.reject(new Error('Join a game before waiting for a turn'));
    if (!Number.isSafeInteger(lastTurn) || lastTurn < -1) {
      return Promise.reject(new Error('Invalid last game turn'));
    }
    return this.waitFor(
      () => {
        const value = this.state.current();
        if (!value) return null;
        if (
          value.gameId !== this.gameId ||
          (!isGameEnd(value) && this.gameIdentity !== identity(value))
        ) {
          throw new Error('The controlled game changed before its result was received');
        }
        if (isGameEnd(value)) return value;
        if (value.observation.turn < lastTurn) throw new Error('Game turn moved backwards');
        return value.observation.turn > lastTurn && value.attackIndex >= this.pendingIndex
          ? value
          : null;
      },
      40_000,
      signal,
    ).then((value) => this.finishRating(value, signal));
  }

  submit(frame: GameFrame, action: AgentAction): SubmitStatus {
    this.assertOpen();
    const current = this.state.current();
    if (
      !current ||
      isGameEnd(current) ||
      current.gameId !== frame.gameId ||
      identity(current) !== identity(frame) ||
      current.observation.turn !== frame.observation.turn
    ) {
      return 'stale';
    }
    if (current.attackIndex < this.pendingIndex) return 'rejected';
    if (typeof action.pass !== 'boolean') return 'rejected';
    if (action.pass) return 'pass';
    const { row, col, direction, split } = action;
    if (
      !Number.isSafeInteger(row) ||
      !Number.isSafeInteger(col) ||
      !Number.isInteger(direction) ||
      direction < 0 ||
      direction > 3 ||
      typeof split !== 'boolean'
    ) {
      return 'rejected';
    }
    const [dr, dc] = DIRECTIONS[direction]!;
    const view = current.observation;
    const height = view.types.length;
    const width = view.types[0]!.length;
    const targetRow = row + dr;
    const targetCol = col + dc;
    if (
      row < 0 ||
      row >= height ||
      col < 0 ||
      col >= width ||
      targetRow < 0 ||
      targetRow >= height ||
      targetCol < 0 ||
      targetCol >= width ||
      view.owners[row]![col] !== 1 ||
      view.armies[row]![col]! <= 1 ||
      [2, 6, 7].includes(view.types[targetRow]![targetCol]!)
    ) {
      return 'rejected';
    }
    const index = Math.max(this.attackIndex, current.attackIndex) + 1;
    if (!Number.isSafeInteger(index)) throw new Error('Game attack index exhausted');
    this.attackIndex = this.pendingIndex = index;
    // Sent is not executed: next() waits for the server's attackIndex to catch up.
    this.socket.emit('attack', row * width + col, targetRow * width + targetCol, split, index);
    return 'sent';
  }

  private async finishRating(
    value: GameFrame | GameEnd,
    signal: AbortSignal,
  ): Promise<GameFrame | GameEnd> {
    if (!isGameEnd(value) || this.server !== 'generals' || value.rating?.after !== null)
      return value;
    const username = value.rating?.username;
    if (!username?.trim()) return value;
    // Finish before requeueing. Public profiles may still lag the actual settlement.
    const samplingSignal = AbortSignal.any([signal, this.ratingsAbort.signal]);
    try {
      await delay(750, undefined, { signal: samplingSignal });
      const stars = await fetchDuelStars(username, samplingSignal);
      if (!samplingSignal.aborted && stars !== null) {
        this.state.setRatingAfter(value.gameId, stars, 'public-profile');
        return this.state.current() ?? value;
      }
    } catch {
      // Optional metadata must not turn a completed game into an interruption.
    }
    return value;
  }

  private collectStars(): void {
    if (this.server !== 'generals' || this.closed) return;
    const current = this.state.getSnapshot();
    if (!current || this.ratingsGameId === current.gameId) return;
    this.ratingsAbort.abort();
    const controller = (this.ratingsAbort = new AbortController());
    this.ratingsGameId = current.gameId;
    for (const player of current.snapshot.players) {
      if (player.stars !== null || !player.username?.trim()) continue;
      // Public usernames only; ratings never participate in game scheduling.
      void fetchDuelStars(player.username, controller.signal)
        .then((stars) => {
          if (controller.signal.aborted || this.closed || stars === null) return;
          if (this.state.setPlayerStars(current.gameId, player.index, stars)) this.notify();
        })
        .catch(() => undefined);
    }
  }

  private assertOpen(signal?: AbortSignal): void {
    if (signal?.aborted) throw abortError(signal);
    if (this.failure) throw this.failure;
    if (this.closed || !this.connected) throw new Error('Game connection is not open');
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private waitFor(
    select: () => GameFrame | GameEnd | null,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<GameFrame | GameEnd> {
    if (signal.aborted) return Promise.reject(abortError(signal));
    if (this.waiting) return Promise.reject(new Error('A game state wait is already active'));
    this.waiting = true;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        this.listeners.delete(check);
        this.waiting = false;
      };
      const abort = () => {
        if (settled) return;
        const error = abortError(signal);
        cleanup();
        reject(error);
        this.close();
      };
      const check = () => {
        if (settled) return;
        try {
          if (this.failure) throw this.failure;
          if (this.closed) throw new Error('Game connection closed');
          const value = select();
          if (value) {
            cleanup();
            resolve(value);
          }
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      const timeout = setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(new Error('Timed out waiting for game state'));
        this.close();
      }, timeoutMs);
      this.listeners.add(check);
      signal.addEventListener('abort', abort, { once: true });
      check();
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.ratingsAbort.abort();
    if (this.connected && !this.failure) {
      try {
        this.socket.emit('cancel');
        this.socket.emit('leave_game');
      } catch {
        // The socket may already have disconnected; cleanup must still complete.
      }
    }
    this.connected = false;
    this.socket.close();
    this.notify();
    this.listeners.clear();
  }
}
