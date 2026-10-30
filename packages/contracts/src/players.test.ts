import { describe, expect, it } from 'vitest';
import { defaultConfig, playerInputSchema, runConfigSchema } from './index.js';

describe('Player identity contracts', () => {
  it('accepts only a server and trimmed userId, without manual nicknames or account files', () => {
    expect(playerInputSchema.parse({ server: 'bots', userId: ' account ' })).toEqual({
      server: 'bots',
      userId: 'account',
    });
    expect(defaultConfig).not.toHaveProperty('server');
    expect(defaultConfig).not.toHaveProperty('userIdFile');
    for (const field of [{ server: 'bots' }, { userIdFile: 'account.txt' }, { userId: 'account' }])
      expect(runConfigSchema.safeParse({ ...defaultConfig, ...field }).success).toBe(false);
  });
  it.each([
    { server: 'other', userId: 'id' },
    { server: 'generals', userId: ' ' },
    { server: 'generals', userId: 'x'.repeat(4097) },
    { server: 'generals', userId: 'id', nickname: 'manual' },
    { server: 'generals', userId: 'id', id: 'cannot choose path' },
    { server: 'generals' },
  ])('rejects invalid input %j', (value) => {
    expect(playerInputSchema.safeParse(value).success).toBe(false);
  });
});
