"""Random expansion and frontier reinforcement, using stdio or JSONL observations."""

import argparse
from collections import deque
from pathlib import Path
import random
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from browser_agent.protocol import DIRECTIONS, read_frame, read_handshake


def choose_action(frame, rng):
    attacks, reinforcements = [], []
    distances = [[-1] * frame.width for _ in range(frame.height)]
    frontier = deque()

    def neighbors(row, col):
        for direction, (dr, dc) in enumerate(DIRECTIONS):
            r, c = row + dr, col + dc
            if frame.rules.get('torus'):
                r %= frame.height
                c %= frame.width
            if 0 <= r < frame.height and 0 <= c < frame.width and frame.types[r][c] not in (2, 6, 7):
                yield direction, r, c

    # Distance through owned land to a cell that can attack outside our territory.
    for row in range(frame.height):
        for col in range(frame.width):
            if frame.owners[row][col] == 1 and any(frame.owners[r][c] not in (1, 3)
                                                  for _, r, c in neighbors(row, col)):
                distances[row][col] = 0
                frontier.append((row, col))
    while frontier:
        row, col = frontier.popleft()
        for _, r, c in neighbors(row, col):
            if frame.owners[r][c] == 1 and distances[r][c] < 0:
                distances[r][c] = distances[row][col] + 1
                frontier.append((r, c))

    for row in range(frame.height):
        for col in range(frame.width):
            if frame.owners[row][col] != 1 or frame.armies[row][col] <= 1:
                continue
            army = frame.armies[row][col]
            for direction, r, c in neighbors(row, col):
                owner = frame.owners[r][c]
                if owner not in (1, 3) and army - 1 > frame.armies[r][c]:
                    splits = [0, 1] if army // 2 > frame.armies[r][c] else [0]
                    attacks.append((0, row, col, direction, rng.choice(splits)))
                elif owner == 1 and distances[r][c] >= 0 and (
                    distances[r][c] < distances[row][col] or
                    (distances[r][c] == distances[row][col] and army <= frame.armies[r][c])
                ):
                    reinforcements.append((0, row, col, direction, 0))
    moves = attacks or reinforcements
    return rng.choice(moves) if moves else (1, 0, 0, 0, 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', type=int, default=0)
    args = parser.parse_args()
    while (start := read_handshake(sys.stdin)) is not None:
        player, height, width, protocol = start
        rng = random.Random(args.seed)
        while (frame := read_frame(sys.stdin, player, height, width, protocol)) is not None:
            print(' '.join(map(str, choose_action(frame, rng))), flush=True)


if __name__ == '__main__':
    main()
