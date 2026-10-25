import io
import random
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from browser_agent.agents.process import StdioAgent
from browser_agent.protocol import frame_from_board
from browser_agent.agents.random_agent import choose_action
from browser_agent.diagnostics import session_log
from browser_agent.tests.fixtures import client_board


class AgentTests(unittest.TestCase):
    def test_agent_diagnostics_go_to_file_without_contaminating_actions(self):
        from contextlib import redirect_stderr
        from tempfile import TemporaryDirectory
        frame = frame_from_board(client_board())
        console = io.StringIO()
        script = """
import sys
sys.stdin.readline()
print('agent diagnostic fixture', file=sys.stderr, flush=True)
for header in sys.stdin:
    for _ in range(6):
        sys.stdin.readline()
    print('1 0 0 0 0', flush=True)
"""
        with TemporaryDirectory() as directory:
            with patch('browser_agent.diagnostics.__file__', str(Path(directory) / 'diagnostics.py')), \
                 redirect_stderr(console), session_log() as path:
                agent = StdioAgent([sys.executable, '-u', '-c', script], frame)
                try:
                    self.assertEqual(agent.act(frame, 3), (1, 0, 0, 0, 0))
                finally:
                    agent.close()
            self.assertIn('agent diagnostic fixture', path.read_text())
            self.assertNotIn('agent diagnostic fixture', console.getvalue())


    def test_stdio_subprocess_handshake_frames_and_clean_eof(self):
        frame = frame_from_board(client_board())
        script = """
import sys
player, h, w = map(int, sys.stdin.readline().split())
assert (player, h, w) == (1, 2, 3)
for header in sys.stdin:
    assert len(header.split()) == 5
    for _ in range(3*h):
        assert len(sys.stdin.readline().split()) == w
    print('0 0 0 3 1', flush=True)
"""
        agent = StdioAgent([sys.executable, '-u', '-c', script], frame)
        try:
            for _ in range(2):
                self.assertEqual(agent.act(frame, 3), (0, 0, 0, 3, 1))
        finally:
            agent.close()
        self.assertEqual(agent.proc.returncode, 0)

    def test_random_agent_only_moves_own_armies_and_passes_without_moves(self):
        frame = frame_from_board(client_board())
        frame.types[1][0] = 2
        for seed in range(30):
            action = choose_action(frame, random.Random(seed))
            self.assertEqual(action[:3], (0, 0, 0))
            self.assertEqual(action[3], 3)  # down is a mountain; up/left are offboard
        frame.armies[0][0] = 1
        self.assertEqual(choose_action(frame, random.Random(0)), (1, 0, 0, 0, 0))

    def test_random_agent_reset_reuses_process_and_restarts_rng_for_both_protocols(self):
        from browser_agent.protocol import Frame
        frame = frame_from_board(client_board())
        frame.types[1][0] = 2
        command = [sys.executable, str(Path(__file__).resolve().parents[1] / 'agents/random_agent.py'), '--seed', '7']
        other = Frame(0, 0, 1, 5, 1, 3, [[4], [1]], [[1], [0]], [[5], [0]])
        for protocol in ('stdio', 'jsonl'):
            with self.subTest(protocol=protocol):
                agent = StdioAgent(command, frame, protocol)
                pid = agent.proc.pid
                try:
                    actions = [agent.act(frame, 3) for _ in range(5)]
                    for action in actions:
                        self.assertEqual(action[:4], (0, 0, 0, 3))
                    agent.reset(other)
                    self.assertEqual(agent.act(other, 3)[:4], (0, 0, 0, 1))
                    agent.reset(frame)
                    self.assertEqual([agent.act(frame, 3) for _ in range(5)], actions)
                    self.assertEqual(agent.proc.pid, pid)
                    self.assertIsNone(agent.proc.poll())
                finally:
                    agent.close()
                self.assertEqual(agent.proc.returncode, 0)


    def test_arbitrary_player_counts_and_teams_with_random_subprocess(self):
        command = [sys.executable, str(Path(__file__).resolve().parents[2] / 'browser_agent/agents/random_agent.py')]
        for teams, mode in [(list(range(16)), 'FFA'), ([0, 0, 0, 1, 1, 1], '3v3')]:
            with self.subTest(mode=mode):
                scores = [dict(i=i, tiles=i+1, total=10*(i+1)) for i in reversed(range(len(teams)))]
                board = client_board(usernames=[str(i) for i in range(len(teams))], teams=teams, scores=scores)
                self.assertEqual(board['mode'], mode)
                self.assertEqual(len(board['players']), len(teams))
                frame = frame_from_board(board)
                agent = StdioAgent(command, frame, 'jsonl')
                try:
                    self.assertEqual(agent.act(frame, 3)[:3], (0, 0, 0))
                finally:
                    agent.close()
                self.assertEqual(agent.proc.returncode, 0)


