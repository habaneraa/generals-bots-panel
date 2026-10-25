"""Connect generals.io game transports to a persistent local stdio agent."""

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import argparse
from contextlib import ExitStack
import json
from pathlib import Path
import threading
import time
from urllib.parse import quote
from urllib.request import Request, urlopen

from browser_agent.agents.process import StdioAgent
from browser_agent.browser.transport import (
    Chrome, ChromeCLI, QUEUE_SCRIPT, READY_SCRIPT, WAIT_SCRIPT,
    discover_endpoint, execute_action, select_game_page,
)
from browser_agent.protocol import frame_from_board
from browser_agent.server.transport import (
    GAME_SERVERS, SocketGame, is_bot_server, open_socket_game, replay_url,
)
from browser_agent.diagnostics import logger, session_log


def duel_stars(username):
    url = f'https://generals.io/api/starsAndRanks?u={quote(username, safe="")}'
    try:
        request = Request(url, headers={'User-Agent': 'AverageJoe Browser Bridge'})
        with urlopen(request, timeout=2) as response:
            stars = json.load(response).get('stars', {}).get('duel')
        return f'{float(stars):.1f}★' if stars is not None else '?★'
    except (OSError, ValueError, TypeError):
        return '?★'


def match_players(players, stars=True):
    participants = sorted(players, key=lambda player: player.get('relation') != 'self')
    names = [player['username'] for player in participants if player.get('username')]
    return ' vs '.join(f'{name} ({duel_stars(name)})' for name in names) if stars else ' vs '.join(names)


def wait_for_1v1(game):
    logger.info('Waiting for a 1v1 match…')
    if isinstance(game, SocketGame):
        logger.debug('Matchmaking: direct server notifications')
        return game.wait_for_match()
    game.evaluate(QUEUE_SCRIPT)
    logger.debug('Matchmaking: client state notifications')
    while True:
        board = game.evaluate(WAIT_SCRIPT)
        if board:
            if board['mode'] != '1v1' or board['rules'].get('game_type') != '1v1':
                raise RuntimeError('Expected a 1v1 queue match')
            return board


def wait_for_ready(game, last_turn, game_key):
    if isinstance(game, SocketGame):
        return game.wait_for_ready(last_turn, game_key)
    request = json.dumps(dict(last_turn=last_turn, identity=game_key))
    return game.evaluate(READY_SCRIPT.replace('WAIT_REQUEST', request))


