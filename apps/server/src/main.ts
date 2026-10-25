import { resolve } from 'node:path';
import { createApp } from './app.js';
import { Controller } from './controller.js';
import { Repository } from './storage/repository.js';

const root = process.cwd();
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT 必须为 1–65535 的整数');
const repository = new Repository(resolve(root, process.env.DATA_DIR ?? 'data'));
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
  await app.listen({ host: '127.0.0.1', port });
  console.log(`Generals Bots Panel: http://127.0.0.1:${port}`);
  console.log(`本地数据：${repository.dataDir}`);
} catch (error) {
  console.error(error);
  await controller.close();
  repository.close();
  process.exitCode = 1;
}
