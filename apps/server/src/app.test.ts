import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { PlayerManager } from './player-manager.js';

const resources: { app: FastifyInstance; manager: PlayerManager; dir: string }[] = [];
afterEach(async () => {
  for (const { app, dir } of resources.splice(0)) {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function setup(port?: number) {
  const dir = mkdtempSync(join(tmpdir(), 'panel-static-'));
  const webDir = join(dir, 'web');
  mkdirSync(webDir);
  writeFileSync(join(webDir, 'index.html'), '<html>panel shell</html>');
  const manager = new PlayerManager(join(dir, 'data'), dir, undefined, async () => 'test player');
  const app = await createApp(manager, webDir, port);
  resources.push({ app, manager, dir });
  await app.ready();
  return { app, manager, webDir };
}

const headers = { host: '127.0.0.1:3000' };

describe('built web assets', () => {
  it('serves assets created by a rebuild after the application is registered', async () => {
    const { app, webDir } = await setup();
    mkdirSync(join(webDir, 'assets'));
    writeFileSync(join(webDir, 'assets', 'rebuilt.js'), 'console.log("rebuilt asset");');
    const response = await app.inject({ url: '/assets/rebuilt.js', headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('javascript');
    expect(response.body).toBe('console.log("rebuilt asset");');
  });

  it('keeps the SPA fallback separate from missing API routes', async () => {
    const { app } = await setup();
    const page = await app.inject({ url: '/history', headers });
    expect(page.statusCode).toBe(200);
    expect(page.body).toBe('<html>panel shell</html>');
    const api = await app.inject({ url: '/api/missing', headers });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ message: '接口不存在' });
  });
});

describe('HTTP error boundary', () => {
  it('returns intentional client errors and logs internal errors without exposing details', async () => {
    const { app, manager } = await setup();
    const clientError = await app.inject({
      method: 'POST',
      url: '/api/runs/stop',
      headers,
    });
    expect(clientError.statusCode).toBe(409);
    expect(clientError.json()).toEqual({ message: '请先创建 Player' });

    const failure = new Error('database unavailable at /private/data');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(manager, 'dashboard').mockImplementation(() => {
      throw failure;
    });
    const internalError = await app.inject({ url: '/api/dashboard', headers });
    expect(internalError.statusCode).toBe(500);
    expect(internalError.json()).toEqual({ message: '内部错误，请查看服务端终端' });
    expect(internalError.body).not.toContain('private/data');
    expect(log).toHaveBeenCalledWith(failure);
  });
});

describe('自定义 API 端口的本机访问限制', () => {
  it.each(['127.0.0.1', 'localhost'])('允许自定义端口的本机 Host 和 Origin：%s', async (host) => {
    const { app } = await setup(4321);
    const response = await app.inject({
      url: '/api/health',
      headers: { host: `${host}:4321`, origin: `http://${host}:4321` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it.each(['http://127.0.0.1:5173', 'http://localhost:5173'])(
    '允许开发界面 Origin：%s',
    async (origin) => {
      const { app } = await setup(4321);
      const response = await app.inject({
        url: '/api/health',
        headers: { host: '127.0.0.1:4321', origin },
      });
      expect(response.statusCode).toBe(200);
    },
  );

  it.each<[string, string]>([
    ['127.0.0.1:3000', 'http://127.0.0.1:4321'],
    ['127.0.0.1:4321', 'http://localhost:3000'],
    ['outside.invalid:4321', 'http://127.0.0.1:4321'],
    ['127.0.0.1:4321', 'https://outside.invalid'],
  ])('拒绝不匹配的 Host %s / Origin %s', async (host, origin) => {
    const { app } = await setup(4321);
    const response = await app.inject({ url: '/api/health', headers: { host, origin } });
    expect(response.statusCode).toBe(403);
  });
});
