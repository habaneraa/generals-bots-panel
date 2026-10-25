"""Exercise the persistent transport against a local CDP WebSocket fixture."""

import base64
import hashlib
import json
import socketserver
import struct
import threading
import unittest
from unittest.mock import Mock

from browser_agent.browser.transport import ChromeCLI, NodeChrome
from browser_agent.tests.fixtures import WebSocketHandler


class CDPHandler(WebSocketHandler):
    def handle(self):
        header = bytearray()
        while not header.endswith(b'\r\n\r\n'):
            header.extend(self.read_exact(1))
        key = next(line.split(':', 1)[1].strip() for line in header.decode().splitlines()
                   if line.lower().startswith('sec-websocket-key:'))
        accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
        self.request.sendall(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + b'\r\n\r\n')
        self.server.connections += 1
        try:
            while True:
                first, second = self.read_exact(2)
                opcode, size = first & 15, second & 127
                if size == 126:
                    size = struct.unpack('!H', self.read_exact(2))[0]
                elif size == 127:
                    size = struct.unpack('!Q', self.read_exact(8))[0]
                mask = self.read_exact(4) if second & 128 else None
                payload = self.read_exact(size)
                if mask:
                    payload = bytes(value ^ mask[i % 4] for i, value in enumerate(payload))
                if opcode == 8:
                    self.send_frame(payload, 8)
                    return
                if opcode == 9:
                    self.send_frame(payload, 10)
                    continue
                request = json.loads(payload)
                self.server.calls.append(request)
                method = request['method']
                if method == 'Target.getTargets':
                    result = {'targetInfos': [dict(type='page', targetId=str(i), url='https://generals.io/') for i in (1, 2)]}
                elif method == 'Target.attachToTarget':
                    result = {'sessionId': 'session-' + request['params']['targetId']}
                elif method == 'Target.detachFromTarget':
                    result = {}
                elif method == 'Emulation.setFocusEmulationEnabled':
                    result = {}
                elif method == 'Runtime.evaluate':
                    if request['params']['expression'] == 'performance.timeOrigin':
                        value = 11 if request['sessionId'] == 'session-1' else 22
                        result = {'result': {'value': value}}
                    elif request['params']['expression'] == 'throw Error()':
                        result = {'result': {'description': 'fixture script error'}, 'exceptionDetails': {}}
                    elif request['params']['expression'] == 'Promise.reject(Error())':
                        result = {'result': {'type': 'undefined'},
                                  'exceptionDetails': {'text': 'Uncaught (in promise)',
                                                       'exception': {'description': 'Error: fixture queue timeout'}}}
                    else:
                        result = {'result': {'value': 42}}
                elif method == 'Fixture.disconnect':
                    return
                else:
                    self.send_frame(json.dumps({'id': request['id'], 'error': {'message': 'fixture CDP error'}}).encode())
                    continue
                # Events must not be mistaken for the response to an evaluation.
                self.send_frame(json.dumps({'method': 'Runtime.consoleAPICalled', 'params': {}}).encode())
                self.send_frame(json.dumps({'id': request['id'], 'result': result}).encode())
        except EOFError:
            pass


class PersistentCDPTests(unittest.TestCase):
    def setUp(self):
        self.server = socketserver.ThreadingTCPServer(('127.0.0.1', 0), CDPHandler)
        self.server.daemon_threads = True
        self.server.connections = 0
        self.server.calls = []
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.endpoint = f'ws://127.0.0.1:{self.server.server_address[1]}/browser/fixture'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_connection_is_reused_and_errors_are_reported(self):
        chrome = NodeChrome(self.endpoint)
        try:
            self.assertEqual(len(chrome.pages()), 2)
            chrome.attach('2')
            for _ in range(3):
                self.assertEqual(chrome.evaluate('21 * 2'), 42)
            with self.assertRaisesRegex(RuntimeError, 'fixture CDP error'):
                chrome.call('Fixture.error')
            with self.assertRaisesRegex(RuntimeError, 'fixture script error'):
                chrome.evaluate('throw Error()')
            with self.assertRaisesRegex(RuntimeError, '^Error: fixture queue timeout$'):
                chrome.evaluate('Promise.reject(Error())')
        finally:
            chrome.close()
        self.assertEqual(self.server.connections, 1)
        self.assertEqual(chrome.proc.returncode, 0)
        evaluations = [call for call in self.server.calls if call['method'] == 'Runtime.evaluate']
        self.assertTrue(all(call['sessionId'] == 'session-2' for call in evaluations))
        self.assertTrue(all(call['params']['awaitPromise'] for call in evaluations))

    def test_game_calls_bypass_cli_and_select_exact_tab_among_duplicate_urls(self):
        chrome = object.__new__(ChromeCLI)
        chrome.page_id, chrome.fast, chrome.endpoint = 7, None, self.endpoint
        chrome._tool = Mock(return_value={'message': '```json\n22\n```'})
        try:
            chrome.start_game_transport()
            self.assertEqual(chrome.fast.session, 'session-2')
            self.assertEqual(chrome.evaluate('21 * 2'), 42)
            self.assertEqual(chrome._tool.call_count, 1)
        finally:
            chrome.close()
        self.assertTrue(any(call['method'] == 'Target.detachFromTarget' for call in self.server.calls))
        focus_calls = [call for call in self.server.calls if call['method'] == 'Emulation.setFocusEmulationEnabled']
        self.assertEqual(len(focus_calls), 1)
        self.assertEqual((focus_calls[0]['sessionId'], focus_calls[0]['params']),
                         ('session-2', dict(enabled=True)))

    def test_disconnect_unblocks_pending_request(self):
        chrome = NodeChrome(self.endpoint)
        try:
            with self.assertRaisesRegex(RuntimeError, 'connection closed'):
                chrome.call('Fixture.disconnect')
        finally:
            chrome.close()
