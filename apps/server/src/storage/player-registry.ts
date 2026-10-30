import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { playerInputSchema } from '../../../../packages/contracts/src/index.js';

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
  const value = registrySchema.parse(registry);
  const temporary = join(dirname(path), `.players-${randomUUID()}.tmp`);
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new AggregateError([error, cleanupError], '保存 Player 注册表失败');
    }
    throw error;
  }
}
