import type { PlayerInput } from '../../../../packages/contracts/src/index.js';
import { GameSocket } from './socket.js';

const SERVERS = {
  generals: 'wss://ws.generals.io',
  bots: 'wss://botws.generals.io',
};
export const gameEndpoint = (server: PlayerInput['server']): string =>
  `${SERVERS[server]}/socket.io/?EIO=4&transport=websocket`;

export function validNickname(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200)
    throw new Error('游戏服务器未返回有效昵称，请先设置游戏昵称');
  return value.trim();
}

export type NicknameLookup = (player: PlayerInput, signal: AbortSignal) => Promise<string>;

/** Identity lookup only: never joins a game or sends queue/account mutations. */
export const lookupNickname: NicknameLookup = async (player, signal) => {
  const socket = new GameSocket(gameEndpoint(player.server), {
    event: (event) => {
      if (event === 'gio_error' || event.startsWith('error_'))
        throw new Error('游戏服务器拒绝昵称查询');
    },
    error: () => {},
  });
  try {
    await socket.connect(signal);
    signal.throwIfAborted();
    const reply = await socket.request('get_username', [player.userId], signal);
    signal.throwIfAborted();
    return validNickname(reply[0]);
  } catch {
    // Never expose errors/packets containing credentials, even when a transport is injected.
    throw new Error(signal.aborted ? '昵称查询已取消' : '无法查询游戏昵称，请检查服务器与 userId');
  } finally {
    socket.close();
  }
};
