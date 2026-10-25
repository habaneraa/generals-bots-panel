from contextlib import redirect_stderr
import io
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from browser_agent.bridge import main, match_players, wait_for_1v1
from browser_agent.browser.transport import READY_SCRIPT
from browser_agent.protocol import frame_from_board
from browser_agent.tests.fixtures import client_board


class BridgeLoopTests(unittest.TestCase):
    def test_console_keeps_core_messages_and_file_keeps_turn_details(self):
        board = client_board()
        chrome, agent = Mock(), Mock()
        chrome.pages.return_value = [dict(targetId='2', url='https://generals.io/')]
        chrome.apply_action.return_value = dict(status='applied', after=dict(ended=True, won=True, turn=72))
        agent.last_value = None
        agent.act.return_value = (1, 0, 0, 0, 0)
        console = io.StringIO()
        with TemporaryDirectory() as directory:
            observation_log = Path(directory) / 'observations.jsonl'
            with patch('browser_agent.diagnostics.__file__', str(Path(directory) / 'diagnostics.py')), \
                 patch.object(sys, 'argv', ['bridge', '--transport', 'cli', '--record-jsonl', str(observation_log)]), \
                 patch('browser_agent.bridge.ChromeCLI', return_value=chrome), \
                 patch('browser_agent.bridge.wait_for_1v1', return_value=board), \
                 patch('browser_agent.bridge.StdioAgent', return_value=agent), redirect_stderr(console):
                main()
            details = next((Path(directory) / 'logs').glob('*.log')).read_text()
            self.assertIn('Detailed log:', console.getvalue())
            self.assertIn('Taking over 1v1 game fixture', console.getvalue())
            self.assertIn('Game won', console.getvalue())
            summary = 'Game won; steps=73 replay=https://generals.io/replays/fixture; total win=1 lost=0 draw=0'
            self.assertIn(summary, console.getvalue())
            self.assertIn(summary, details)
            self.assertNotIn('action=', console.getvalue())
            self.assertNotIn('agent=', console.getvalue())
            self.assertIn('turn=50 action=(1, 0, 0, 0, 0)', details)
            self.assertIn('agent=', details)
            record = json.loads(observation_log.read_text())
            self.assertEqual(record['board'], board)
            self.assertEqual(record['action'], [1, 0, 0, 0, 0])

    def test_agent_cleanup_error_still_closes_transport_and_logs_traceback_only_to_file(self):
        from browser_agent.diagnostics import logger
        board = client_board()
        chrome, agent = Mock(), Mock()
        chrome.pages.return_value = [dict(targetId='2', url='https://generals.io/')]
        chrome.apply_action.return_value = dict(status='applied', after=dict(ended=True, won=True))
        agent.last_value = None
        agent.act.return_value = (1, 0, 0, 0, 0)
        agent.close.side_effect = BrokenPipeError('agent pipe closed')
        console = io.StringIO()
        previous_handlers = list(logger.handlers)
        with TemporaryDirectory() as directory:
            with patch('browser_agent.diagnostics.__file__', str(Path(directory) / 'diagnostics.py')), \
                 patch.object(sys, 'argv', ['bridge', '--transport', 'cli']), \
                 patch('browser_agent.bridge.ChromeCLI', return_value=chrome), \
                 patch('browser_agent.bridge.wait_for_1v1', return_value=board), \
                 patch('browser_agent.bridge.StdioAgent', return_value=agent), redirect_stderr(console), \
                 self.assertRaises(BrokenPipeError):
                main()
            details = next((Path(directory) / 'logs').glob('*.log')).read_text()
            chrome.close.assert_called_once()
            self.assertIn('BrokenPipeError: agent pipe closed', details)
            self.assertNotIn('Traceback', console.getvalue())
            self.assertEqual(logger.handlers, previous_handlers)

    def test_recording_open_failure_closes_game_transport(self):
        game = Mock()
        with TemporaryDirectory() as directory:
            log = str(Path(directory) / 'missing-parent' / 'game.jsonl')
            with patch.object(sys, 'argv', ['bridge', '--record-jsonl', log]), \
                 patch('browser_agent.bridge.open_socket_game', return_value=game), \
                 self.assertRaises(FileNotFoundError):
                main()
        game.close.assert_called_once()
        game.wait_for_match.assert_not_called()

    def test_loop_waits_for_queued_move_before_model_observation(self):
        board = client_board()
        chrome, agent = Mock(), Mock()
        chrome.pages.return_value = [dict(targetId='2', url='https://generals.io/')]
        chrome.evaluate.return_value = dict(board, turn=51, queued_moves=0)
        chrome.apply_action.return_value = dict(status='applied', after=dict(ended=True, won=True))
        agent.last_value = None
        agent.act.return_value = (1, 0, 0, 0, 0)
        with patch.object(sys, 'argv', ['bridge', '--transport', 'cli']), \
             patch('browser_agent.bridge.ChromeCLI', return_value=chrome), \
             patch('browser_agent.bridge.wait_for_1v1', return_value=dict(board, queued_moves=1)), \
             patch('browser_agent.bridge.StdioAgent', return_value=agent), \
             patch('browser_agent.bridge.threading.Event.wait', return_value=False) as wait:
            main()
        wait.assert_not_called()
        self.assertEqual(chrome.evaluate.call_count, 1)
        agent.act.assert_called_once()
        self.assertEqual(agent.act.call_args.args[0].turn, 51)

    def test_custom_agent_command_is_forwarded_without_interpreting_its_arguments(self):
        board = client_board()
        commands = [
            ['bash', '/external/agent/run.sh'],
            ['runner', 'relative agent.py', '--config', 'relative.yaml', '--protocol', 'custom', 'two words'],
        ]
        for command in commands:
            with self.subTest(command=command):
                chrome, agent = Mock(), Mock()
                chrome.pages.return_value = [dict(targetId='2', url='https://generals.io/')]
                chrome.apply_action.return_value = dict(status='applied', after=dict(ended=True, won=True))
                agent.last_value = None
                agent.act.return_value = (1, 0, 0, 0, 0)
                with patch.object(sys, 'argv', ['bridge', '--transport', 'cli', '--agent', *command]), \
                     patch('browser_agent.bridge.ChromeCLI', return_value=chrome), \
                     patch('browser_agent.bridge.wait_for_1v1', return_value=board), \
                     patch('browser_agent.bridge.StdioAgent', return_value=agent) as spawn:
                    main()
                self.assertEqual(spawn.call_args.args[0], command)
                agent.close.assert_called_once()

    def test_custom_agent_requires_a_command(self):
        with patch.object(sys, 'argv', ['bridge', '--agent']), \
             redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            main()
        self.assertEqual(error.exception.code, 2)

    def test_loop_continuously_calls_same_agent_for_latest_frames(self):
        board = client_board()
        chrome, agent = Mock(), Mock()
        chrome.pages.return_value = [dict(targetId='2', url='https://generals.io/')]
        chrome.board.return_value = board
        chrome.apply_action.side_effect = [dict(status='applied', after=dict(board, turn=51+i)) for i in range(4)] + \
            [dict(status='applied', after=dict(ended=True, won=True))]
        agent.last_value = None
        agent.act.return_value = (0, 0, 0, 3, 0)
        with patch.object(sys, 'argv', ['bridge', '--transport', 'cli']), \
             patch('browser_agent.bridge.ChromeCLI', return_value=chrome), \
             patch('browser_agent.bridge.wait_for_1v1', return_value=board), \
             patch('browser_agent.bridge.StdioAgent', return_value=agent) as spawn:
            main()
        spawn.assert_called_once()
        self.assertEqual([call.args[0].turn for call in agent.act.call_args_list], [50, 51, 52, 53, 54])
        self.assertEqual(chrome.apply_action.call_count, 5)
        agent.close.assert_called_once()

    def test_loop_waits_on_duplicate_turn_then_uses_latest_observation(self):
        board = client_board()
        chrome, agent = Mock(), Mock()
        chrome.pages.return_value = [dict(targetId='2', url='https://generals.io/')]
        chrome.apply_action.side_effect = [dict(status='applied', after=board),
                                          dict(status='applied', after=dict(ended=True, won=True))]
        chrome.evaluate.return_value = dict(board, turn=55)
        agent.last_value = None
        agent.act.return_value = (1, 0, 0, 0, 0)
        with patch.object(sys, 'argv', ['bridge', '--transport', 'cli']), \
             patch('browser_agent.bridge.ChromeCLI', return_value=chrome), \
             patch('browser_agent.bridge.wait_for_1v1', return_value=board), \
             patch('browser_agent.bridge.StdioAgent', return_value=agent), \
             patch('browser_agent.bridge.threading.Event.wait', return_value=False) as wait:
            main()
        self.assertEqual([call.args[0].turn for call in agent.act.call_args_list], [50, 55])
        self.assertEqual(chrome.evaluate.call_count, 1)
        wait.assert_not_called()

    def test_one_match_exits_on_win_or_loss_and_closes_agent(self):
        board = client_board()
        for outcome in ('won', 'lost'):
            with self.subTest(outcome=outcome):
                chrome = Mock()
                chrome.pages.return_value = [dict(targetId='2', url='https://generals.io/')]
                chrome.board.side_effect = [board, dict(ended=True, **{outcome: True})]
                agent = Mock()
                agent.last_value = None
                agent.act.return_value = (1, 0, 0, 0, 0)
                with patch.object(sys, 'argv', ['bridge', '--transport', 'cli', '--dry-run']), \
                     patch('browser_agent.bridge.ChromeCLI', return_value=chrome), \
                     patch('browser_agent.bridge.wait_for_1v1', return_value=board), \
                     patch('browser_agent.bridge.StdioAgent', return_value=agent) as spawn:
                    main()
                spawn.assert_called_once()
                self.assertEqual(Path(spawn.call_args.args[0][1]).name, 'random_agent.py')
                agent.close.assert_called_once()
                chrome.close.assert_called_once()

    def test_autopilot_requeues_after_win_and_loss_and_resets_same_agent(self):
        board = client_board()
        boards = [board, dict(board, game_id='next', turn=0),
                  dict(board, game_id='third', turn=0), dict(board, game_id='fourth', turn=0)]
        chrome = Mock()
        chrome.pages.return_value = [dict(targetId='2', url='https://generals.io/')]
        chrome.apply_action.side_effect = [dict(status='applied', after=dict(ended=True, won=True)),
                                          dict(status='applied', after=dict(ended=True, lost=True)),
                                          dict(status='applied', after=dict(ended=True)),
                                          KeyboardInterrupt]
        agent = Mock()
        agent.last_value = None
        agent.act.return_value = (1, 0, 0, 0, 0)

        def queue_match(chrome):
            index = queue_match.calls
            agent.close.assert_not_called()
            self.assertEqual(wait.call_count, index)
            queue_match.calls += 1
            return boards[index]

        queue_match.calls = 0
        with patch.object(sys, 'argv', ['bridge', '--transport', 'cli', '--autopilot']), \
             patch.object(sys.stdin, 'isatty', return_value=False), \
             patch('browser_agent.bridge.ChromeCLI', return_value=chrome), \
             patch('browser_agent.bridge.wait_for_1v1', side_effect=queue_match) as matchmaking, \
             patch('browser_agent.bridge.StdioAgent', return_value=agent) as spawn, \
             patch('browser_agent.bridge.threading.Event.wait', return_value=False) as wait, \
             self.assertLogs('browser_agent', level='INFO') as output, \
             self.assertRaises(KeyboardInterrupt):
            main()
        summaries = [record.getMessage() for record in output.records if record.getMessage().startswith('Game ')]
        self.assertEqual(summaries, [
            'Game won; steps=51 replay=https://generals.io/replays/fixture; total win=1 lost=0 draw=0',
            'Game lost; steps=1 replay=https://generals.io/replays/next; total win=1 lost=1 draw=0',
            'Game draw; steps=1 replay=https://generals.io/replays/third; total win=1 lost=1 draw=1',
        ])
        self.assertEqual(matchmaking.call_count, 4)
        self.assertEqual([call.args for call in wait.call_args_list], [(15,), (15,), (15,)])
        pauses = [record.getMessage() for record in output.records if record.getMessage().startswith('queueing ')]
        self.assertEqual(pauses, ['queueing another match in 15 seconds.'] * 3)
        spawn.assert_called_once()
        self.assertEqual(chrome.apply_action.call_count, 4)
        self.assertEqual([call.args[0].turn for call in agent.act.call_args_list], [50, 0, 0, 0])
        self.assertEqual([call.args[0] for call in agent.reset.call_args_list],
                         [frame_from_board(board) for board in boards[1:]])
        agent.close.assert_called_once()
        chrome.evaluate.assert_not_called()
        chrome.close.assert_called_once()

    def test_match_wait_keeps_listening_until_generals_and_scores_arrive(self):
        fixture = """
const game = {map: {height: 1, width: 2, _map: [1, 0], _armies: [10, 5]},
    playerIndex: 1, usernames: ['opponent', 'me'], turn: 1, cities: [],
    scores: [{i: 0, tiles: 1, total: 5}]};
let notify, observer, unsubscribed = 0, disconnected = 0, cancelled = 0, cleared = 0;
const store = {getState: () => ({game}), subscribe(callback) {
    notify = callback; return () => {unsubscribed++;};
}};
const root = {__reactInternalInstanceFixture: {memoizedProps: {
    props: {map: game.map}, cellSize: 32}, return: {memoizedProps: {store}}},
    getBoundingClientRect: () => ({x: 0, y: 0, width: 64, height: 32})};
global.document = {documentElement: {}, querySelector: () => root};
global.localStorage = {getItem: () => null};
global.innerWidth = 800; global.innerHeight = 600;
global.MutationObserver = class {
    constructor(callback) {observer = this; this.callback = callback;}
    observe() {} disconnect() {disconnected++;}
};
global.requestAnimationFrame = () => 1;
global.cancelAnimationFrame = () => {cancelled++;};
global.setTimeout = () => 1;
global.clearTimeout = () => {cleared++;};
"""
        for last_turn in (None, -1):
            with self.subTest(last_turn=last_turn):
                request = dict(last_turn=last_turn, identity=[None, 1, 1, 2])
                wait = READY_SCRIPT.replace('WAIT_REQUEST', json.dumps(request))
                script = fixture + '\nconst waiting = ' + wait + """;
if (disconnected) throw Error('finished before generals arrived');
game.generals = [1, 0]; notify();
if (disconnected) throw Error('finished before player scores arrived');
game.scores.push({i: 1, tiles: 1, total: 10}); observer.callback();
waiting.then(board => console.log(JSON.stringify({board, unsubscribed, disconnected, cancelled, cleared})));
"""
                result = subprocess.run(['node', '-e', script], capture_output=True, text=True, check=True)
                payload = json.loads(result.stdout)
                self.assertEqual(payload['board']['types'], [[4, 4]])
                self.assertEqual(payload['board']['my_army'], 10)
                self.assertEqual((payload['unsubscribed'], payload['disconnected'],
                                  payload['cancelled'], payload['cleared']), (1, 1, 1, 1))

    def test_match_wait_rejects_tutorial_and_other_queues(self):
        for mode, game_type in [('1v1', 'tutorial'), ('FFA', 'classic'), ('1v1', 'custom')]:
            with self.subTest(game_type=game_type):
                chrome = Mock()
                chrome.evaluate.side_effect = ['queued', dict(mode=mode, rules=dict(game_type=game_type))]
                with self.assertRaisesRegex(RuntimeError, '1v1 queue'):
                    wait_for_1v1(chrome)


class GameServerOptionTests(unittest.TestCase):
    def test_named_server_requires_socket_transport_and_excludes_server_url(self):
        for argv in (['--game-server', 'bots', '--transport', 'cli'],
                     ['--server', 'https://ws.generals.io', '--game-server', 'bots']):
            with self.subTest(argv=argv), patch.object(sys, 'argv', ['bridge', *argv]), \
                 redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                main()
            self.assertEqual(error.exception.code, 2)

    def test_bot_players_skip_duel_stars(self):
        players = [dict(username='me', relation='self'), dict(username='enemy', relation='opponent')]
        with patch('browser_agent.bridge.duel_stars', return_value='1.0★') as stars:
            self.assertEqual(match_players(players), 'me (1.0★) vs enemy (1.0★)')
            self.assertEqual(match_players(players, stars=False), 'me vs enemy')
        self.assertEqual([call.args[0] for call in stars.call_args_list], ['me', 'enemy'])

