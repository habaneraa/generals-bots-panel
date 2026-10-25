"""Chrome connections, page selection and browser input for cli/cdp modes."""

import json
import os
from pathlib import Path
import re
import socket
import subprocess
import time

import websocket

from browser_agent.protocol import DIRECTIONS
from browser_agent.diagnostics import diagnostic_stream, logger


BOARD_SCRIPT = Path(__file__).with_name("board.js").read_text()
ACTION_SCRIPT = Path(__file__).with_name('action.js').read_text().replace('BOARD_READER', BOARD_SCRIPT)
STATUS_SCRIPT = BOARD_SCRIPT.replace('})()', '})(true)')
READY_SCRIPT = Path(__file__).with_name('wait.js').read_text().replace('BOARD_STATUS_READER', STATUS_SCRIPT).replace('BOARD_READER', BOARD_SCRIPT)
QUEUE_SCRIPT = Path(__file__).with_name('queue.js').read_text().strip().replace('BOARD_READER', BOARD_SCRIPT)
WAIT_SCRIPT = READY_SCRIPT.replace('WAIT_REQUEST', json.dumps(dict(last_turn=None, identity=None)))
KEY_NAMES = ("UP", "DOWN", "LEFT", "RIGHT")


def discover_endpoint():
    paths = [Path.home() / ".config/google-chrome/DevToolsActivePort"]
    if Path("/mnt/c/Users").is_dir():
        paths.extend(Path("/mnt/c/Users").glob("*/AppData/Local/Google/Chrome/User Data/DevToolsActivePort"))
    existing = [p for p in paths if p.is_file()]
    if len(existing) != 1:
        raise RuntimeError("Specify --ws-endpoint from Chrome's DevToolsActivePort file")
    port, browser_path = existing[0].read_text().splitlines()
    return f"ws://127.0.0.1:{port}{browser_path}"


