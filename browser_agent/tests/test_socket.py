"""Game diffs and real Socket.IO wire I/O, without a Chrome page."""

import base64
import hashlib
import json
import socketserver
import struct
import threading
import time
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch

from browser_agent.bridge import main
from browser_agent.server.state import GameState, patch_array
from browser_agent.server.transport import (
    GAME_SERVERS, SocketGame, is_bot_server, open_socket_game, replay_url,
)
from browser_agent.tests.fixtures import WebSocketHandler


START = dict(playerIndex=1, usernames=['enemy', 'me'], teams=[0, 1], replay_id='socket-fixture',
             game_type='1v1', options=dict(modifiers=[]))
MAP = [3, 2, 10, 3, 99, 88, 0, 40, 1, 0, -3, -4, -2, -1] + [0] * 6
UPDATE = dict(turn=1, scores=[dict(i=0, tiles=7, total=20), dict(i=1, tiles=1, total=10)],
              map_diff=[0, len(MAP), *MAP], cities_diff=[0, 3, 2, 3, 5],
              generals=[1, 0], attackIndex=0)


class SocketHandler(WebSocketHandler):
    def handle(self):
        header = bytearray()
        while not header.endswith(b'\r\n\r\n'):
            header.extend(self.read_exact(1))
        self.server.connections += 1
        if self.server.connections <= self.server.reject_first:
            self.request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n')
            return
        key = next(line.split(':', 1)[1].strip() for line in header.decode().splitlines()
                   if line.lower().startswith('sec-websocket-key:'))
        accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
        self.request.sendall(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + b'\r\n\r\n')
        self.send_frame(b'0{"pingInterval":1000,"pingTimeout":1000}')
        try:
            while True:
                first, second = self.read_exact(2)
                opcode, size = first & 15, second & 127
                if size == 126:
                    size = struct.unpack('!H', self.read_exact(2))[0]
                mask = self.read_exact(4) if second & 128 else None
                payload = self.read_exact(size)
                if mask:
                    payload = bytes(value ^ mask[i % 4] for i, value in enumerate(payload))
                if opcode == 8:
                    self.send_frame(payload, 8)
                    return
                packet = payload.decode()
                if packet == '40':
                    self.send_frame(b'40{"sid":"fixture"}')
                elif packet == '3':
                    self.server.ponged.set()
                elif packet.startswith('42'):
                    body = packet[2:]
                    ack, _, array = body.partition('[')
                    event, *args = json.loads('[' + array)
                    self.server.events.append((event, args))
                    if event == 'get_username':
                        self.send_frame(('43' + ack + '["me"]').encode())
                    elif event == 'join_1v1':
                        self.send_event('game_start', START)
                        self.send_event('game_update', UPDATE)
                        # Heartbeat must be answered while Python is computing.
                        self.send_frame(b'2')
                    elif event == 'attack':
                        time.sleep(.05)
                        self.send_event('game_update', dict(UPDATE, turn=2, attackIndex=0))
                        time.sleep(.05)
                        self.send_event('game_update', dict(UPDATE, turn=3, attackIndex=args[3]))
                    elif event == 'fixture_end':
                        self.send_event('game_lost', {})
                        self.send_event('game_over', {})
                    elif event == 'fixture_disconnect':
                        return
        except (EOFError, ConnectionError):
            pass

    def send_event(self, event, data):
        self.send_frame(('42' + json.dumps([event, data])).encode())


