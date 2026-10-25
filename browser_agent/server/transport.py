"""Direct generals.io game I/O; Chrome is used only to obtain the account."""

import json
from pathlib import Path
import subprocess
import threading
import time
from urllib.parse import urlparse

from browser_agent.browser.transport import ChromeCLI, select_game_page
from browser_agent.server.state import GameState
from browser_agent.protocol import DIRECTIONS
from browser_agent.diagnostics import diagnostic_stream, logger

# Published client v31.4.3 queue argument, not an account credential.
CLIENT_KEY = 'sd09fjdZ03i0ejwi_changeme'

# Server aliases for --game-server; both expose the same Socket.IO protocol.
GAME_SERVERS = {'generals': 'https://ws.generals.io', 'bots': 'https://botws.generals.io'}


def is_bot_server(server):
    """True for bot.generals.io, whose pages and replays live on the bot subdomain."""
    return (urlparse(server or '').hostname or '').startswith('bot')


def replay_url(server, game_id):
    return f"https://{'bot.' if is_bot_server(server) else ''}generals.io/replays/{game_id}"


class SocketGame:
    def __init__(self, server, user_id):
        self.server = server
        self.user_id = user_id
        self.browser = None
        self.restore_browser = False
        self.bot_api = False
        endpoint = server.replace('https://', 'wss://').replace('http://', 'ws://').rstrip('/')
        endpoint += '/socket.io/?EIO=4&transport=websocket'
        self.condition = threading.Condition()
        self.state = GameState()
        self.connected = False
        self.error = None
        self.closed = False
        self.sequence = self.sent = self.attack_index = self.pending_index = 0
        self.replies = {}
        for attempt in range(3):
            self.connected, self.closed, self.error = False, False, None
            self.proc = subprocess.Popen(['node', str(Path(__file__).with_name('client.js')), endpoint],
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                         stderr=diagnostic_stream(), text=True, bufsize=1)
            self.reader = threading.Thread(target=self._read, daemon=True)
            self.reader.start()
            try:
                with self.condition:
                    self._wait(lambda: self.connected, 15, 'connecting to Socket.IO')
                break
            except BaseException as error:
                self.close()
                if attempt == 2 or not isinstance(error, (RuntimeError, TimeoutError, OSError)):
                    raise
                time.sleep(1)

    def _read(self):
        try:
            for line in self.proc.stdout:
                event, *args = json.loads(line)
                with self.condition:
                    if event == '__connected__':
                        self.connected = True
                    elif event == '__sent__':
                        self.sent = args[0]
                    elif event == '__reply__':
                        self.replies[args[0]] = args[1]
                    elif event == 'error_set_username' and (not args or not args[0]):
                        pass
                    elif event in ('__error__', '__closed__', 'gio_error') or event.startswith('error_'):
                        self.error = RuntimeError(f'Game socket: {event}: {args[0] if args else ""}')
                    elif event.startswith('game_'):
                        self.state.update(event, args[0] if args else None)
                    self.condition.notify_all()
        except (ValueError, KeyError, TypeError) as error:
            with self.condition:
                self.error = error
                self.condition.notify_all()
        finally:
            with self.condition:
                if not self.closed and self.error is None:
                    self.error = RuntimeError('Game socket helper exited')
                self.condition.notify_all()

    def _wait(self, predicate, timeout, stage='waiting for game state'):
        deadline = time.monotonic() + timeout
        while not predicate():
            if self.error:
                raise self.error
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f'Timed out {stage}')
            self.condition.wait(remaining)
        if self.error:
            raise self.error

    def _send(self, event, args, ack=False):
        with self.condition:
            self.sequence += 1
            request_id = self.sequence
            self.proc.stdin.write(json.dumps(dict(id=request_id, event=event, args=args, ack=ack)) + '\n')
            self.proc.stdin.flush()
            self._wait(lambda: self.sent >= request_id, 10, f'sending {event}')
            if ack:
                self._wait(lambda: request_id in self.replies, 10, f'waiting for {event} acknowledgment')
                return self.replies.pop(request_id)

    def emit(self, event, *args):
        return self._send(event, args)

    def request(self, event, *args):
        return self._send(event, args, ack=True)

    def board(self):
        with self.condition:
            if self.error:
                raise self.error
            return self.state.board(self.pending_index)

    def wait_for_match(self):
        self.emit('leave_game')
        with self.condition:
            self.state = GameState()
            self.attack_index = self.pending_index = 0
        if self.bot_api:
            self.emit('join_1v1', self.user_id)
        else:
            self.emit('join_1v1', self.user_id, CLIENT_KEY, None, None, True)
        with self.condition:
            self._wait(lambda: self.state.board() is not None, 3600)
            return self.state.board()

    def wait_for_ready(self, last_turn, identity):
        with self.condition:
            def ready():
                board = self.state.board(self.pending_index)
                if not board or board.get('ended'):
                    return board
                current = (board['game_id'], board['player_id'], len(board['types']), len(board['types'][0]))
                return current != identity or board['turn'] < last_turn or \
                    board['turn'] > last_turn and not board['queued_moves']
            self._wait(ready, 40)
            return self.state.board(self.pending_index)

    def apply_action(self, observed, action):
        with self.condition:
            board = self.state.board(self.pending_index)
            if not board or board.get('ended') or board['game_id'] != observed['game_id'] or board['turn'] != observed['turn']:
                return dict(status='stale', after=board)
            if action[0]:
                return dict(status='applied', after=board)
            _, row, col, direction, split = action
            height, width = len(board['types']), len(board['types'][0])
            dr, dc = DIRECTIONS[direction]
            r, c = row + dr, col + dc
            if not (0 <= row < height and 0 <= col < width and 0 <= r < height and 0 <= c < width) or \
                    board['owners'][row][col] != 1 or board['armies'][row][col] <= 1 or \
                    board['types'][r][c] in (2, 6, 7):
                return dict(status='rejected: source or destination changed', after=board)
            self.attack_index = max(self.attack_index, board['attack_index']) + 1
            self.pending_index = self.attack_index
            self.emit('attack', row * width + col, r * width + c, bool(split), self.attack_index)
            return dict(status='sent', after=self.state.board(self.pending_index), submitted_turn=board['turn'],
                        action_age_ms=round((time.monotonic() - observed['observed_at']) * 1000, 1))

    def close(self):
        if self.connected and not self.error and self.proc.poll() is None:
            try:
                self.emit('cancel')
                self.emit('leave_game')
            except (RuntimeError, TimeoutError, OSError):
                pass
        self.closed = True
        if self.proc.poll() is None:
            self.proc.stdin.close()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.terminate()
                self.proc.wait(timeout=5)
        self.reader.join(timeout=1)
        self.proc.stdout.close()
        if self.browser is not None:
            try:
                if self.restore_browser:
                    self.browser._tool('evaluate_script', dict(pageId=self.browser.page_id,
                        function='() => {window.socket.connect(); return true;}', waitForStableDom=False), timeout=2)
            except (RuntimeError, OSError) as error:
                logger.warning('Browser reconnection: %s', error)
            finally:
                self.browser.close()


