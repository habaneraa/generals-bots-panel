import io
import json
import random
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock, patch

from browser_agent.browser.transport import (
    BOARD_SCRIPT, QUEUE_SCRIPT, READY_SCRIPT, STATUS_SCRIPT, WAIT_SCRIPT,
    ChromeCLI, execute_action, move_point, select_game_page,
)
from browser_agent.protocol import decode_action, frame_from_board, read_frame, read_handshake
from browser_agent.agents.random_agent import choose_action
from browser_agent.tests.fixtures import client_board


class BrowserTransportTests(unittest.TestCase):
    def test_startup_refreshes_only_the_server_disconnect_alert(self):
        for message in ('Disconnected from server. Please refresh the page.', 'Other alert'):
            with self.subTest(message=message):
                chrome = object.__new__(ChromeCLI)
                chrome.page_id = 1
                chrome._tool = Mock(return_value=dict(dialog=dict(type='alert', message=message)))
                chrome.prepare_game()
                calls = chrome._tool.call_args_list
                if message.startswith('Disconnected'):
                    self.assertEqual([call.args[0] for call in calls], ['take_snapshot', 'handle_dialog', 'navigate_page'])
                    self.assertEqual(calls[-1].args[1]['type'], 'reload')
                else:
                    self.assertEqual(len(calls), 1)

    def test_browser_action_checks_source_again_after_click(self):
        # Execute the actual browser action script against changing client views.
        script = Path(__file__).resolve().parents[1].joinpath('browser/action.js').read_text()
        board = client_board()
        for lost in (False, True):
            with self.subTest(lost=lost):
                fixture = """
const board = JSON.parse(process.argv[1]), lost = JSON.parse(process.argv[2]);
const keys = [];
global.requestAnimationFrame = callback => setImmediate(callback);
global.innerWidth = 800; global.innerHeight = 600;
global.MouseEvent = global.KeyboardEvent = class {constructor(type, options) {this.type = type; Object.assign(this, options);}};
const target = {dispatchEvent(event) {
    if (event.type === 'mouseup') {board.selected = 0; if (lost) board.owners[0][0] = 2;}
}};
global.document = {
    activeElement: {blur() {}}, elementFromPoint: () => target,
    querySelector: () => ({contains: () => true}),
    dispatchEvent(event) {
        if (event.type !== 'keydown') return;
        keys.push(event.keyCode);
        if (event.keyCode === 32) board.selected = -1;
        if (event.keyCode === 90) board.half = !board.half;
    },
};
"""
                expression = script.replace('BOARD_READER', 'structuredClone(board)').replace('ACTION_REQUEST',
                    json.dumps(dict(action=[0, 0, 0, 3, 1], game_id=board['game_id'], turn=board['turn'])))
                result = subprocess.run(['node', '-e', fixture + '\n' + expression +
                    '.then(result => console.log(JSON.stringify({result, keys})));', json.dumps(board), json.dumps(lost)],
                    capture_output=True, text=True, check=True)
                payload = json.loads(result.stdout)
                if lost:
                    self.assertIn('source must be owned', payload['result']['status'])
                    self.assertEqual(payload['keys'], [32])
                else:
                    self.assertEqual(payload['result']['status'], 'applied')
                    self.assertEqual(payload['keys'], [32, 90, 68])

    def test_cli_evaluation_disables_tool_dom_stability_wait(self):
        chrome = object.__new__(ChromeCLI)
        chrome.page_id = 2
        chrome.fast = None
        chrome._tool = Mock(return_value={'message': '```json\n{"turn": 51}\n```'})
        self.assertEqual(chrome.evaluate('({turn: 51})'), {'turn': 51})
        self.assertFalse(chrome._tool.call_args.args[1]['waitForStableDom'])

    def test_mouse_release_waits_for_render_commit_without_fixed_hold(self):
        script = Path(__file__).resolve().parents[1].joinpath('browser/action.js').read_text()
        board = client_board()
        fixture = """
const board = JSON.parse(process.argv[1]), delays = [], keys = [];
let down = false, committed = false;
const timer = global.setTimeout;
global.setTimeout = (callback, delay) => {delays.push(delay); return timer(callback, delay);};
global.requestAnimationFrame = callback => setImmediate(() => {committed = down; callback();});
global.MouseEvent = global.KeyboardEvent = class {constructor(type, options) {this.type = type; Object.assign(this, options);}};
const target = {dispatchEvent(event) {
    if (event.type === 'mousedown') down = true;
    if (event.type === 'mouseup' && committed) board.selected = 0;
}};
global.document = {
    activeElement: {blur() {}}, elementFromPoint: () => target,
    querySelector: () => ({contains: () => true}),
    dispatchEvent(event) {
        if (event.type !== 'keydown') return;
        keys.push(event.keyCode);
        if (event.keyCode === 32) board.selected = -1;
    },
};
"""
        expression = script.replace('BOARD_READER', 'structuredClone(board)').replace('ACTION_REQUEST',
            json.dumps(dict(action=[0, 0, 0, 3, 0], game_id=board['game_id'], turn=board['turn'])))
        run = subprocess.run(['node', '-e', fixture + '\n' + expression +
            '.then(result => console.log(JSON.stringify({result, delays, keys})));', json.dumps(board)],
            capture_output=True, text=True, check=True)
        payload = json.loads(run.stdout)
        self.assertEqual(payload['result']['status'], 'applied')
        self.assertEqual(payload['keys'], [32, 68])
        self.assertTrue(all(delay == 0 for delay in payload['delays']))
        self.assertIn('page_ms', payload['result'])

    def test_cli_starts_browser_connection_without_manual_helper(self):
        for running in (True, False):
            with self.subTest(running=running):
                endpoint = 'ws://localhost:1234/browser/test'
                status = subprocess.CompletedProcess([], 0, 'daemon is running ' + endpoint if running else '', '')
                start = subprocess.CompletedProcess([], 0, 'started', '')
                with patch('browser_agent.browser.transport.subprocess.run', side_effect=[status, start]) as run:
                    ChromeCLI(endpoint)
                self.assertEqual(run.call_count, 1 if running else 2)
                if not running:
                    self.assertEqual(run.call_args.args[0], ['chrome-devtools', 'start', '--wsEndpoint',
                                                            'ws://localhost:1234/browser/test'])

    def test_auto_selection_prefers_playing_tab_over_lobby(self):
        chrome = Mock()
        chrome.board.side_effect = [None, dict(turn=1)]
        pages = [dict(targetId='1', url='https://generals.io/', selected=True),
                 dict(targetId='2', url='https://generals.io/', selected=False)]
        select_game_page(chrome, pages)
        chrome.attach.assert_called_with('2')

    def test_start_then_select_duel_on_dom_updates(self):
        fixture = """
const clicked = [], intervals = [];
let stage = 0, reads = 0;
const classList = {contains: () => false};
const start = {classList, click() {clicked.push('start'); stage = 1;}};
const duel = {classList, textContent: '1v1', get disabled() {return stage === 1;}, click() {clicked.push('1v1');}};
global.document = {
    documentElement: {},
    querySelector: selector => selector === '#play-buttons button.big' ? start : null,
    querySelectorAll: () => stage ? [duel] : [],
};
const timer = global.setTimeout;
global.setTimeout = (callback, delay) => {intervals.push(delay); return timer(callback, delay);};
global.MutationObserver = class {
    constructor(callback) {this.callback = callback;}
    observe() {setImmediate(() => {stage = 2; this.callback();});}
    disconnect() {}
};
global.requestAnimationFrame = callback => setImmediate(callback);
global.cancelAnimationFrame = clearImmediate;
const readBoard = () => ++reads < 3 ? null : {mode: '1v1', turn: 0, height: 2, width: 3};
"""
        queue = QUEUE_SCRIPT.replace(BOARD_SCRIPT, 'null')
        wait = WAIT_SCRIPT.replace(STATUS_SCRIPT, 'readBoard()').replace(BOARD_SCRIPT, 'readBoard()')
        script = fixture + '\n' + queue + '.then(() => ' + wait + ').then(board => console.log(JSON.stringify({clicked, intervals, board})));'
        result = subprocess.run(['node', '-e', script], capture_output=True, text=True, check=True)
        payload = json.loads(result.stdout)
        self.assertEqual(payload['clicked'], ['start', '1v1'])
        self.assertEqual(payload['intervals'], [20000, 20000, 40000])
        self.assertEqual(payload['board']['turn'], 0)

    def test_requeue_waits_for_exit_countdown_and_page_teardown(self):
        fixture = """
const clicked = [], observers = new Set();
let stage = 0, started = false;
const classList = {contains: () => false};
const exit = {textContent: 'Exit', classList: {contains: () => stage < 1},
    click() {clicked.push('exit'); stage = 2;}};
const start = {classList, click() {
    if (stage < 4) throw Error('clicked PLAY before game teardown completed');
    clicked.push('start'); started = true;
}};
const duel = {classList, textContent: '1v1', click() {clicked.push('1v1');}};
global.document = {
    documentElement: {},
    querySelectorAll: selector => selector === 'button' ? [exit] : started ? [duel] : [],
    querySelector: selector => selector === '#play-buttons button.big' ? (stage >= 2 ? start : null) :
        stage < 4 ? {} : null,
};
global.MutationObserver = class {
    constructor(callback) {this.callback = callback;}
    observe() {observers.add(this);}
    disconnect() {observers.delete(this);}
};
const notify = () => [...observers].forEach(observer => observer.callback());
setImmediate(() => {
    stage = 1; notify();
    setImmediate(() => {
        if (started) throw Error('clicked PLAY while old game was mounted');
        stage = 3; notify();
        setImmediate(() => {
            if (started) throw Error('clicked PLAY during menu transition');
            stage = 4; notify();
        });
    });
});
"""
        script = fixture + '\n' + QUEUE_SCRIPT.replace(BOARD_SCRIPT, '({ended: true})') + \
            '.then(result => console.log(JSON.stringify({result, clicked, observers: observers.size})));'
        result = subprocess.run(['node', '-e', script], capture_output=True, text=True, check=True, timeout=5)
        self.assertEqual(json.loads(result.stdout),
                         dict(result='queued', clicked=['exit', 'start', '1v1'], observers=0))

    def test_queue_timeout_reports_phase_and_disabled_button_reason(self):
        fixture = """
let observer, deadline, disconnected = 0, cleared = 0;
const duel = {textContent: '1v1', disabled: true, title: 'Leave your party to queue this mode.',
    classList: {contains: () => false}};
global.location = {href: 'https://generals.io/'};
global.document = {documentElement: {}, querySelector: () => null, querySelectorAll: () => [duel]};
global.MutationObserver = class {
    constructor(callback) {observer = this; this.callback = callback;}
    observe() {} disconnect() {disconnected++;}
};
global.setTimeout = callback => {deadline = callback; return 1;};
global.clearTimeout = () => {cleared++;};
"""
        script = fixture + '\nconst waiting = ' + QUEUE_SCRIPT.replace(BOARD_SCRIPT, 'null') + \
            ';\ndeadline();\nwaiting.catch(error => console.log(JSON.stringify({error: error.message, disconnected, cleared})));'
        result = subprocess.run(['node', '-e', script], capture_output=True, text=True, check=True, timeout=5)
        payload = json.loads(result.stdout)
        self.assertIn('waiting for the 1v1 button', payload['error'])
        self.assertIn('https://generals.io/', payload['error'])
        self.assertIn('1v1 [disabled]: Leave your party', payload['error'])
        self.assertEqual((payload['disconnected'], payload['cleared']), (1, 1))

    def test_wait_ready_handles_client_and_canvas_updates_and_cleans_up(self):
        scenarios = {
            'already_ready': '',
            'queue_and_turn': "board.turn = 51; board.queued_moves = 1; notify(); if (unsubscribed) throw Error('returned with queued move'); board.queued_moves = 0; observer.callback();",
            'same_turn': "board.queued_moves = 0; notify(); if (unsubscribed) throw Error('returned on same turn'); board.turn = 51; notify();",
            'canvas': "board.turn = 51; board.queued_moves = 0; paint();",
            'ended': "board.ended = true; notify();",
            'identity': "board.game_id = 'different'; notify();",
            'rewind': "board.turn = 49; notify();",
            'error': "broken = true; notify();",
            'timeout': "deadline();",
        }
        fixture = """
let board = {game_id: 'fixture', player_id: 1, height: 2, width: 3, turn: 50, queued_moves: 1};
let notify, paint, observer, deadline, unsubscribed = 0, disconnected = 0, cancelled = 0, cleared = 0, broken = false;
const store = {subscribe(callback) {notify = callback; return () => {unsubscribed++;};}};
global.document = {documentElement: {}};
global.MutationObserver = class {
    constructor(callback) {this.callback = callback; observer = this;}
    observe() {} disconnect() {disconnected++;}
};
global.requestAnimationFrame = callback => {paint = callback; return 1;};
global.cancelAnimationFrame = () => {cancelled++;};
global.setTimeout = callback => {deadline = callback; return 1;};
global.clearTimeout = () => {cleared++;};
const getStatus = () => {if (broken) throw Error('reader failed'); return {...board, store};};
"""
        request = dict(last_turn=50, identity=['fixture', 1, 2, 3])
        wait = READY_SCRIPT.replace(STATUS_SCRIPT, 'getStatus()').replace(BOARD_SCRIPT, 'structuredClone(board)').replace('WAIT_REQUEST', json.dumps(request))
        for name, update in scenarios.items():
            with self.subTest(name=name):
                initial = 'board.turn = 51; board.queued_moves = 0;\n' if name == 'already_ready' else ''
                script = fixture + initial + '\nconst waiting = ' + wait + ';\n' + update + "\nwaiting.then(board => ({board}), error => ({error: error.message})).then(result => console.log(JSON.stringify({...result, unsubscribed, disconnected, cancelled, cleared})));"
                result = subprocess.run(['node', '-e', script], capture_output=True, text=True, check=True)
                payload = json.loads(result.stdout)
                self.assertEqual((payload['unsubscribed'], payload['disconnected'], payload['cleared']), (1, 1, 1))
                if name in ('error', 'timeout'):
                    self.assertIn('error', payload)
                elif name == 'ended':
                    self.assertTrue(payload['board']['ended'])
                elif name == 'identity':
                    self.assertEqual(payload['board']['game_id'], 'different')
                elif name == 'rewind':
                    self.assertEqual(payload['board']['turn'], 49)
                else:
                    self.assertEqual((payload['board']['turn'], payload['board']['queued_moves']), (51, 0))
                self.assertEqual(payload['cancelled'], 0 if name in ('canvas', 'already_ready') else 1)

    def test_status_reader_omits_full_map_and_geometry(self):
        board = client_board(status_only=True)
        self.assertEqual((board['turn'], board['queued_moves'], board['height'], board['width']), (50, 0, 2, 3))
        self.assertNotIn('types', board)
        self.assertNotIn('geometry', board)

    def test_client_view_waits_for_complete_initial_observation(self):
        for changes in (dict(generals=None), dict(cities=None), dict(scores=None),
                        dict(usernames=None), dict(playerIndex=None), dict(turn=0),
                        dict(scores=[dict(i=0, tiles=7, total=20)]),
                        dict(map=dict(height=2, width=3)),
                        dict(map=dict(height=2, width=3, _map=[1], _armies=[10]))):
            with self.subTest(changes=changes):
                self.assertIsNone(client_board(**changes))

    def test_client_view_preserves_fog_and_relative_player_scores(self):
        board = client_board()
        self.assertEqual(board['types'], [[4, 4, 0], [5, 2, 3]])
        self.assertEqual(board['owners'], [[1, 2, 0], [0, 0, 0]])
        self.assertEqual(board['armies'], [[10, 3, 0], [0, 0, 40]])
        self.assertEqual((board['my_land'], board['my_army'], board['opp_land'], board['opp_army']),
                         (1, 10, 7, 20))
        self.assertEqual(board['turn'], 50)

    def test_spectator_and_replay_fail(self):
        for changes in [dict(playerIndex=-1), dict(isReplay=True), dict(playerIndex=4)]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                client_board(**changes)

    def test_action_validation_and_geometry(self):
        board = client_board()
        self.assertEqual(move_point(board, decode_action('0 0 0 3 1')), (116, 66))
        self.assertIsNone(move_point(board, decode_action('1 0 0 0 0')))
        for line in ['2 0 0 0 0', '0 0 0 4 0', '0 0 0 3 2', '0 0']:
            with self.subTest(line=line), self.assertRaises(ValueError):
                decode_action(line)
        for action in [(0, 0, 0, 0, 0), (0, 0, 1, 3, 0), (0, 3, 0, 1, 0)]:
            with self.subTest(action=action), self.assertRaises(ValueError):
                move_point(board, action)
        board['geometry']['x'] = -200
        with self.assertRaisesRegex(ValueError, 'offscreen'):
            move_point(board, (0, 0, 0, 3, 0))

    def test_lost_source_during_mouse_selection_cancels_movement(self):
        board = client_board()

        class ChromeFixture:
            def __init__(self):
                self.keys = []

            def evaluate(self, expression):
                return True

            def key(self, code):
                self.keys.append(code)

            def click(self, x, y):
                pass

            def board(self):
                return dict(board, selected=0, turn=board['turn'] + 1,
                            owners=[[2, 2, 0], [0, 0, 0]])

        chrome = ChromeFixture()
        with self.assertRaisesRegex(ValueError, 'owned'):
            execute_action(chrome, board, (0, 0, 0, 3, 1))
        self.assertEqual(chrome.keys, [board['bindings']['DESELECT']])

    def test_ffa_aggregates_every_enemy_and_preserves_player_indices(self):
        board = client_board(usernames=['a', 'b', 'c', 'd'], teams=[0, 1, 2, 3],
                             playerIndex=3, scores=[dict(i=2, tiles=11, total=80), dict(i=0, tiles=7, total=20),
                                                    dict(i=3, tiles=1, total=10), dict(i=1, tiles=10, total=50)],
                             map=dict(height=2, width=3, _map=[3, 1, 0, 2, -3, -4],
                                      _armies=[10, 3, 4, 5, 99, 99], modFlags=[]))
        self.assertEqual(board['mode'], 'FFA')
        self.assertEqual(board['owners'], [[1, 2, 2], [2, 0, 0]])
        self.assertEqual((board['opp_land'], board['opp_army']), (28, 150))
        self.assertEqual(board['player_grid'], [[3, 1, 0], [2, -3, -4]])
        self.assertEqual(board['allied_army'], 0)

    def test_classic_queue_keeps_ffa_mode_with_two_players(self):
        self.assertEqual(client_board(game_type='classic')['mode'], 'FFA')

    def test_team_game_separates_allies_and_enemy_scores_in_jsonl(self):
        board = client_board(usernames=['a', 'b', 'c', 'd'], teams=[0, 1, 0, 1],
                             playerIndex=3, scores=[dict(i=2, tiles=11, total=80), dict(i=0, tiles=7, total=20),
                                                    dict(i=3, tiles=1, total=10), dict(i=1, tiles=10, total=50)],
                             map=dict(height=2, width=3, _map=[3, 1, 0, 2, -3, -4],
                                      _armies=[10, 3, 4, 5, 99, 99], modFlags=[]))
        self.assertEqual(board['mode'], '2v2')
        self.assertEqual(board['owners'], [[1, 3, 2], [2, 0, 0]])
        self.assertEqual((board['opp_land'], board['opp_army'], board['allied_land'], board['allied_army']),
                         (18, 100, 10, 50))
        frame = frame_from_board(board)
        with self.assertRaisesRegex(ValueError, 'Standard 1v1'):
            frame.handshake()
        stream = io.StringIO(frame.handshake('jsonl') + frame.encode('jsonl'))
        handshake = read_handshake(stream)
        self.assertEqual(handshake, (3, 2, 3, 'jsonl'))
        self.assertEqual(read_frame(stream, *handshake), frame)

    def test_special_terrain_and_modifiers_survive_jsonl(self):
        board = client_board(options=dict(modifiers=[7]), deserts=[0], swamps=[5],
                             map=dict(height=2, width=3, _map=[1, -5, -6, -4, -2, -1],
                                      _armies=[10, 0, 0, 99, 0, 40], modFlags=[False]*7 + [True],
                                      _tunnelLimits=[0, 0, 0, 9, 0, 7], _strongholdStrengths=[0, 0, 0, 5, 0, 4]))
        self.assertEqual(board['types'][0][1:], [6, 7])
        self.assertTrue(board['rules']['torus'])
        self.assertEqual(board['features']['tunnels'], [[5, 7]])
        self.assertEqual(board['features']['strongholds'], [[5, 4]])
        frame = frame_from_board(board)
        self.assertEqual(read_frame(io.StringIO(frame.encode('jsonl')), 1, 2, 3, 'jsonl'), frame)
        with self.assertRaises(ValueError):
            frame.encode()

    def test_torus_wraps_actions_and_uses_rendered_source_coordinates(self):
        board = client_board()
        board['rules']['torus'] = True
        board['geometry']['positions'] = [[0, 0, 300, 200]]
        board['geometry']['width'] *= 3
        self.assertEqual(move_point(board, (0, 0, 0, 0, 0)), (300, 200))
        actions = [choose_action(frame_from_board(board), random.Random(seed)) for seed in range(30)]
        self.assertTrue(any(action[3] in (0, 2) for action in actions))

