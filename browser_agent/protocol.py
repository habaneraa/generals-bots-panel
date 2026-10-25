"""Agent observations, JSONL v2 and legacy integer stdio protocols."""

from dataclasses import asdict, dataclass, field
import json


DIRECTIONS = ((-1, 0), (1, 0), (0, -1), (0, 1))


@dataclass
class Frame:
    player_id: int
    turn: int
    my_land: int
    my_army: int
    opp_land: int
    opp_army: int
    types: list[list[int]]
    owners: list[list[int]]
    armies: list[list[int]]
    allied_land: int = 0
    allied_army: int = 0
    mode: str = '1v1'
    teams: list[int] = field(default_factory=list)
    players: list[dict] = field(default_factory=list)
    player_grid: list[list[int]] = field(default_factory=list)
    rules: dict = field(default_factory=dict)
    features: dict = field(default_factory=dict)

    @property
    def height(self):
        return len(self.types)

    @property
    def width(self):
        return len(self.types[0])

    def handshake(self, protocol='stdio'):
        if protocol == 'jsonl':
            return json.dumps(dict(event='start', version=2, player_id=self.player_id,
                                   height=self.height, width=self.width, mode=self.mode,
                                   teams=self.teams, players=self.players, rules=self.rules)) + '\n'
        self.require_standard_duel()
        return f"{self.player_id} {self.height} {self.width}\n"

    def require_standard_duel(self):
        if self.mode != '1v1' or any(x > 2 for row in self.owners for x in row) or \
                any(x > 5 for row in self.types for x in row) or self.rules.get('modifiers') or \
                any(self.features.values()):
            raise ValueError('Standard 1v1 is required; allies, modifiers and special terrain are unsupported')

    def encode(self, protocol='stdio'):
        if protocol == 'jsonl':
            return json.dumps(dict(event='observation', **asdict(self))) + '\n'
        self.require_standard_duel()
        lines = [f"{self.turn} {self.my_land} {self.my_army} {self.opp_land} {self.opp_army}"]
        for grid in (self.types, self.owners, self.armies):
            lines.extend(" ".join(map(str, row)) for row in grid)
        return "\n".join(lines) + "\n"


def frame_from_board(board):
    return Frame(**{key: board[key] for key in Frame.__dataclass_fields__ if key in board})


def read_handshake(stream):
    line = stream.readline()
    if not line:
        return None
    if line.startswith('{'):
        start = json.loads(line)
        if start.get('event') != 'start' or start.get('version') != 2:
            raise ValueError('Expected JSONL v2 start')
        return start['player_id'], start['height'], start['width'], 'jsonl'
    player, height, width = map(int, line.split())
    return player, height, width, 'stdio'


def read_frame(stream, player_id, height, width, protocol='stdio'):
    header = stream.readline()
    if not header:
        return None
    if protocol == 'jsonl':
        data = json.loads(header)
        event = data.pop('event', None)
        if event == 'end':
            return None
        if event != 'observation':
            raise ValueError('Expected JSONL observation')
        frame = Frame(**data)
        if frame.player_id != player_id or any(len(grid) != height or any(len(row) != width for row in grid)
                                               for grid in (frame.types, frame.owners, frame.armies)):
            raise ValueError('Observation does not match handshake')
        return frame
    if not header.strip():
        return None  # End of this game; the next line is a new handshake.
    scalars = [int(x) for x in header.split()]
    if len(scalars) != 5:
        raise ValueError("observation header must contain five integers")
    grids = []
    for _ in range(3):
        grid = []
        for _ in range(height):
            row = [int(x) for x in stream.readline().split()]
            if len(row) != width:
                raise ValueError("incomplete observation grid")
            grid.append(row)
        grids.append(grid)
    return Frame(player_id, *scalars, *grids)


def decode_action(line):
    action = tuple(int(x) for x in line.split())
    if len(action) != 5:
        raise ValueError("agent must output five integers")
    p, _, _, direction, split = action
    if p not in (0, 1) or (p == 0 and (direction not in range(4) or split not in (0, 1))):
        raise ValueError("unsupported action (only standard move/pass is supported)")
    return action


def decode_agent_reply(line):
    fields = line.split()
    if len(fields) == 5:
        return decode_action(line), None
    if len(fields) != 6:
        raise ValueError("agent must output five integers and optional value estimate")
    action = decode_action(" ".join(fields[:5]))
    try:
        value = float(fields[5])
    except ValueError:
        raise ValueError("agent value estimate must be numeric") from None
    return action, value
