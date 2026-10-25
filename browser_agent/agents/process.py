"""Persistent stdio agent subprocess, including cross-game handshakes."""

import json
import queue
import subprocess
import threading

from browser_agent.protocol import decode_agent_reply
from browser_agent.diagnostics import diagnostic_stream


class StdioAgent:
    def __init__(self, command, frame, protocol='stdio'):
        self.protocol = protocol
        self.last_value = None
        handshake = frame.handshake(protocol)
        self.proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=diagnostic_stream(), text=True, bufsize=1)
        self.replies = queue.Queue()
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()
        self.proc.stdin.write(handshake)
        self.proc.stdin.flush()

    def _read(self):
        for line in self.proc.stdout:
            self.replies.put(line)
        self.replies.put(None)

    def act(self, frame, timeout):
        self.proc.stdin.write(frame.encode(self.protocol))
        self.proc.stdin.flush()
        try:
            line = self.replies.get(timeout=timeout)
        except queue.Empty:
            raise TimeoutError("agent timed out") from None
        if line is None:
            raise RuntimeError(f"agent closed stdout (exit={self.proc.poll()})")
        action, self.last_value = decode_agent_reply(line)
        return action

    def reset(self, frame):
        self.last_value = None
        handshake = frame.handshake(self.protocol)
        end = json.dumps(dict(event='end')) + '\n' if self.protocol == 'jsonl' else '\n'
        self.proc.stdin.write(end + handshake)
        self.proc.stdin.flush()

    def close(self):
        self.proc.stdin.close()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait()
        self.reader.join(timeout=1)
        self.proc.stdout.close()
