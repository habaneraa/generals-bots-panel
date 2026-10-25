import type { MatchRating, MatchSnapshot } from '../../../../packages/contracts/src/index.js';
import type { GameEnd, GameFrame, Observation } from './types.js';

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validFinalScores(value: unknown): value is Score[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 2 &&
    value.every((entry) => {
      const score = optionalRecord(entry);
      return (
        score !== null &&
        (score.i === 0 || score.i === 1) &&
        typeof score.tiles === 'number' &&
        Number.isSafeInteger(score.tiles) &&
        score.tiles >= 0 &&
        typeof score.total === 'number' &&
        Number.isSafeInteger(score.total) &&
        score.total >= 0
      );
    }) &&
    new Set(value.map((score: Score) => score.i)).size === value.length
  );
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Malformed ${field}`);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`Malformed ${field}`);
  }
  return value;
}

function integers(value: unknown, field: string): number[] {
  if (!Array.isArray(value)) throw new Error(`Malformed ${field}`);
  return value.map((item) => integer(item, field, Number.MIN_SAFE_INTEGER));
}

/** Alternating unchanged spans and replacement spans, not a JSON patch. */
export function patchArray(previous: readonly number[], value: unknown): number[] {
  const diff = integers(value, 'game diff');
  const result: number[] = [];
  let offset = 0;
  while (offset < diff.length) {
    const same = integer(diff[offset++], 'unchanged span');
    if (result.length + same > previous.length) throw new Error('Game diff exceeds previous array');
    for (let index = 0; index < same; index++) result.push(previous[result.length]!);
    if (offset < diff.length) {
      const changed = integer(diff[offset++], 'replacement span');
      if (changed > diff.length - offset) throw new Error('Incomplete game diff');
      for (let index = 0; index < changed; index++) result.push(diff[offset++]!);
    }
  }
  return result;
}

interface Score {
  i: number;
  tiles: number;
  total: number;
}

interface ActiveGame {
  id: string;
  startedAt: string;
  player: number;
  usernames: string[];
  teams: number[];
  turn: number;
  serverTurn: number | null;
  attackIndex: number;
  scores: Score[];
  map: number[] | null;
  cities: number[];
  generals: number[];
  deserts: number[];
  swamps: number[];
  stars: (number | null)[];
  rating: MatchRating;
  ratingBeforeSource: 'game-event' | 'public-profile' | null;
  alive: (boolean | null)[];
  knownCities: Set<number>;
  citiesKnown: boolean;
  cityViewCurrent: boolean;
  capturedAt: string;
  gameType: string;
}

function checkOptions(data: Record<string, unknown>): void {
  if (data.game_type !== undefined && data.game_type !== '1v1') {
    throw new Error('Only standard two-player games are supported');
  }
  const options = data.options === undefined ? {} : record(data.options, 'game options');
  if (
    (options.modifiers !== undefined &&
      (!Array.isArray(options.modifiers) || options.modifiers.length !== 0)) ||
    (options.torus !== undefined && options.torus !== false) ||
    (data.torus !== undefined && data.torus !== false)
  ) {
    throw new Error('Game modifiers and special rules are unsupported');
  }
}

/** Accumulate one playing perspective; snapshots never expose hidden armies. */
export class GameState {
  private game: ActiveGame | null = null;
  private end: GameEnd | null = null;

  reset(): void {
    this.game = null;
    this.end = null;
  }

  update(event: string, payload?: unknown): void {
    if (event === 'game_start') {
      const data = record(payload, 'game_start');
      checkOptions(data);
      if (data.game_type !== '1v1') throw new Error('Expected a 1v1 queue match');
      const player = integer(data.playerIndex, 'playerIndex');
      const usernames = data.usernames;
      if (
        player > 1 ||
        !Array.isArray(usernames) ||
        usernames.length !== 2 ||
        usernames.some((name) => typeof name !== 'string')
      ) {
        throw new Error('A standard two-player playing perspective is required');
      }
      const suppliedTeams = data.teams == null ? [] : integers(data.teams, 'teams');
      const teams = suppliedTeams.length ? suppliedTeams : [0, 1];
      if (teams.length !== 2 || teams[0] === teams[1]) {
        throw new Error('Allied and multiplayer games are unsupported');
      }
      if (typeof data.replay_id !== 'string' || !data.replay_id) {
        throw new Error('Missing game replay ID');
      }
      // A repeated start must not resurrect a completed game or erase its diffs.
      if (this.game?.id === data.replay_id) return;
      this.game = {
        id: data.replay_id,
        startedAt: new Date().toISOString(),
        player,
        usernames: [...usernames] as string[],
        teams,
        turn: 0,
        serverTurn: null,
        attackIndex: 0,
        scores: [],
        map: null,
        cities: [],
        generals: [],
        deserts: [],
        swamps: [],
        stars: [null, null],
        rating: {
          username: usernames[player] || null,
          before: null,
          after: null,
          delta: null,
          source: null,
          capturedAt: null,
        },
        ratingBeforeSource: null,
        alive: [null, null],
        knownCities: new Set(),
        citiesKnown: false,
        cityViewCurrent: true,
        capturedAt: new Date().toISOString(),
        gameType: data.game_type,
      };
      this.end = null;
      this.merge(data);
      return;
    }
    if (!this.game) return;
    if (event === 'game_update' && !this.end) {
      this.merge(record(payload, 'game_update'));
    } else if (event === 'game_won' || event === 'game_lost' || event === 'game_over') {
      // Only consume validated terminal metadata, never arbitrary result payloads.
      const game = this.game;
      const data = optionalRecord(payload);
      if (
        data &&
        ['replay_id', 'gameId', 'game_id'].some(
          (key) => data[key] !== undefined && data[key] !== game.id,
        )
      ) {
        return;
      }
      if (data) {
        if (validFinalScores(data.scores)) {
          const finalScores = data.scores;
          const changed = finalScores.some((final) => {
            const previous = game.scores.find((score) => score.i === final.i);
            return previous?.tiles !== final.tiles || previous?.total !== final.total;
          });
          game.scores = [
            ...game.scores.filter((score) => !finalScores.some((final) => final.i === score.i)),
            ...finalScores.map(({ i, tiles, total }) => ({ i, tiles, total })),
          ];
          // A final scoreboard does not make the previous map a final map.
          game.cityViewCurrent = false;
          if (changed) game.capturedAt = new Date().toISOString();
        }
        if (
          typeof data.turn === 'number' &&
          Number.isSafeInteger(data.turn) &&
          data.turn > game.turn
        ) {
          game.cityViewCurrent = false;
          game.turn = data.turn;
          game.serverTurn = data.turn;
          game.capturedAt = new Date().toISOString();
        }
        this.mergeMetadata(data, true);
      }
      const winnerIndex = this.end
        ? this.end.winnerIndex
        : event === 'game_won'
          ? game.player
          : event === 'game_lost'
            ? 1 - game.player
            : data?.winnerIndex === 0 || data?.winnerIndex === 1
              ? data.winnerIndex
              : undefined;
      if (winnerIndex !== undefined) {
        game.alive[winnerIndex] = true;
        game.alive[1 - winnerIndex] = false;
      }
      const snapshot = this.snapshot();
      // Later terminal events enrich metadata without replacing the first result.
      this.end = {
        gameId: game.id,
        startedAt: game.startedAt,
        endedAt: this.end?.endedAt ?? new Date().toISOString(),
        outcome:
          this.end?.outcome ??
          (winnerIndex === undefined ? 'draw' : winnerIndex === game.player ? 'won' : 'lost'),
        turn: game.turn - 1,
        endReason: this.end?.endReason ?? event,
        ...(winnerIndex === undefined ? {} : { winnerIndex }),
        ...(snapshot ? { snapshot } : {}),
        rating: { ...game.rating },
      };
    }
  }

  private merge(data: Record<string, unknown>): void {
    const game = this.game!;
    checkOptions(data);
    for (const key of ['map', 'cities', 'deserts'] as const) {
      const diff = data[`${key}_diff`];
      if (diff !== undefined && diff !== null) {
        game[key] = patchArray(game[key] ?? [], diff);
      } else if (data[key] !== undefined) {
        game[key] = integers(data[key], key);
      }
    }
    for (const key of ['generals', 'swamps'] as const) {
      if (data[key] !== undefined) game[key] = integers(data[key], key);
    }
    if (game.deserts.length || game.swamps.length) {
      throw new Error('Special terrain is unsupported');
    }
    if (data.turn !== undefined) {
      game.turn = integer(data.turn, 'turn');
      game.serverTurn = game.turn;
    }
    if (data.attackIndex !== undefined) {
      const attackIndex = integer(data.attackIndex, 'attackIndex');
      if (attackIndex < game.attackIndex) throw new Error('Game attack index moved backwards');
      game.attackIndex = attackIndex;
    }
    if (data.scores !== undefined) {
      if (!Array.isArray(data.scores) || data.scores.length > 2) {
        throw new Error('Malformed game scores');
      }
      game.scores = data.scores.map((value) => {
        const score = record(value, 'score');
        const i = integer(score.i, 'score player');
        if (i > 1) throw new Error('Unsupported score player');
        return {
          i,
          tiles: integer(score.tiles, 'score tiles'),
          total: integer(score.total, 'score total'),
        };
      });
      if (new Set(game.scores.map((score) => score.i)).size !== game.scores.length) {
        throw new Error('Duplicate game score player');
      }
    }
    // Validate new map data even before a complete score update arrives.
    if (game.map) this.mapSize(game);
    for (const city of game.cities) game.knownCities.add(city);
    if (data.cities !== undefined || data.cities_diff != null) game.citiesKnown = true;
    game.cityViewCurrent = true;
    game.capturedAt = new Date().toISOString();
    this.mergeMetadata(data);
  }

  private mergeMetadata(data: Record<string, unknown>, terminal = false): void {
    const game = this.game!;
    // No public player ID field is established by the legacy client. In particular,
    // SocketGame.userId and stars_and_rank identify a login, not a public player.
    if (Array.isArray(data.stars) && data.stars.length === game.usernames.length) {
      data.stars.forEach((value, index) => {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
          game.stars[index] = value;
          if (index === game.player) {
            if (terminal) this.setRatingAfter(game.id, value, 'terminal');
            else if (game.rating.before === null) {
              game.rating.before = value;
              game.ratingBeforeSource = 'game-event';
            }
          }
        }
      });
    }
    if (Array.isArray(data.scores)) {
      for (const value of data.scores) {
        const score = optionalRecord(value);
        if (score && (score.i === 0 || score.i === 1) && typeof score.dead === 'boolean') {
          game.alive[score.i] = !score.dead;
        }
      }
    }
  }

  setPlayerStars(gameId: string, index: number, stars: number): boolean {
    const game = this.game;
    if (
      !game ||
      game.id !== gameId ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= game.usernames.length ||
      !Number.isFinite(stars) ||
      stars < 0 ||
      game.stars[index] !== null
    ) {
      return false;
    }
    game.stars[index] = stars;
    if (index === game.player) this.setRatingBefore(gameId, stars);
    if (this.end?.snapshot) {
      this.end.snapshot = {
        ...this.end.snapshot,
        players: this.end.snapshot.players.map((player) =>
          player.index === index ? { ...player, stars } : player,
        ),
      };
    }
    return true;
  }

  /** Prefer the first exact public sample, but never introduce a baseline after the game. */
  setRatingBefore(gameId: string, stars: number): boolean {
    const game = this.game;
    if (
      !game ||
      game.id !== gameId ||
      this.end ||
      game.ratingBeforeSource === 'public-profile' ||
      !Number.isFinite(stars) ||
      stars < 0
    ) {
      return false;
    }
    game.rating.before = stars;
    game.ratingBeforeSource = 'public-profile';
    return true;
  }

  setRatingAfter(gameId: string, stars: number, source: 'terminal' | 'public-profile'): boolean {
    const game = this.game;
    if (
      !game ||
      game.id !== gameId ||
      !Number.isFinite(stars) ||
      stars < 0 ||
      (game.rating.source === 'terminal' && source !== 'terminal')
    ) {
      return false;
    }
    if (game.rating.after === stars && game.rating.source === source) return true;
    game.rating.after = stars;
    game.rating.source = source;
    game.rating.capturedAt = new Date().toISOString();
    const comparable =
      source === 'public-profile'
        ? game.ratingBeforeSource === 'public-profile'
        : game.ratingBeforeSource === 'game-event';
    game.rating.delta =
      game.rating.before === null || !comparable ? null : stars - game.rating.before;
    if (this.end) this.end.rating = { ...game.rating };
    return true;
  }

  getSnapshot(): { gameId: string; snapshot: MatchSnapshot; rating: MatchRating } | null {
    const snapshot = this.snapshot();
    return this.game && snapshot
      ? { gameId: this.game.id, snapshot, rating: { ...this.game.rating } }
      : null;
  }

  private snapshot(): MatchSnapshot | null {
    const game = this.game;
    if (!game) return null;
    const dimensions = game.map ? this.mapSize(game) : null;
    const visibleLand = [0, 0];
    const visibleCities = [0, 0];
    for (let index = 0; index < (dimensions?.size ?? 0); index++) {
      const owner = game.map![2 + dimensions!.size + index]!;
      if (owner === 0 || owner === 1) {
        visibleLand[owner]!++;
        if (game.knownCities.has(index)) visibleCities[owner]!++;
      }
    }
    return {
      turn: game.serverTurn === null ? null : game.turn - 1,
      serverTurn: game.serverTurn,
      capturedAt: game.capturedAt,
      gameType: game.gameType,
      teams: [...game.teams],
      // checkOptions already rejects nonstandard rules; do not invent modifiers.
      modifiers: [],
      torus: false,
      map: dimensions ? { width: dimensions.width, height: dimensions.height } : null,
      players: game.usernames.map((username, index) => {
        const score = game.scores.find((entry) => entry.i === index);
        const knownCount =
          score?.tiles === 0
            ? 0
            : dimensions && game.citiesKnown && game.cityViewCurrent
              ? visibleCities[index]!
              : null;
        const allLandVisible =
          dimensions !== null && score !== undefined && visibleLand[index] === score.tiles;
        return {
          index,
          isSelf: index === game.player,
          userId: null,
          username,
          stars: game.stars[index] ?? null,
          team: game.teams[index] ?? null,
          land: score?.tiles ?? null,
          army: score?.total ?? null,
          cities: score?.tiles === 0 || allLandVisible ? knownCount : null,
          visibleCities: knownCount,
          alive: game.alive[index] ?? null,
        };
      }),
    };
  }

  private mapSize(game: ActiveGame): { width: number; height: number; size: number } {
    const raw = game.map!;
    const width = integer(raw[0], 'map width', 1);
    const height = integer(raw[1], 'map height', 1);
    const size = width * height;
    if (
      !Number.isSafeInteger(size) ||
      (raw.length !== 2 + 2 * size && raw.length !== 2 + 3 * size)
    ) {
      throw new Error('Malformed serialized game map');
    }
    for (let index = 0; index < size; index++) {
      integer(raw[2 + index], 'army');
      const terrain = integer(raw[2 + size + index], 'terrain', -4);
      if (terrain > 1) throw new Error('Unsupported terrain');
    }
    for (const limit of raw.slice(2 + 2 * size)) {
      if (limit !== 0) throw new Error('Tunnels are unsupported');
    }
    for (const city of game.cities) {
      if (city < 0 || city >= size) throw new Error('Malformed city index');
    }
    for (const general of game.generals) {
      if (general < -1 || general >= size) throw new Error('Malformed general index');
    }
    return { width, height, size };
  }

  current(): GameFrame | GameEnd | null {
    if (this.end) return { ...this.end };
    const game = this.game;
    if (!game?.map || game.turn === 0 || game.scores.length !== 2) return null;
    const { width, height, size } = this.mapSize(game);
    const cities = new Set(game.cities);
    const generals = new Set(game.generals);
    const types: number[][] = [];
    const owners: number[][] = [];
    const armies: number[][] = [];
    const playerGrid: number[][] = [];
    for (let row = 0; row < height; row++) {
      const tileTypes: number[] = [];
      const tileOwners: number[] = [];
      const tileArmies: number[] = [];
      const tilePlayers: number[] = [];
      for (let col = 0; col < width; col++) {
        const index = row * width + col;
        const terrain = game.map[2 + size + index]!;
        tileTypes.push(
          terrain === -3
            ? 0
            : terrain === -4
              ? 5
              : terrain === -2
                ? 2
                : generals.has(index)
                  ? 4
                  : cities.has(index)
                    ? 3
                    : 1,
        );
        tileOwners.push(terrain < 0 ? 0 : terrain === game.player ? 1 : 2);
        tileArmies.push(terrain === -3 || terrain === -4 ? 0 : game.map[2 + index]!);
        tilePlayers.push(terrain);
      }
      types.push(tileTypes);
      owners.push(tileOwners);
      armies.push(tileArmies);
      playerGrid.push(tilePlayers);
    }
    const me = game.scores.find((score) => score.i === game.player)!;
    const enemy = game.scores.find((score) => score.i !== game.player)!;
    const observation: Observation = {
      player_id: game.player,
      turn: game.turn - 1,
      my_land: me.tiles,
      my_army: me.total,
      opp_land: enemy.tiles,
      opp_army: enemy.total,
      allied_land: 0,
      allied_army: 0,
      mode: '1v1',
      teams: [...game.teams],
      players: game.scores.map((score) => ({
        ...score,
        username: game.usernames[score.i]!,
        team: game.teams[score.i]!,
        relation: score.i === game.player ? 'self' : 'enemy',
      })),
      types,
      owners,
      armies,
      player_grid: playerGrid,
      rules: { game_type: '1v1', modifiers: [], torus: false },
      features: { deserts: [], swamps: [], tunnels: [] },
    };
    return {
      gameId: game.id,
      startedAt: game.startedAt,
      observation,
      attackIndex: game.attackIndex,
      snapshot: this.snapshot()!,
      rating: { ...game.rating },
    };
  }
}