def watch_stdin_eof(stop_event):
    for _ in sys.stdin:
        pass
    stop_event.set()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--transport', choices=['socket', 'cli', 'cdp'], default='socket', help='socket sends directly to the game server; cli/cdp simulate browser input')
    parser.add_argument('--user-id-file', type=Path, help='account ID file for socket transport without Chrome')
    parser.add_argument('--server', help='full Socket.IO server URL instead of --game-server (selected Chrome tab, or ws.generals.io with --user-id-file)')
    parser.add_argument('--game-server', choices=tuple(GAME_SERVERS),
                        help='game server for socket transport: generals (ws.generals.io) or bots (botws.generals.io); '
                             'default is generals with --user-id-file, or the selected Chrome tab server')
    parser.add_argument('--page-id', type=int, help='chrome-devtools page ID for socket startup or cli transport')
    parser.add_argument('--protocol', choices=['stdio', 'jsonl'], default='jsonl')
    parser.add_argument("--ws-endpoint")
    parser.add_argument("--target-id", help="targetId from --list-pages for the selected transport")
    parser.add_argument("--list-pages", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="infer and log actions without sending moves")
    parser.add_argument("--autopilot", action="store_true", help="automatically queue another 1v1 match after each game")
    parser.add_argument("--agent-timeout", type=float, default=60, help="seconds to wait for an agent reply, including startup")
    parser.add_argument("--record-jsonl", type=Path, metavar='PATH', help="save per-turn observations, actions and resulting boards as JSONL")
    parser.add_argument("--agent", nargs=argparse.REMAINDER, help="stdio agent command; this option must be last")
    args = parser.parse_args()
    if args.agent is not None and not args.agent:
        parser.error('--agent requires a command')
    if args.page_id and args.transport == 'cdp':
        parser.error('--page-id requires --transport cli or socket')
    if args.server and args.game_server:
        parser.error('--server and --game-server are mutually exclusive')
    if (args.user_id_file or args.server or args.game_server) and args.transport != 'socket':
        parser.error('--user-id-file, --server and --game-server require --transport socket')
    command = args.agent or [sys.executable, str(Path(__file__).parent / 'agents/random_agent.py')]
    with ExitStack() as resources:
        resources.enter_context(session_log())
        logger.debug('Run: transport=%s protocol=%s policy=%s autopilot=%s dry_run=%s game_server=%s',
                     args.transport, args.protocol,
                     'custom' if args.agent else 'random',
                     args.autopilot, args.dry_run, args.game_server or args.server or 'auto')
        if args.transport == 'socket' and not args.list_pages:
            game = open_socket_game(args)
        else:
            game = ChromeCLI(args.ws_endpoint) if args.transport != 'cdp' else Chrome(args.ws_endpoint or discover_endpoint())
        resources.callback(game.close)
        agent = None
        recording = resources.enter_context(args.record_jsonl.open("w")) if args.record_jsonl else None
        if args.record_jsonl:
            logger.info('JSONL recording: %s', args.record_jsonl.resolve())
        pages = game.pages() if args.transport != 'socket' or args.list_pages else []
        if args.list_pages:
            print(json.dumps([{k: t[k] for k in ("targetId", "url", "title")} for t in pages], indent=2))
            return
        stop_after_game = threading.Event()
        if args.autopilot and sys.stdin.isatty():
            threading.Thread(target=watch_stdin_eof, args=(stop_after_game,), daemon=True).start()
        target_id = str(args.page_id) if args.page_id else args.target_id
        if pages:
            select_game_page(game, pages, target_id)
        if args.transport == 'cli':
            game.prepare_game()
            game.start_game_transport()
        elif args.transport == 'cdp':
            game.call('Emulation.setFocusEmulationEnabled', enabled=True)
            logger.debug('Chrome scheduling: game tab kept active while connected')
        transport_server = getattr(game, 'server', None)
        replay_server = (transport_server if isinstance(transport_server, str) else '') or args.server or \
            (GAME_SERVERS[args.game_server] if args.game_server else '') or \
            next((t['url'] for t in pages if t.get('selected')), '')
        bot_server = is_bot_server(replay_server)
        last_turn, game_key = -1, None
        game_players = []
        totals = dict(won=0, lost=0, draw=0)
        wait_ms = 0.0
        pending = wait_for_1v1(game)
        while True:
            board = pending if pending is not None else game.board()
            pending = None
            if not board or board.get('ended'):
                outcome = 'won' if board and board.get('won') else 'lost' if board and board.get('lost') else \
                    'draw' if board and board.get('ended') else 'finished'
                if outcome in totals:
                    totals[outcome] += 1
                game_id = (board or {}).get('game_id') or (game_key[0] if game_key else None)
                steps = max(last_turn, (board or {}).get('turn', -1)) + 1
                replay = replay_url(replay_server, game_id) if game_id else 'unknown'
                participants = match_players(game_players, stars=not bot_server)
                player_text = f' players={participants};' if participants else ''
                logger.info('Game %s;%s steps=%s replay=%s; total win=%s lost=%s draw=%s',
                            outcome, player_text, steps, replay, totals['won'], totals['lost'], totals['draw'])
                if args.autopilot:
                    if stop_after_game.is_set():
                        logger.info('EOF received; stopping autopilot.')
                        break
                    logger.info('queueing another match in 15 seconds.')
                    if stop_after_game.wait(15):
                        logger.info('EOF received; stopping autopilot.')
                        break
                    last_turn, game_key, wait_ms = -1, None, 0.0
                    game_players = []
                    pending = wait_for_1v1(game)
                    continue
                break
            frame = frame_from_board(board)
            identity = (board["game_id"], frame.player_id, frame.height, frame.width)
            if game_key is not None and (identity != game_key or frame.turn < last_turn):
                raise RuntimeError('The controlled game changed before its result was received')
            if board.get('queued_moves', 0) or frame.turn == last_turn:
                wait_started = time.monotonic()
                pending = wait_for_ready(game, last_turn, game_key)
                wait_ms += (time.monotonic() - wait_started) * 1000
                continue
            if game_key is None:
                if agent is None:
                    agent = StdioAgent(command, frame, args.protocol)
                    resources.callback(agent.close)
                else:
                    agent.reset(frame)
                game_key = identity
                game_players = frame.players
                logger.info('Taking over %s game %s (%sx%s)',
                            frame.mode, board['game_id'], frame.height, frame.width)
            started = time.monotonic()
            action = agent.act(frame, args.agent_timeout)
            value = getattr(agent, 'last_value', None)
            agent_ms = round((time.monotonic() - started) * 1000, 1)
            transport_started = time.monotonic()
            page_ms = None
            action_age_ms = None
            submitted_turn = None
            if args.transport in ('cli', 'socket') and not args.dry_run:
                result = game.apply_action(board, action)
                status, after = result['status'], result['after']
                page_ms = result.get('page_ms')
                action_age_ms = result.get('action_age_ms')
                submitted_turn = result.get('submitted_turn')
                pending = after
            else:
                current = game.board()
                status = "dry-run" if args.dry_run else "applied"
                if not current or current.get("ended") or current["game_id"] != board["game_id"] or current["turn"] < frame.turn:
                    status = "stale"
                elif not args.dry_run:
                    try:
                        execute_action(game, current, action)
                    except ValueError as error:
                        status = f"rejected: {error}"
                after = game.board() if status == 'applied' and recording else current
            transport_ms = round((time.monotonic() - transport_started) * 1000, 1)
            elapsed = round((time.monotonic() - started) * 1000, 1)
            timing = f'agent={agent_ms}ms {"socket" if args.transport == "socket" else "browser"}={transport_ms}ms'
            if page_ms is not None:
                timing += f' page={page_ms}ms'
            timing += f' wait={round(wait_ms, 1)}ms'
            if action_age_ms is not None:
                timing += f' age={action_age_ms}ms submitted_turn={submitted_turn}'
            skipped = max(0, frame.turn - last_turn - 1) if last_turn >= 0 else 0
            timing += f' skipped={skipped}'
            if value is not None:
                timing += f' value={value:+.4f}'
            logger.debug('game=%s turn=%s action=%s %s %sms (%s)',
                         board['game_id'], frame.turn, action, status, elapsed, timing)
            if recording:
                recording.write(json.dumps({"board": board, "action": action, "status": status,
                                      "after": after, "elapsed_ms": elapsed, "agent_ms": agent_ms,
                                      "transport": args.transport,
                                      "socket_ms" if args.transport == 'socket' else "browser_ms": transport_ms, "page_ms": page_ms,
                                      "wait_ms": round(wait_ms, 1), "action_age_ms": action_age_ms,
                                      "submitted_turn": submitted_turn, "skipped": skipped,
                                      "value": value}) + "\n")
                recording.flush()
            last_turn = frame.turn
            wait_ms = 0.0


def run():
    try:
        main()
    except KeyboardInterrupt:
        pass
    except (RuntimeError, ValueError, TimeoutError, OSError) as error:
        print(f"Browser bridge: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    run()
