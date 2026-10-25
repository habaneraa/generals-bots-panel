import { afterEach, describe, expect, it, vi } from 'vitest';
import createConfig from './vite.config.js';

afterEach(() => vi.unstubAllEnvs());

describe('Vite runtime configuration', () => {
  it.each(['', '0'])('builds without validating the runtime PORT=%j', (port) => {
    vi.stubEnv('PORT', port);
    const config = createConfig({ command: 'build', mode: 'production' });
    expect(config.build?.outDir).toBe('../../dist/web');
    expect(config.server?.proxy?.['/api']).toMatchObject({ target: 'http://127.0.0.1:3000' });
  });

  it('uses the API port for the development proxy without changing the page port', () => {
    vi.stubEnv('PORT', '4321');
    const config = createConfig({ command: 'serve', mode: 'development' });
    expect(config.server?.port).toBe(5173);
    expect(config.server?.proxy?.['/api']).toMatchObject({ target: 'http://127.0.0.1:4321' });
  });

  it('still rejects an invalid listening port for development', () => {
    vi.stubEnv('PORT', '0');
    expect(() => createConfig({ command: 'serve', mode: 'development' })).toThrow(
      'PORT 必须为 1–65535 的整数',
    );
  });
});
