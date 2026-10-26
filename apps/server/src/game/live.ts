import { setTimeout as delay } from 'node:timers/promises';
import { GameSocket, abortError } from './socket.js';
import { GameState } from './state.js';
import { fetchDuelStars } from './ratings.js';
import { ReplayRecorder } from './recorder.js';
import { frameIdentity, isGameEnd } from './types.js';
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

/** Direct game connection. Chrome, CDP and browser scheduling are not involved. */
export class SocketGame implements GameConnection {
  private readonly state = new GameState();
  private recorder: ReplayRecorder;
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
  private surrenderRequested = false;
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
    this.recorder = new ReplayRecorder(server, this.log);
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
            if (event === 'game_start' || event === 'game_update') {
              const frame = this.state.current();
              if (frame && !isGameEnd(frame)) {
                try {
                  this.recorder.capture(frame);
                } catch {
                  this.recorder.truncate('本地录像采集失败，已保留有效前缀');
                }
                const view = frame.observation;
                if (
                  !this.closed &&
                  !this.surrenderRequested &&
                  (view.my_army * 100 < view.opp_army || view.my_land * 100 < view.opp_land)
                ) {
                  this.surrenderRequested = true;
                  this.socket.emit('surrender');
                  this.log?.(
                    `自动投降：兵力 ${view.my_army}/${view.opp_army}，领地 ${view.my_land}/${view.opp_land}，低于敌方的 1%`,
                  );
                }
              }
            }
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
    this.recorder = new ReplayRecorder(this.server, this.log);
    this.attackIndex = this.pendingIndex = 0;
    this.surrenderRequested = false;
    this.gameIdentity = this.gameId = null;
    this.socket.emit('leave_game');
    if (this.botApi) {
      this.socket.emit('join_1v1', this.userId);
    } else {
      this.socket.emit('join_1v1', this.userId, CLIENT_KEY, null, null, true);
    }
    const value = await this.waitFor(() => this.state.current(), 3_600_000, signal);
    this.gameId = value.gameId;
    if (!isGameEnd(value)) this.gameIdentity = frameIdentity(value);
    return this.finishRating(value, signal);
  }

  getReplay() {
    return this.recorder.getReplay();
  }

  recordAction(frame: GameFrame, action: AgentAction, status: SubmitStatus): void {
    this.recorder.recordAction(frame, action, status);
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
          (!isGameEnd(value) && this.gameIdentity !== frameIdentity(value))
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
      frameIdentity(current) !== frameIdentity(frame) ||
      current.observation.turn !== frame.observation.turn
    ) {
      return 'stale';
    }
    if (this.surrenderRequested || current.attackIndex < this.pendingIndex) return 'rejected';
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
    if (!isGameEnd(value)) return value;
    const debug = (message: string) =>
      this.log?.(`[rating] game=${value.gameId} phase=after ${message}`);
    debug(
      `snapshot before=${value.rating?.before ?? null} after=${value.rating?.after ?? null} source=${value.rating?.source ?? null} server=${this.server}`,
    );
    if (this.server !== 'generals' || value.rating?.after !== null) {
      debug(
        `sampling skipped reason=${this.server !== 'generals' ? 'non-public-server' : 'existing-or-unavailable-rating'}`,
      );
      return value;
    }
    const username = value.rating?.username;
    if (!username?.trim()) {
      debug('sampling skipped reason=missing-username');
      return value;
    }
    // Finish before requeueing. Public profiles may still lag the actual settlement.
    const samplingSignal = AbortSignal.any([signal, this.ratingsAbort.signal]);
    try {
      debug('sampling waitMs=750');
      await delay(750, undefined, { signal: samplingSignal });
      const stars = await fetchDuelStars(username, samplingSignal, debug);
      if (!samplingSignal.aborted && stars !== null) {
        const applied = this.state.setRatingAfter(value.gameId, stars, 'public-profile');
        const latest = this.state.current();
        debug(`sample applied=${applied} stars=${stars} delta=${latest?.rating?.delta ?? null}`);
        return latest?.gameId === value.gameId ? latest : value;
      }
    } catch {
      // Optional metadata must not turn a completed game into an interruption.
      debug(`sampling interrupted aborted=${samplingSignal.aborted}`);
    }
    const latest = this.getResult();
    debug(
      `sampling finished after=${latest?.rating?.after ?? null} delta=${latest?.rating?.delta ?? null} source=${latest?.rating?.source ?? null} aborted=${samplingSignal.aborted}`,
    );
    return latest?.gameId === value.gameId ? latest : value;
  }

  private collectStars(): void {
    if (this.server !== 'generals' || this.closed) return;
    const current = this.state.getSnapshot();
    if (!current || this.ratingsGameId === current.gameId) return;
    this.ratingsAbort.abort();
    const controller = (this.ratingsAbort = new AbortController());
    this.ratingsGameId = current.gameId;
    for (const player of current.snapshot.players) {
      const debug = (message: string) =>
        this.log?.(
          `[rating] game=${current.gameId} phase=before player=${player.index} self=${player.isSelf} ${message}`,
        );
      if ((!player.isSelf && player.stars !== null) || !player.username?.trim()) {
        debug(
          `lookup skipped stars=${player.stars} reason=${player.stars !== null ? 'existing-snapshot-stars' : 'missing-username'}`,
        );
        continue;
      }
      // Public usernames only; ratings never participate in game scheduling.
      void fetchDuelStars(player.username, controller.signal, debug)
        .then((stars) => {
          if (controller.signal.aborted || this.closed || stars === null) {
            debug(
              `sample ignored stars=${stars} aborted=${controller.signal.aborted} closed=${this.closed}`,
            );
            return;
          }
          const baselineApplied =
            player.isSelf && this.state.setRatingBefore(current.gameId, stars);
          const applied = this.state.setPlayerStars(current.gameId, player.index, stars);
          debug(`sample applied=${applied} baselineApplied=${baselineApplied} stars=${stars}`);
          if (applied || baselineApplied) this.notify();
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
            if (!isGameEnd(value)) this.recorder.bindFrame(value);
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
