// Wake on client updates; render frames also catch Canvas/local queue changes.
(request => new Promise((resolve, reject) => {
    const status = () => BOARD_STATUS_READER;
    const read = () => BOARD_READER;
    let done = false, frame = null, timeout = null, store = null, unsubscribe = null;
    const finish = (board, error) => {
        if (done) return;
        done = true;
        observer.disconnect();
        if (unsubscribe) unsubscribe();
        if (frame !== null) cancelAnimationFrame(frame);
        clearTimeout(timeout);
        if (error) reject(error); else resolve(board);
    };
    const check = () => {
        if (done) return;
        try {
            const board = status();
            if (board?.store !== store) {
                if (unsubscribe) unsubscribe();
                store = board?.store;
                unsubscribe = store?.subscribe(check) || null;
            }
            if (request.last_turn === null) {
                if (board && !board.ended && board.height && board.width) {
                    const observation = read();
                    if (observation) finish(observation);
                }
                return;
            }
            if (!board || board.ended) {finish(read()); return;}
            const identity = [board.game_id, board.player_id, board.height, board.width];
            if ((request.identity && identity.some((value, i) => value !== request.identity[i])) ||
                board.turn < request.last_turn ||
                (board.turn > request.last_turn && !board.queued_moves)) {
                const observation = read();
                if (observation) finish(observation);
            }
        } catch (error) {finish(null, error);}
    };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true, characterData: true});
    timeout = setTimeout(() => request.last_turn === null ? finish(null) :
        finish(null, new Error('Timed out waiting for a new turn with an empty move queue')), 40000);
    const tick = () => {
        frame = null;
        check();
        if (!done) frame = requestAnimationFrame(tick);
    };
    check();
    if (!done) frame = requestAnimationFrame(tick);
}))(WAIT_REQUEST)
