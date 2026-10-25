import io
import unittest

from browser_agent.protocol import frame_from_board, read_frame
from browser_agent.tests.fixtures import client_board


class ProtocolTests(unittest.TestCase):
    def test_protocol_roundtrip_and_eof(self):
        original = frame_from_board(client_board())
        self.assertEqual(original.handshake(), '1 2 3\n')
        stream = io.StringIO(original.encode())
        self.assertEqual(read_frame(stream, 1, 2, 3).encode(), original.encode())
        self.assertIsNone(read_frame(stream, 1, 2, 3))
        with self.assertRaises(ValueError):
            read_frame(io.StringIO('0 1 2 3 4\n1\n'), 1, 2, 3)

    def test_jsonl_rejects_wrong_player_or_grid_shape(self):
        frame = frame_from_board(client_board())
        with self.assertRaisesRegex(ValueError, 'handshake'):
            read_frame(io.StringIO(frame.encode('jsonl')), 0, 2, 3, 'jsonl')
        frame.armies[0].pop()
        with self.assertRaisesRegex(ValueError, 'handshake'):
            read_frame(io.StringIO(frame.encode('jsonl')), 1, 2, 3, 'jsonl')

