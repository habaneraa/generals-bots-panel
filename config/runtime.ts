export const LOOPBACK_HOST = '127.0.0.1';
export const DEFAULT_API_PORT = 3000;
export const DEV_WEB_PORT = 5173;
export const DEFAULT_DATA_DIR = 'data';

export function parseApiPort(value: string | undefined): number {
  const port = Number(value ?? DEFAULT_API_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT 必须为 1–65535 的整数');
  return port;
}