class Chrome:
    def __init__(self, endpoint):
        try:
            self.socket = websocket.create_connection(endpoint, timeout=60, suppress_origin=True,
                                                      header={"User-Agent": "AverageJoe Browser Bridge"},
                                                      http_no_proxy=["localhost", "127.0.0.1"])
        except websocket.WebSocketTimeoutException:
            raise RuntimeError("Chrome connection timed out; check the debugging permission dialog and endpoint") from None
        self.socket.settimeout(60)
        self.sequence = 0
        self.session = None

    def call(self, method, **params):
        self.sequence += 1
        message = {"id": self.sequence, "method": method, "params": params}
        if self.session:
            message["sessionId"] = self.session
        self.socket.send(json.dumps(message))
        while True:
            reply = json.loads(self.socket.recv())
            if reply.get("id") == self.sequence:
                if "error" in reply:
                    raise RuntimeError(reply["error"]["message"])
                return reply.get("result", {})

    def pages(self):
        return [t for t in self.call("Target.getTargets")["targetInfos"] if t["type"] == "page"]

    def attach(self, target_id):
        self.session = self.call("Target.attachToTarget", targetId=target_id, flatten=True)["sessionId"]

    def evaluate(self, expression):
        reply = self.call("Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in reply:
            details = reply["exceptionDetails"]
            raise RuntimeError(reply["result"].get("description") or
                               details.get("exception", {}).get("description") or str(details))
        return reply["result"].get("value")

    def board(self):
        return self.evaluate(BOARD_SCRIPT)

    def key(self, code):
        if 65 <= code <= 90:
            key, physical = chr(code).lower(), "Key" + chr(code)
        elif code in (32, 37, 38, 39, 40):
            key, physical = {32: (" ", "Space"), 37: ("ArrowLeft", "ArrowLeft"),
                             38: ("ArrowUp", "ArrowUp"), 39: ("ArrowRight", "ArrowRight"),
                             40: ("ArrowDown", "ArrowDown")}[code]
        else:
            raise ValueError(f"Unsupported bound key code: {code}")
        for event in ("rawKeyDown", "keyUp"):
            self.call("Input.dispatchKeyEvent", type=event, key=key, code=physical,
                      windowsVirtualKeyCode=code, nativeVirtualKeyCode=code)

    def click(self, x, y):
        self.call("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y)
        for event, buttons in (("mousePressed", 1), ("mouseReleased", 0)):
            self.call("Input.dispatchMouseEvent", type=event, x=x, y=y, button="left",
                      buttons=buttons, clickCount=1)
            if event == 'mousePressed':
                time.sleep(.1)

    def close(self):
        self.socket.close()


class ChromeCLI:
    """Connect to personal Chrome, reusing an already authorized CLI daemon."""

    def __init__(self, endpoint=None):
        self.page_id = None
        self.fast = None
        if endpoint is None and Path('/mnt/c/Users').is_dir():
            endpoint = discover_endpoint()
        self.endpoint = endpoint
        status = subprocess.run(['chrome-devtools', 'status'], text=True, capture_output=True, timeout=10)
        if 'daemon is running' not in status.stdout or (endpoint and endpoint not in status.stdout):
            arguments = ['--wsEndpoint', endpoint] if endpoint else ['--autoConnect']
            logger.info('Connecting to Chrome; allow its debugging request if prompted…')
            result = subprocess.run(['chrome-devtools', 'start', *arguments],
                                    text=True, capture_output=True, timeout=60)
            if result.returncode:
                raise RuntimeError(result.stderr.strip() or result.stdout.strip())
        runtime = os.environ.get('XDG_RUNTIME_DIR')
        self.socket_path = Path(runtime) / 'chrome-devtools-mcp/server.sock' if runtime else Path(f'/tmp/chrome-devtools-mcp-{os.getuid()}.sock')

    def _tool(self, name, arguments, timeout=60):
        # CLI daemon's local IPC: avoid launching Node for every observation/key.
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(timeout)
            connection.connect(str(self.socket_path))
            connection.sendall(json.dumps(dict(method='invoke_tool', tool=name, args=arguments)).encode() + b'\0')
            chunks = bytearray()
            while b'\0' not in chunks:
                chunk = connection.recv(65536)
                if not chunk:
                    raise RuntimeError('Chrome CLI daemon closed its connection')
                chunks.extend(chunk)
        reply = json.loads(chunks.split(b'\0', 1)[0])
        if not reply.get('success'):
            raise RuntimeError(reply.get('error', 'Chrome CLI request failed'))
        result = json.loads(reply['result'])
        if result.get('isError'):
            raise RuntimeError('\n'.join(c.get('text', '') for c in result['content']))
        return result.get('structuredContent') or {'message': '\n'.join(c.get('text', '') for c in result['content'])}

    def pages(self):
        return [dict(targetId=str(page['id']), pageId=page['id'], title=page['title'], url=page['url'],
                     selected=page.get('selected', False))
                for page in self._tool('list_pages', {})['pages']]

    def attach(self, target_id):
        self.page_id = int(target_id)

    def evaluate(self, expression):
        if self.fast is not None:
            return self.fast.evaluate(expression)
        message = self._tool('evaluate_script', {'function': '() => (' + expression + ')',
                             'pageId': self.page_id, 'waitForStableDom': False})['message']
        match = re.search(r'```json\n([\s\S]*?)\n```', message)
        if not match:
            raise RuntimeError(message)
        return json.loads(match[1])

    def start_game_transport(self):
        # CLI page IDs are not CDP target IDs; match the selected page by its
        # navigation time origin, including when several tabs share a URL.
        time_origin = self.evaluate('performance.timeOrigin')
        fast = NodeChrome(self.endpoint or discover_endpoint())
        try:
            for target in fast.pages():
                if not target['url'].startswith(('https://generals.io/', 'https://bot.generals.io/')):
                    continue
                fast.session = None
                fast.attach(target['targetId'])
                if fast.evaluate('performance.timeOrigin') == time_origin:
                    # Keep render frames and React commits running in background tabs.
                    fast.call('Emulation.setFocusEmulationEnabled', enabled=True)
                    self.fast = fast
                    logger.debug('Game I/O: persistent CDP (no CLI navigation/DOM waits)')
                    logger.debug('Chrome scheduling: game tab kept active while connected')
                    return
                session = fast.session
                fast.session = None
                fast.call('Target.detachFromTarget', sessionId=session)
            raise RuntimeError('Cannot find the selected game tab in Chrome CDP targets')
        except BaseException:
            fast.close()
            raise

    def board(self):
        return self.evaluate(BOARD_SCRIPT)

    def prepare_game(self):
        snapshot = self._tool('take_snapshot', {'pageId': self.page_id})
        dialog = snapshot.get('dialog', {})
        if dialog.get('type') == 'alert' and dialog.get('message', '').startswith('Disconnected from server.'):
            logger.info('Refreshing a disconnected game page…')
            self._tool('handle_dialog', {'pageId': self.page_id, 'action': 'accept'})
            self._tool('navigate_page', {'pageId': self.page_id, 'type': 'reload', 'handleBeforeUnload': 'accept'})

    def apply_action(self, board, action):
        request = dict(action=action, game_id=board['game_id'], turn=board['turn'],
                       observed_at=board.get('observed_at'))
        return self.evaluate(ACTION_SCRIPT.replace('ACTION_REQUEST', json.dumps(request)))

    def key(self, code):
        if 65 <= code <= 90:
            key = chr(code).lower()
        elif 48 <= code <= 57:
            key = chr(code)
        else:
            key = {32: 'Space', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown'}.get(code)
        if key is None:
            raise ValueError(f'Unsupported bound key code: {code}')
        self._tool('press_key', {'pageId': self.page_id, 'key': key})

    def click(self, x, y):
        # generals.io stores the mouse-down coordinates in a React effect.
        # An instantaneous down/up can release before that effect runs.
        self.evaluate(f"""(async () => {{
            const target = document.elementFromPoint({x}, {y});
            const options = {{bubbles: true, cancelable: true, clientX: {x}, clientY: {y}, button: 0}};
            target.dispatchEvent(new MouseEvent('mousemove', {{...options, buttons: 0}}));
            target.dispatchEvent(new MouseEvent('mousedown', {{...options, buttons: 1}}));
            await new Promise(resolve => setTimeout(resolve, 100));
            target.dispatchEvent(new MouseEvent('mouseup', {{...options, buttons: 0}}));
            target.dispatchEvent(new MouseEvent('click', {{...options, buttons: 0}}));
            return true;
        }})()""")

    def close(self):
        # The CLI connection belongs to the user's existing browser session.
        if self.fast is not None:
            self.fast.close()


class NodeChrome(Chrome):
    def __init__(self, endpoint):
        self.session = None
        self.proc = subprocess.Popen(['node', str(Path(__file__).with_name('cdp_client.js')), endpoint],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=diagnostic_stream(), text=True, bufsize=1)

    def call(self, method, **params):
        request = dict(method=method, params=params)
        if self.session:
            request['sessionId'] = self.session
        self.proc.stdin.write(json.dumps(request) + '\n')
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError(f'Chrome CDP helper exited (exit={self.proc.poll()})')
        reply = json.loads(line)
        if 'error' in reply:
            raise RuntimeError(reply['error'])
        return reply['result']

    def close(self):
        self.proc.stdin.close()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.terminate()
            self.proc.wait(timeout=5)
        self.proc.stdout.close()


def select_game_page(chrome, pages, target_id=None):
    candidates = [t for t in pages if t['targetId'] == target_id] if target_id else [
        t for t in pages if t['url'].startswith(('https://generals.io/', 'https://bot.generals.io/'))]
    if len(candidates) > 1:
        playing = []
        for page in candidates:
            chrome.attach(page['targetId'])
            try:
                board = chrome.board()
            except RuntimeError:
                continue  # A replay or spectator tab cannot be controlled.
            if board and not board.get('ended'):
                playing.append(page)
        selected = [t for t in playing if t.get('selected')]
        candidates = selected or playing or [t for t in candidates if t.get('selected')]
    if len(candidates) != 1:
        raise RuntimeError('Open a generals.io game tab, or select one with --page-id / --target-id; see --list-pages')
    chrome.attach(candidates[0]['targetId'])
    logger.info('Connected to game tab %s: %s', candidates[0]['targetId'], candidates[0]['url'])


def move_point(board, action):
    p, row, col, direction, _ = action
    if p == 1:
        return None
    height, width = len(board["types"]), len(board["types"][0])
    if not (0 <= row < height and 0 <= col < width):
        raise ValueError("source is outside the board")
    dr, dc = DIRECTIONS[direction]
    dest_r, dest_c = row + dr, col + dc
    if board.get('rules', {}).get('torus'):
        dest_r %= height
        dest_c %= width
    if not (0 <= dest_r < height and 0 <= dest_c < width):
        raise ValueError("destination is outside the board")
    if board["owners"][row][col] != 1 or board["armies"][row][col] <= 1:
        raise ValueError("source must be owned and have more than one army")
    if board["types"][dest_r][dest_c] in (2, 6, 7):
        raise ValueError("destination is impassable")
    geometry = board["geometry"]
    if geometry.get('positions') is not None:
        point = next((p for p in geometry['positions'] if p[:2] == [row, col]), None)
        if point is None:
            raise ValueError('source is offscreen; center/zoom the map first')
        x, y = point[2:]
    else:
        if abs(geometry["width"] - width * geometry["cell"]) > 2 or abs(geometry["height"] - height * geometry["cell"]) > 2:
            raise ValueError("map geometry does not match the grid")
        x = geometry["x"] + (col + .5) * geometry["cell"]
        y = geometry["y"] + (row + .5) * geometry["cell"]
    if not (0 <= x < board["viewport"]["width"] and 0 <= y < board["viewport"]["height"]):
        raise ValueError("source is offscreen; center/zoom the map first")
    return x, y


def execute_action(chrome, board, action):
    try:
        point = move_point(board, action)
    except ValueError as error:
        if 'offscreen' not in str(error):
            raise
        chrome.key(board['bindings']['CENTER_MAP'])
        board = chrome.board()
        if not board or board.get('ended'):
            raise ValueError('game ended while centering map') from None
        point = move_point(board, action)
    if point is None:
        return
    x, y = point
    if not chrome.evaluate(f"(() => {{document.activeElement?.blur(); return document.querySelector('#gameMap').contains(document.elementFromPoint({x}, {y}));}})()"):
        raise ValueError("source is covered by another UI element")
    chrome.key(board["bindings"]["DESELECT"])
    chrome.click(x, y)
    selected = chrome.board()
    expected = action[1] * len(board["types"][0]) + action[2]
    if not selected or selected.get("ended") or selected["selected"] != expected:
        raise ValueError("mouse click did not select the source cell")
    if selected["game_id"] != board["game_id"] or selected['turn'] < board['turn']:
        raise ValueError("game changed while selecting the source")
    move_point(selected, action)
    if bool(selected["half"]) != bool(action[4]):
        chrome.key(board["bindings"]["50%"])
        selected = chrome.board()
        if not selected or selected.get('ended') or selected['selected'] != expected:
            raise ValueError('source selection changed while setting half-army mode')
        if bool(selected["half"]) != bool(action[4]):
            raise ValueError("half-army toggle failed")
        if selected["game_id"] != board["game_id"] or selected['turn'] < board['turn']:
            raise ValueError("game changed while setting half-army mode")
        move_point(selected, action)
    chrome.key(board["bindings"][KEY_NAMES[action[3]]])


