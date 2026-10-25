import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { Controller } from './controller.js';
import { Repository } from './storage/repository.js';

const resources: { app: FastifyInstance; repository: Repository; dir: string }[] = [];
afterEach(async () => {
  for (const { app, repository, dir } of resources.splice(0)) {
    await app.close();
    repository.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'panel-static-'));
  const webDir = join(dir, 'web');
  mkdirSync(webDir);
  writeFileSync(join(webDir, 'index.html'), '<html>panel shell</html>');
  const repository = new Repository(join(dir, 'data'));
  const controller = new Controller(repository, dir);
  const app = await createApp(controller, webDir);
  resources.push({ app, repository, dir });
  await app.ready();
  return { app, webDir };
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
