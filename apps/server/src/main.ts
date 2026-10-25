import { resolve } from 'node:path';
import { DEFAULT_DATA_DIR, LOOPBACK_HOST, parseApiPort } from '../../../config/runtime.js';
import { createApp } from './app.js';
import { Controller } from './controller.js';
import { Repository } from './storage/repository.js';

const root = process.cwd();
const port = parseApiPort(process.env.PORT);
const repository = new Repository(resolve(root, process.env.DATA_DIR ?? DEFAULT_DATA_DIR));
const controller = new Controller(repository, root);
const app = await createApp(controller, resolve(root, 'dist/web'), port);
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  // Close active SSE responses as well as pending process/game work before Fastify drains connections.
  await controller.close();
  await app.close();
  repository.close();
};
process.once('SIGINT', () => {
  void shutdown().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
});
process.once('SIGTERM', () => {
  void shutdown().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
});
try {
  await app.listen({ host: LOOPBACK_HOST, port });
  console.log(`Generals Bots Panel: http://${LOOPBACK_HOST}:${port}`);
  console.log(`本地数据：${repository.dataDir}`);
} catch (error) {
  console.error(error);
  await controller.close();
  repository.close();
  process.exitCode = 1;
}
