"""Shared player-view and local WebSocket fixtures; no external services."""

import json
import socketserver
import struct
import subprocess

from browser_agent.browser.transport import BOARD_SCRIPT, STATUS_SCRIPT


def client_board(status_only=False, **changes):
    game = dict(
        map=dict(height=2, width=3, _map=[1, 0, -3, -4, -2, -1],
                 _armies=[10, 3, 99, 88, 0, 40], modFlags=[]),
        playerIndex=1, usernames=['opponent', 'me'], teams=[0, 1],
        scores=[dict(i=0, tiles=7, total=20), dict(i=1, tiles=1, total=10)],
        turn=51, generals=[1, 0], cities=[2, 3, 5], options=dict(modifiers=[]),
        replay_id='fixture',
    )
    game.update(changes)
    # A recorded-shaped client view with stored structures underneath fog.
    fixture = """
const game = JSON.parse(process.argv[1]);
const store = {getState: () => ({game})};
const root = {
    __reactInternalInstanceFixture: {memoizedProps: {props: {map: game.map}, cellSize: 32,
        selectedIndex: 0, selectedIs50: false}, return: {memoizedProps: {store}}},
    getBoundingClientRect: () => ({x:100,y:50,width:96,height:64}),
};
global.document = {querySelector: () => root};
global.localStorage = {getItem: () => null};
global.innerWidth = 800; global.innerHeight = 600;
"""
    script = STATUS_SCRIPT if status_only else BOARD_SCRIPT
    result = subprocess.run(['node', '-e', fixture + '\nconsole.log(JSON.stringify(' + script + '));',
                             json.dumps(game)], text=True, capture_output=True)
    if result.returncode:
        raise ValueError(result.stderr)
    return json.loads(result.stdout)



class WebSocketHandler(socketserver.BaseRequestHandler):
    def read_exact(self, size):
        data = bytearray()
        while len(data) < size:
            chunk = self.request.recv(size - len(data))
            if not chunk:
                raise EOFError
            data.extend(chunk)
        return bytes(data)

    def send_frame(self, payload, opcode=1):
        length = len(payload)
        header = bytes([0x80 | opcode, length]) if length < 126 else bytes([0x80 | opcode, 126]) + struct.pack('!H', length)
        self.request.sendall(header + payload)
