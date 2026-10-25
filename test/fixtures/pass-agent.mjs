// Protocol fixture for child-process tests, not a product agent.
import { createInterface } from 'node:readline';
let protocol = null;
let height = 0;
let remaining = 0;
let expectingHeader = false;
for await (const line of createInterface({ input: process.stdin })) {
  if (line.startsWith('{')) {
    const event = JSON.parse(line);
    if (event.event === 'start') protocol = 'jsonl';
    if (event.event === 'observation') process.stdout.write('1 0 0 0 0 0.0\n');
    if (event.event === 'end') protocol = null;
    continue;
  }
  if (!line.trim()) {
    protocol = null;
    continue;
  }
  if (protocol === null) {
    protocol = 'stdio';
    height = Number(line.trim().split(/\s+/)[1]);
    expectingHeader = true;
  } else if (expectingHeader) {
    remaining = height * 3;
    expectingHeader = false;
  } else if (--remaining === 0) {
    process.stdout.write('1 0 0 0 0 0.0\n');
    expectingHeader = true;
  }
}