class SocketTransportTests(unittest.TestCase):
    def test_failed_handshakes_are_retried(self):
        server = socketserver.ThreadingTCPServer(('127.0.0.1', 0), SocketHandler)
        server.daemon_threads = True
        server.connections, server.reject_first = 0, 2
        server.events, server.ponged = [], threading.Event()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        game = None
        try:
            game = SocketGame(f'http://127.0.0.1:{server.server_address[1]}', 'fixture-account')
            self.assertEqual(server.connections, 3)
            self.assertEqual(game.request('get_username', 'fixture-account'), ['me'])
        finally:
            if game:
                game.close()
            server.shutdown()
            server.server_close()
            thread.join()

    def test_default_entry_requeues_without_browser_calls(self):
        state = GameState()
        state.update('game_over', {})
        self.assertIsNone(state.board())
        state.update('game_start', START)
        state.update('game_update', UPDATE)
        board = state.board()
        game = Mock(spec=SocketGame)
        game.wait_for_match.side_effect = [board, dict(board, game_id='next-game'), KeyboardInterrupt]
        game.apply_action.side_effect = [dict(status='sent', after=dict(ended=True, won=True)),
                                         dict(status='sent', after=dict(ended=True, lost=True))]
        agent = Mock()
        agent.last_value = None
        agent.act.return_value = (0, 0, 0, 3, 0)
        with patch.object(sys, 'argv', ['bridge', '--autopilot']), \
             patch('browser_agent.bridge.open_socket_game', return_value=game), \
             patch('browser_agent.bridge.ChromeCLI') as chrome, \
             patch('browser_agent.bridge.StdioAgent', return_value=agent) as spawn, \
             patch.object(sys.stdin, 'isatty', return_value=False), \
             patch('browser_agent.bridge.threading.Event.wait', return_value=False) as wait, \
             self.assertRaises(KeyboardInterrupt):
            main()
        chrome.assert_not_called()
        spawn.assert_called_once()
        agent.reset.assert_called_once()
        self.assertEqual(game.wait_for_match.call_count, 3)
        self.assertEqual([call.args for call in wait.call_args_list], [(15,), (15,)])
        game.close.assert_called_once()

    def test_diff_and_player_view_match_renderer(self):
        state = GameState()
        state.update('game_start', START)
        self.assertIsNone(state.board())
        state.update('game_update', UPDATE)
        board = state.board()
        self.assertEqual(board['types'], [[4, 4, 0], [5, 2, 3]])
        self.assertEqual(board['owners'], [[1, 2, 0], [0, 0, 0]])
        self.assertEqual(board['armies'], [[10, 3, 0], [0, 0, 40]])
        # Updating only the diff cannot expose hidden armies or discard cities.
        state.update('game_update', dict(turn=2, map_diff=[2, 1, 12, len(MAP) - 3]))
        self.assertEqual(state.board()['armies'][0][0], 12)
        self.assertEqual(state.board()['types'][1][2], 3)
        self.assertEqual(patch_array([1, 2, 3], [1, 2, 7, 8]), [1, 7, 8])
        state.update('game_lost', {})
        state.update('game_over', {})
        self.assertTrue(state.board()['lost'])
        self.assertEqual(state.board()['turn'], 1)
        state.update('game_start', START)
        self.assertIsNone(state.board())

    def test_native_wire_heartbeat_ack_and_disconnect(self):
        server = socketserver.ThreadingTCPServer(('127.0.0.1', 0), SocketHandler)
        server.daemon_threads = True
        server.connections, server.reject_first = 0, 0
        server.events = []
        server.ponged = threading.Event()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        game = None
        try:
            game = SocketGame(f'http://127.0.0.1:{server.server_address[1]}', 'fixture-account')
            self.assertEqual(game.request('get_username', 'fixture-account'), ['me'])
            board = game.wait_for_match()
            self.assertTrue(server.ponged.wait(1))
            result = game.apply_action(board, (0, 0, 0, 3, 1))
            self.assertEqual(result['status'], 'sent')
            self.assertEqual(result['after']['queued_moves'], 1)
            identity = ('socket-fixture', 1, 2, 3)
            next_board = game.wait_for_ready(0, identity)
            self.assertIn(('attack', [0, 1, True, 1]), server.events)
            self.assertEqual((next_board['turn'], next_board['attack_index'], next_board['queued_moves']), (2, 1, 0))
            game.emit('fixture_end')
            ended = game.wait_for_ready(2, identity)
            self.assertTrue(ended['lost'])
            self.assertEqual(ended['turn'], 2)
            game.emit('fixture_disconnect')
            with self.assertRaisesRegex(RuntimeError, '__closed__|__error__'):
                with game.condition:
                    game._wait(lambda: game.error is not None, 3)
        finally:
            if game:
                game.close()
                self.assertIsNotNone(game.proc.poll())
            server.shutdown()
            server.server_close()
            thread.join()


class GameServerTests(unittest.TestCase):
    def test_named_servers_and_bot_replay_host(self):
        self.assertEqual(GAME_SERVERS, {'generals': 'https://ws.generals.io',
                                        'bots': 'https://botws.generals.io'})
        self.assertTrue(is_bot_server('https://botws.generals.io'))
        self.assertTrue(is_bot_server('https://bot.generals.io/play'))
        self.assertFalse(is_bot_server('https://ws.generals.io'))
        self.assertFalse(is_bot_server(''))
        self.assertEqual(replay_url('https://botws.generals.io', 'abc'),
                         'https://bot.generals.io/replays/abc')
        self.assertEqual(replay_url('https://ws.generals.io', 'abc'),
                         'https://generals.io/replays/abc')

    def test_account_file_connects_to_the_named_server(self):
        with TemporaryDirectory() as directory:
            account = Path(directory) / '.user-id'
            account.write_text('fixture-account\n')
            for game_server, expected in ((None, 'https://ws.generals.io'),
                                          ('generals', 'https://ws.generals.io'),
                                          ('bots', 'https://botws.generals.io')):
                with self.subTest(game_server=game_server), \
                     patch('browser_agent.server.transport.SocketGame') as socket:
                    socket.return_value.request.return_value = ['[Bot] fixture']
                    game = open_socket_game(SimpleNamespace(
                        user_id_file=account, server=None, game_server=game_server))
                self.assertEqual(socket.call_args.args[0], expected)
                self.assertTrue(game.bot_api)

    def test_explicit_server_url_is_used_verbatim(self):
        with TemporaryDirectory() as directory:
            account = Path(directory) / '.user-id'
            account.write_text('fixture-account\n')
            with patch('browser_agent.server.transport.SocketGame') as socket:
                socket.return_value.request.return_value = ['fixture']
                open_socket_game(SimpleNamespace(user_id_file=account,
                                                 server='https://custom.example', game_server=None))
            self.assertEqual(socket.call_args.args[0], 'https://custom.example')
