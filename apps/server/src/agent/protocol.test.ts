import { describe, expect, it } from 'vitest';
import { FixtureGame } from '../../../../test/fixtures/game.js';
import { decodeAction, encodeEnd, encodeObservation, encodeStart } from './protocol.js';

async function observation() {
  return (await new FixtureGame().join(new AbortController().signal)).observation;
}

describe('agent wire contract', () => {
  it('encodes JSONL v2 without leaking game metadata', async () => {
    const frame = await observation();
    expect(JSON.parse(encodeStart(frame, 'jsonl'))).toMatchObject({
      event: 'start',
      version: 2,
      height: 3,
      width: 3,
    });
    const event = JSON.parse(encodeObservation(frame, 'jsonl'));
    expect(event).toEqual({ event: 'observation', ...frame });
    expect(event.gameId).toBeUndefined();
    expect(encodeEnd('jsonl')).toBe('{"event":"end"}\n');
  });

  it('encodes the legacy integer protocol with the correct grid order', async () => {
    const frame = await observation();
    expect(encodeStart(frame, 'stdio')).toBe('0 3 3\n');
    const lines = encodeObservation(frame, 'stdio').trimEnd().split('\n');
    expect(lines).toHaveLength(10);
    expect(lines[1]).toBe('4 1 1');
    expect(lines[4]).toBe('1 0 0');
    expect(lines[7]).toBe('10 0 0');
    expect(encodeEnd('stdio')).toBe('\n');
  });

  it('accepts moves, pass, half moves and a finite optional value', () => {
    expect(decodeAction('0 2 3 1 1 -0.25')).toEqual({
      pass: false,
      row: 2,
      col: 3,
      direction: 1,
      split: true,
      value: -0.25,
    });
    expect(decodeAction('1 0 0 0 0\r')).toMatchObject({ pass: true, value: null });
  });

  it.each([
    '',
    'READY',
    '0 1 2 4 0',
    '0 0 0 0 2',
    '2 0 0 0 0',
    '0 1.2 0 0 0',
    '1 0 0 0 0 NaN',
    '1 0 0 0 0 Infinity',
    '1 0 0 0 0 1 2',
  ])('rejects invalid stdout: %s', (line) => {
    expect(() => decodeAction(line)).toThrow();
  });
});