def open_socket_game(args):
    browser = None
    game = None
    restore = False
    username = None
    try:
        if args.user_id_file:
            user_id = args.user_id_file.read_text().strip()
            server = args.server or GAME_SERVERS[args.game_server or 'generals']
        else:
            browser = ChromeCLI(args.ws_endpoint)
            target = str(args.page_id) if args.page_id else args.target_id
            select_game_page(browser, browser.pages(), target)
            browser.prepare_game()
            board = browser.board()
            if board and not board.get('ended'):
                raise RuntimeError('Finish the current game before starting direct socket transport')
            metadata = browser.evaluate("""({user_id: localStorage.getItem('user_id'), server: window.socket?.io?.uri,
                username: localStorage.getItem('GIO_CACHED_USERNAME')})""")
            user_id = metadata['user_id']
            server = args.server or (GAME_SERVERS[args.game_server] if args.game_server else metadata['server'])
            username = metadata['username'] if server == metadata['server'] else None
            restore = browser.evaluate('(() => {const active = !!window.socket.connected; window.socket.disconnect(); return active;})()')
        if not user_id or not server:
            raise RuntimeError('A generals.io account and server are required')
        game = SocketGame(server, user_id)
        game.browser, game.restore_browser = browser, restore
        game.emit('stars_and_rank', user_id)
        if not username:
            username = game.request('get_username', user_id)[0]
        if not username:
            raise RuntimeError('Choose a generals.io username before starting the bot')
        game.bot_api = username.startswith('[Bot]')
        logger.info('Connected to game server: %s', server)
        logger.debug('Game I/O: direct server WebSocket (Chrome is outside the game loop)')
        return game
    except BaseException:
        if game is not None:
            game.close()
        elif browser is not None:
            try:
                if restore:
                    browser.evaluate('(() => {window.socket.connect(); return true;})()')
            finally:
                browser.close()
        raise
