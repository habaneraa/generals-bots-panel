// Read the client view used by the HTML/Canvas renderer, never the server map.
((statusOnly = false) => {
    const root = document.querySelector('#gameMap');
    if (!root) return null;
    const key = Object.keys(root).find(k => /^__react(Fiber|InternalInstance)/.test(k));
    let fiber = root[key], store, view, renderer;
    while (fiber) {
        const props = fiber.stateNode?.props || fiber.memoizedProps || {};
        if (props.props?.map && props.cellSize) {
            view = props;
            renderer = fiber.stateNode;
        }
        if (props.store?.getState) store = props.store;
        fiber = fiber.return;
    }
    if (!store || !view) {
        if (statusOnly) return null;
        throw new Error('Unsupported generals.io renderer: cannot find client view');
    }
    const game = store.getState().game;
    if (statusOnly) return {store, ended: !!(game.lost || game.won || game.ended),
        game_id: game.replay_id ?? null, turn: game.turn - 1, player_id: game.playerIndex,
        height: game.map?.height, width: game.map?.width, queued_moves: view.queuedAttacks?.length || 0};
    if (game.lost || game.won || game.ended) return {ended: true, won: !!game.won, lost: !!game.lost,
        game_id: game.replay_id ?? null, turn: game.turn - 1};
    const map = game.map, player = game.playerIndex;
    // The map dimensions arrive before the first complete game update.
    if (!map || ![game.usernames, game.generals, game.cities, game.scores].every(Array.isArray) ||
        !Number.isInteger(player) || !Number.isInteger(game.turn) || game.turn < 1) return null;
    if (game.isReplay || game.isWatchMode || player < 0) throw new Error('A playing perspective is required');
    const count = game.usernames.length;
    if (player >= count) throw new Error('Invalid player index');
    const teams = game.teams || Array.from({length: count}, (_, i) => i);
    const isAlly = i => i !== player && teams[player] != null && teams[player] >= 0 && teams[i] === teams[player];
    const hasTeams = teams.some((team, i) => team >= 0 && teams.indexOf(team) !== i);
    const groups = teams.map((team, i) => team >= 0 ? `team:${team}` : `solo:${i}`);
    const teamSizes = [...new Set(groups)].map(group => groups.filter(g => g === group).length).sort((a, b) => a - b);
    const mode = hasTeams ? teamSizes.join('v') : game.game_type === 'classic' || count !== 2 ? 'FFA' : '1v1';
    const height = map.height, width = map.width, size = height * width;
    if (map._map?.length !== size || map._armies?.length !== size) return null;
    const cities = new Set(game.cities), generals = new Set(game.generals.filter(i => i >= 0));
    const types = [], owners = [], armies = [], playerGrid = [];
    const features = {deserts: [], swamps: [], tunnels: [], strongholds: []};
    const deserts = new Set(game.deserts), swamps = new Set(game.swamps);
    for (let row = 0; row < height; row++) {
        const tr = [], ow = [], ar = [], pl = [];
        for (let col = 0; col < width; col++) {
            const index = row * width + col, terrain = map._map[index];
            if (!Number.isInteger(terrain) || terrain < -6 || terrain >= count) throw new Error('Unsupported terrain');
            const hidden = terrain === -3 || terrain === -4;
            tr.push(terrain === -3 ? 0 : terrain === -4 ? 5 : terrain === -2 ? 2 :
                terrain === -5 ? 6 : terrain === -6 ? 7 :
                generals.has(index) ? 4 : cities.has(index) ? 3 : 1);
            ow.push(hidden || terrain < 0 ? 0 : terrain === player ? 1 : isAlly(terrain) ? 3 : 2);
            ar.push(hidden ? 0 : map._armies[index]);
            pl.push(terrain);
            if (!hidden) {
                if (deserts.has(index)) features.deserts.push(index);
                if (swamps.has(index)) features.swamps.push(index);
                if (map._tunnelLimits?.[index] > 0) features.tunnels.push([index, map._tunnelLimits[index]]);
                if (map._strongholdStrengths?.[index] > 0) features.strongholds.push([index, map._strongholdStrengths[index]]);
            }
        }
        types.push(tr); owners.push(ow); armies.push(ar); playerGrid.push(pl);
    }
    const me = game.scores.find(s => s.i === player);
    if (!me) return null;
    const allies = game.scores.filter(s => isAlly(s.i));
    const enemies = game.scores.filter(s => s.i !== player && !isAlly(s.i));
    const sum = (scores, key) => scores.reduce((total, s) => total + s[key], 0);
    const rect = root.getBoundingClientRect();
    // Rendered tile indices account for wrapping/panning and HTML/Canvas layouts.
    const rendered = renderer?._latestRenderState, positions = [];
    if (rendered?.rows) {
        const best = new Map();
        rendered.rows.forEach((tiles, r) => tiles.forEach((tile, c) => {
            if (map._map[tile.index] !== player) return;
            const x = rect.x + (c + .5) * rendered.cellSize, y = rect.y + (r + .5) * rendered.cellSize;
            if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return;
            const distance = (x - innerWidth / 2) ** 2 + (y - innerHeight / 2) ** 2;
            if (!best.has(tile.index) || distance < best.get(tile.index).distance) {
                best.set(tile.index, {distance, point: [Math.floor(tile.index / width), tile.index % width, x, y]});
            }
        }));
        for (const {point} of best.values()) positions.push(point);
    }
    const bindings = {};
    for (const [name, fallback] of Object.entries({UP:87, DOWN:83, LEFT:65, RIGHT:68, DESELECT:32, '50%':90, CENTER_MAP:67})) {
        bindings[name] = localStorage.getItem(name)?.split(',').map(Number)[0] ?? fallback;
    }
    return {
        observed_at: performance.now(),
        player_id: player, turn: game.turn - 1,
        my_land: me.tiles, my_army: me.total, opp_land: sum(enemies, 'tiles'), opp_army: sum(enemies, 'total'),
        allied_land: sum(allies, 'tiles'), allied_army: sum(allies, 'total'),
        mode, teams, player_grid: playerGrid,
        players: game.scores.map(s => ({...s, username: game.usernames[s.i], team: teams[s.i],
            relation: s.i === player ? 'self' : isAlly(s.i) ? 'ally' : 'enemy'})),
        rules: {game_type: game.game_type, modifiers: game.options?.modifiers || [], torus: !!map.modFlags?.[7]},
        features,
        tutorial_state: game.isTutorial ? game.tutorialState : null,
        queued_moves: view.queuedAttacks?.length || 0,
        types, owners, armies, game_id: game.replay_id ?? null,
        geometry: {x: rect.x, y: rect.y, cell: rendered?.cellSize || view.cellSize,
            width: rect.width, height: rect.height, positions: rendered?.rows ? positions : null},
        selected: view.selectedIndex, half: view.selectedIs50,
        bindings, viewport: {width: innerWidth, height: innerHeight},
    };
})()
