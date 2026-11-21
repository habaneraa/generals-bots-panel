import { existsSync, createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import type { ServerResponse } from 'node:http';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { z, ZodError } from 'zod';
import { DEFAULT_API_PORT, DEV_WEB_PORT, LOOPBACK_HOST } from '../../../config/runtime.js';
import {
  logPageQuerySchema,
  matchFiltersSchema,
  matchQuerySchema,
} from '../../../packages/contracts/src/index.js';
import type { PlayerManager } from './player-manager.js';
import { HttpError } from './errors.js';
import { RunLog } from './storage/logs.js';
import { replayAddressSchema } from './storage/replays.js';

export async function createApp(manager: PlayerManager, webDir: string, port = DEFAULT_API_PORT) {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  const streams = new Set<ServerResponse>();
  const hosts = new Set([`${LOOPBACK_HOST}:${port}`, `localhost:${port}`]);
  const origins = new Set([
    `http://${LOOPBACK_HOST}:${port}`,
    `http://localhost:${port}`,
    `http://${LOOPBACK_HOST}:${DEV_WEB_PORT}`,
    `http://localhost:${DEV_WEB_PORT}`,
  ]);
  app.addHook('onRequest', async (request) => {
    if (!hosts.has(request.headers.host ?? '')) throw new HttpError(403, '仅允许本机地址访问');
    // No CORS. Block cross-origin requests and DNS rebinding to this command-execution API.
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) throw new HttpError(403, '不允许来自该网页的请求');
    if (request.headers['sec-fetch-site'] === 'cross-site')
      throw new HttpError(403, '不允许跨站请求');
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        message: error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('；'),
      });
    }
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({ message: error.message });
    const known = error instanceof Error ? error : new Error(String(error));
    const code = 'statusCode' in known ? known.statusCode : undefined;
    const status = typeof code === 'number' && code >= 400 && code <= 599 ? code : 500;
    if (status >= 500) console.error(known);
    return reply
      .code(status)
      .send({ message: status < 500 ? known.message : '内部错误，请查看服务端终端' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  const playerQuery = z.object({ playerId: z.string().optional() }).strict();
  const selection = (query: unknown) => playerQuery.parse(query).playerId;
  app.get('/api/players', async () => manager.players);
  app.post('/api/players', async (request, reply) => {
    const abort = new AbortController();
    const cancel = () => {
      if (!reply.raw.writableEnded) abort.abort();
    };
    request.raw.once('aborted', cancel);
    reply.raw.once('close', cancel);
    try {
      return reply.code(201).send(await manager.add(request.body, abort.signal));
    } finally {
      request.raw.off('aborted', cancel);
      reply.raw.off('close', cancel);
    }
  });
  app.get('/api/players/:id', async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return manager.details(id);
  });
  app.delete('/api/players/:id', async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return manager.remove(id, selection(request.query));
  });
  app.put('/api/players/active', async (request) => {
    const { playerId } = z.object({ playerId: z.string() }).strict().parse(request.body);
    return manager.select(playerId);
  });
  app.get('/api/dashboard', async (request) => manager.dashboard(selection(request.query)));
  app.put('/api/config', async (request) =>
    manager.controller(selection(request.query)).saveConfig(request.body),
  );
  app.post('/api/runs', async (request, reply) => {
    const id = selection(request.query);
    manager.controller(id).start(request.body);
    return reply.code(201).send(manager.dashboard(id));
  });
  app.post('/api/runs/stop', async (request) => {
    const controller = manager.controller(selection(request.query));
    await controller.stop();
    return manager.dashboard(controller.player.id);
  });
  app.get('/api/matches', async (request) => {
    const { playerId, ...query } = request.query as Record<string, unknown>;
    const controller = manager.controller(z.string().optional().parse(playerId));
    const { page, pageSize, ...filters } = matchQuerySchema.parse(query);
    return controller.repository.matches(page, pageSize, filters);
  });
  app.get('/api/matches/star-history', async (request) => {
    const { playerId, ...query } = request.query as Record<string, unknown>;
    return manager
      .controller(z.string().optional().parse(playerId))
      .repository.starHistory(matchFiltersSchema.parse(query));
  });
  app.get('/api/matches/:id', async (request) => {
    const controller = manager.controller(selection(request.query));
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const match = controller.repository.getMatch(id);
    if (!match) throw new HttpError(404, '对局记录不存在');
    return match;
  });
  app.get('/api/replays/:server/:gameId', async (request) => {
    const controller = manager.controller(selection(request.query));
    const { server, gameId } = replayAddressSchema.parse(request.params);
    const replay = await controller.replays.load(server, gameId);
    if (!replay) throw new HttpError(404, '本地录像不存在');
    return replay;
  });
  app.get('/api/replays/:server/:gameId/download', async (request, reply) => {
    const controller = manager.controller(selection(request.query));
    const { server, gameId } = replayAddressSchema.parse(request.params);
    const packed = await controller.replays.packed(server, gameId);
    if (!packed) throw new HttpError(404, '本地录像不存在');
    return reply
      .type('application/gzip')
      .header('Content-Disposition', `attachment; filename="${gameId}.json.gz"`)
      .send(packed);
  });
  app.get('/api/runs/:id/logs', async (request) => {
    const { playerId, ...query } = request.query as Record<string, unknown>;
    const controller = manager.controller(z.string().optional().parse(playerId));
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { beforeId, afterId, limit } = logPageQuerySchema.parse(query);
    if (!controller.repository.getRun(id)) throw new HttpError(404, '运行记录不存在');
    const path = controller.repository.logPath(id);
    if (!existsSync(path)) return { entries: [], hasMore: false };
    return RunLog.page(path, { beforeId, afterId }, limit);
  });
  app.get('/api/runs/:id/logs/download', async (request, reply) => {
    const controller = manager.controller(selection(request.query));
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    if (!controller.repository.getRun(id)) throw new HttpError(404, '运行记录不存在');
    const path = controller.repository.logPath(id);
    if (!existsSync(path)) throw new HttpError(404, '日志文件不存在');
    return reply
      .type('application/x-ndjson')
      .header('Content-Disposition', `attachment; filename="${id}.jsonl"`)
      .send(createReadStream(path));
  });
  app.get('/api/events', (request, reply) => {
    const playerId = selection(request.query);
    manager.dashboard(playerId); // Validate before hijacking, so invalid explicit IDs return 404.
    reply.hijack();
    streams.add(reply.raw);
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let blocked = false;
    let changed = false;
    const send = () => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      if (playerId !== undefined && !manager.players.some((player) => player.id === playerId)) {
        reply.raw.end(`event: player-deleted\ndata: ${JSON.stringify({ playerId })}\n\n`);
        return;
      }
      if (blocked) {
        changed = true;
        return;
      }
      changed = false;
      blocked = !reply.raw.write(
        `event: dashboard\ndata: ${JSON.stringify(manager.dashboard(playerId))}\n\n`,
      );
    };
    reply.raw.on('drain', () => {
      blocked = false;
      if (changed) send(); // Keep only the latest state, not a queue of historical snapshots.
    });
    const unsubscribe = manager.subscribe(send);
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed && !blocked) blocked = !reply.raw.write(': heartbeat\n\n');
    }, 15000);
    heartbeat.unref();
    reply.raw.on('close', () => {
      streams.delete(reply.raw);
      unsubscribe();
      clearInterval(heartbeat);
    });
    request.raw.on('error', () => reply.raw.end());
    send();
  });

  const hasWeb = existsSync(resolve(webDir, 'index.html'));
  if (hasWeb) await app.register(fastifyStatic, { root: resolve(webDir) });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ message: '接口不存在' });
    if (request.url.startsWith('/assets/'))
      return reply.code(404).send({ message: '静态资源不存在' });
    if (hasWeb && (request.method === 'GET' || request.method === 'HEAD'))
      return reply.sendFile('index.html');
    return reply.code(404).send({
      message: `开发界面：http://${LOOPBACK_HOST}:${DEV_WEB_PORT}；部署前请运行 npm run build`,
    });
  });
  app.addHook('preClose', async () => {
    for (const stream of streams) stream.end();
    streams.clear();
    await manager.close();
  });
  return app;
}
