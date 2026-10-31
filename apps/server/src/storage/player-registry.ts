import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { playerInputSchema } from '../../../../packages/contracts/src/index.js';
import { writeJsonAtomic } from './atomic-json.js';

export const registrySchema = z
  .object({
    version: z.literal(1),
    activePlayerId: z.uuid().nullable(),
    players: z.array(
      playerInputSchema.extend({ id: z.uuid(), nickname: z.string().trim().min(1).max(200) }),
    ),
  })
  .strict()
  .superRefine((registry, ctx) => {
    const ids = new Set<string>();
    const identities = new Set<string>();
    for (const player of registry.players) {
      const identity = JSON.stringify([player.server, player.userId]);
      if (ids.has(player.id) || identities.has(identity))
        ctx.addIssue({ code: 'custom', message: 'Player 注册表存在重复身份' });
      ids.add(player.id);
      identities.add(identity);
    }
    if (registry.activePlayerId !== null && !ids.has(registry.activePlayerId))
      ctx.addIssue({ code: 'custom', message: '选中的 Player 不存在' });
  });
export type PlayerRegistry = z.infer<typeof registrySchema>;

export function readRegistry(path: string): PlayerRegistry | null {
  try {
    return registrySchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`无法读取 Player 注册表 ${path}，原数据未被覆盖`, { cause: error });
  }
}

export function writeRegistry(path: string, registry: PlayerRegistry): void {
  writeJsonAtomic(path, registrySchema.parse(registry), { sync: true });
}
