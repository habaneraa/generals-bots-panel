import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API_PORT,
  DEFAULT_DATA_DIR,
  DEV_WEB_PORT,
  LOOPBACK_HOST,
  parseApiPort,
} from './runtime.js';

describe('运行配置', () => {
  it('保留当前本地服务默认值', () => {
    expect({ LOOPBACK_HOST, DEFAULT_API_PORT, DEV_WEB_PORT, DEFAULT_DATA_DIR }).toEqual({
      LOOPBACK_HOST: '127.0.0.1',
      DEFAULT_API_PORT: 3000,
      DEV_WEB_PORT: 5173,
      DEFAULT_DATA_DIR: 'data',
    });
    expect(parseApiPort(undefined)).toBe(3000);
  });

  it.each<[string, number]>([
    ['1', 1],
    ['65535', 65535],
    ['4321', 4321],
    [' 4321 ', 4321],
    ['3000.0', 3000],
    ['3e3', 3000],
    ['0xBB8', 3000],
  ])('沿用 Number 语义将 %s 解析为 %i', (value, expected) => {
    expect(parseApiPort(value)).toBe(expected);
  });

  it.each(['', ' ', '0', '-1', '65536', '3.5', 'NaN', 'Infinity', '3000text'])(
    '拒绝无效端口 %j',
    (value) => {
      expect(() => parseApiPort(value)).toThrow('PORT 必须为 1–65535 的整数');
    },
  );
});
