import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../../../packages/contracts/src/index.js';
import { FixtureGame } from '../../../../test/fixtures/game.js';
import { AgentProcess } from './process.js';

const signal = () => new AbortController().signal;

describe('external agent process', () => {
  it.each(['jsonl', 'stdio'] as const)(
    'reuses one child across two games (%s)',
    async (protocol) => {
      const agent = await AgentProcess.start(
        {
          ...defaultConfig,
          command: process.execPath,
          args: [resolve('test/fixtures/pass-agent.mjs')],
          protocol,
        },
        () => {},
      );
      try {
        const frame = (await new FixtureGame().join(signal())).observation;
        agent.begin(frame);
        expect((await agent.act(frame, signal())).pass).toBe(true);
        agent.end();
        agent.begin(frame);
        expect((await agent.act(frame, signal())).pass).toBe(true);
        agent.end();
      } finally {
        await agent.close();
      }
    },
  );

  it('fails cleanly when the executable does not exist', async () => {
    await expect(
      AgentProcess.start(
        { ...defaultConfig, command: '/nonexistent-panel-test-executable' },
        () => {},
      ),
    ).rejects.toThrow();
  });

  it('times out without reusing a desynchronised reply stream', async () => {
    const agent = await AgentProcess.start(
      {
        ...defaultConfig,
        command: process.execPath,
        args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'],
        agentTimeoutMs: 100,
      },
      () => {},
    );
    try {
      const frame = (await new FixtureGame().join(signal())).observation;
      agent.begin(frame);
      await expect(agent.act(frame, signal())).rejects.toThrow('超时');
      await expect(agent.act(frame, signal())).rejects.toThrow('超时');
    } finally {
      await agent.close();
    }
  });

  it('aborts a pending inference and keeps stderr out of stdout', async () => {
    const diagnostics: string[] = [];
    const agent = await AgentProcess.start(
      {
        ...defaultConfig,
        command: process.execPath,
        args: [
          '-e',
          'console.error("boot diagnostic"); process.stdin.resume(); setInterval(() => {}, 1000)',
        ],
      },
      (line) => diagnostics.push(line),
    );
    try {
      const frame = (await new FixtureGame().join(signal())).observation;
      const abort = new AbortController();
      const pending = agent.act(frame, abort.signal);
      abort.abort();
      await expect(pending).rejects.toThrow('取消');
      expect(diagnostics).toContain('boot diagnostic');
    } finally {
      await agent.close();
    }
  });
});
