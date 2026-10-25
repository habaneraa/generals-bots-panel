// Run mouse/key input together, without the debugging tool's per-key UI wait.
(async () => {
    const read = () => BOARD_READER;
    const {action, game_id, turn, observed_at} = ACTION_REQUEST;
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const started = performance.now();
    let submittedTurn = null, actionAge = null;
    const result = (status, after) => ({status, after, page_ms: Math.round((performance.now() - started) * 10) / 10,
        submitted_turn: submittedTurn, action_age_ms: actionAge});
    const submitting = board => {
        submittedTurn = board.turn;
        actionAge = observed_at == null ? null : Math.round((performance.now() - observed_at) * 10) / 10;
    };
    // Mouse-down records a React state used by the click callback's effect.
    // Yield through paint and a task so that effect can commit before mouse-up.
    const commitMouseDown = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const key = code => {
        const name = code === 32 ? ' ' : code >= 37 && code <= 40 ?
            ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'][code - 37] : String.fromCharCode(code).toLowerCase();
        for (const type of ['keydown', 'keyup']) document.dispatchEvent(new KeyboardEvent(type,
            {bubbles: true, cancelable: true, key: name, keyCode: code, which: code}));
    };
    const validate = board => {
        if (!board || board.ended || board.game_id !== game_id || board.turn < turn)
            throw new Error('game changed or ended');
        const [, r, c, d] = action, h = board.types.length, w = board.types[0].length;
        if (r < 0 || r >= h || c < 0 || c >= w || board.owners[r][c] !== 1 || board.armies[r][c] <= 1)
            throw new Error('source must be owned and have more than one army');
        const [dr, dc] = [[-1, 0], [1, 0], [0, -1], [0, 1]][d];
        let nr = r + dr, nc = c + dc;
        if (board.rules.torus) {nr = (nr + h) % h; nc = (nc + w) % w;}
        if (nr < 0 || nr >= h || nc < 0 || nc >= w || [2, 6, 7].includes(board.types[nr][nc]))
            throw new Error('destination is outside the board or impassable');
    };
    try {
        let board = read();
        if (action[0]) {submitting(board); return result('applied', board);}
        validate(board);
        document.activeElement?.blur();
        // The tutorial locks city capture until its map-drag lesson is completed.
        if (board.tutorial_state === 2) {
            const rect = document.querySelector('#gameMap').getBoundingClientRect();
            const x = Math.max(20, Math.min(innerWidth - 80, rect.x + rect.width / 2));
            const y = Math.max(20, Math.min(innerHeight - 80, rect.y + rect.height / 2));
            const target = document.elementFromPoint(x, y);
            target.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, clientX: x, clientY: y, button: 0, buttons: 1}));
            await sleep(100);
            for (let delta = 16; delta <= 48; delta += 16) {
                target.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, clientX: x + delta, clientY: y,
                    button: 0, buttons: 1, movementX: 16, movementY: 0}));
                await sleep(20);
            }
            target.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, clientX: x + 48, clientY: y, button: 0, buttons: 0}));
            await sleep(550);
            key(board.bindings.CENTER_MAP);
            await sleep(0);
            board = read(); validate(board);
        }
        const point = () => board.geometry.positions?.find(p => p[0] === action[1] && p[1] === action[2]);
        let position = point();
        if (!position && board.geometry.positions) {
            key(board.bindings.CENTER_MAP);
            await sleep(50);
            board = read(); validate(board); position = point();
        }
        let x, y;
        if (board.geometry.positions) {
            if (!position) throw new Error('source is offscreen');
            [, , x, y] = position;
        } else {
            x = board.geometry.x + (action[2] + .5) * board.geometry.cell;
            y = board.geometry.y + (action[1] + .5) * board.geometry.cell;
        }
        const target = document.elementFromPoint(x, y);
        if (!document.querySelector('#gameMap').contains(target)) throw new Error('source is covered or offscreen');
        key(board.bindings.DESELECT);
        const options = {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0};
        target.dispatchEvent(new MouseEvent('mousemove', {...options, buttons: 0}));
        target.dispatchEvent(new MouseEvent('mousedown', {...options, buttons: 1}));
        await commitMouseDown();
        target.dispatchEvent(new MouseEvent('mouseup', {...options, buttons: 0}));
        target.dispatchEvent(new MouseEvent('click', {...options, buttons: 0}));
        // Let the renderer commit the selection before inspecting it.
        await sleep(0);
        board = read(); validate(board);
        const expected = action[1] * board.types[0].length + action[2];
        if (board.selected !== expected) throw new Error('mouse click did not select the source cell');
        if (!!board.half !== !!action[4]) {
            key(board.bindings['50%']);
            await sleep(0);
            board = read(); validate(board);
            if (board.selected !== expected || !!board.half !== !!action[4]) throw new Error('half-army toggle failed');
        }
        submitting(board);
        key(board.bindings[['UP', 'DOWN', 'LEFT', 'RIGHT'][action[3]]]);
        await sleep(0);
        return result('applied', read());
    } catch (error) {
        return result('rejected: ' + error.message, read());
    }
})()
