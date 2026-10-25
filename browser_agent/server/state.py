"""Accumulate server diffs and convert the player view to agent observations."""

import copy
import time

from browser_agent.protocol import Frame


def patch_array(previous, diff):
    """Apply alternating unchanged spans and replacement values."""
    result, offset = [], 0
    while offset < len(diff):
        same = diff[offset]
        result.extend(previous[len(result):len(result) + same])
        offset += 1
        if offset < len(diff):
            changed = diff[offset]
            result.extend(diff[offset + 1:offset + 1 + changed])
            offset += 1 + changed
    return result


class GameState:
    def __init__(self):
        self.data = {}
        self.arrays = {}
        self.received_at = None

    def update(self, event, data=None):
        if event == 'game_start':
            self.data = copy.deepcopy(data)
            self.arrays = {}
            self.received_at = None
        elif not self.data:
            return
        elif event == 'game_update':
            self.received_at = time.monotonic()
            data = copy.deepcopy(data)
            for name in ('map', 'cities', 'deserts'):
                diff = data.pop(name + '_diff', None)
                if diff is not None:
                    self.arrays[name] = patch_array(self.arrays.get(name, []), diff)
                    data[name] = self.arrays[name]
            self.data.update(data)
        elif event in ('game_won', 'game_lost', 'game_over'):
            self.data['ended'] = True
            if event != 'game_over':
                self.data.update(won=event == 'game_won', lost=event == 'game_lost')

    def board(self, pending_index=0):
        game = self.data
        if game.get('ended'):
            return dict(ended=True, won=game.get('won'), lost=game.get('lost'),
                        game_id=game.get('replay_id'), turn=game.get('turn', 0) - 1)
        raw = game.get('map')
        if not isinstance(raw, list) or not game.get('scores') or not game.get('turn'):
            return None
        width, height = raw[:2]
        size = width * height
        player = game['playerIndex']
        if player < 0:
            raise ValueError('A playing perspective is required')
        usernames = game['usernames']
        teams = game.get('teams') or list(range(len(usernames)))
        if len(usernames) != 2 or len(set(teams)) != 2 or game.get('options', {}).get('modifiers'):
            raise ValueError('Direct socket transport currently supports standard two-player games')
        cities, generals = set(game.get('cities', [])), set(game.get('generals', []))
        # Serialized map: width, height, armies, terrain, tunnel limits.
        terrain = raw[2 + size:2 + 2 * size]
        types, owners, armies = [], [], []
        for row in range(height):
            row_types, row_owners, row_armies = [], [], []
            for col in range(width):
                i = row * width + col
                tile = terrain[i]
                if not isinstance(tile, int) or tile < -6 or tile >= len(usernames):
                    raise ValueError('Unsupported terrain')
                hidden = tile in (-3, -4)
                row_types.append({-3: 0, -4: 5, -2: 2, -5: 6, -6: 7}.get(
                    tile, 4 if i in generals else 3 if i in cities else 1))
                row_owners.append(0 if tile < 0 else 1 if tile == player else 2)
                row_armies.append(0 if hidden else raw[2 + i])
            types.append(row_types)
            owners.append(row_owners)
            armies.append(row_armies)
        me = next(s for s in game['scores'] if s['i'] == player)
        enemy = next(s for s in game['scores'] if s['i'] != player)
        frame = Frame(player, game['turn'] - 1, me['tiles'], me['total'], enemy['tiles'], enemy['total'],
                      types, owners, armies, teams=teams,
                      players=[dict(s, username=usernames[s['i']], team=teams[s['i']],
                                    relation='self' if s['i'] == player else 'enemy') for s in game['scores']],
                      player_grid=[terrain[r * width:(r + 1) * width] for r in range(height)],
                      rules=dict(game_type=game.get('game_type'), modifiers=[], torus=False),
                      features=dict(deserts=game.get('deserts', []), swamps=game.get('swamps', []),
                                    tunnels=[[i, value] for i, value in enumerate(raw[2 + 2 * size:]) if value > 0]))
        frame.require_standard_duel()
        return dict(frame.__dict__, game_id=game['replay_id'], observed_at=self.received_at,
                    attack_index=game.get('attackIndex', 0),
                    submitted_attack_index=pending_index,
                    executed_moves=game.get('executedMoves', []), reverted_moves=game.get('revertedMoves', []),
                    queued_moves=int(pending_index > game.get('attackIndex', 0)))
