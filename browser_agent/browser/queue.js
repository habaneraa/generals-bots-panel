(async () => {
    const read = () => BOARD_READER;
    const enabled = button => button && !button.disabled && !button.classList.contains('disabled');
    const settled = () => !document.querySelector('#gameMap, .page-enter, .page-enter-active, .page-exit, .page-exit-active');
    const wait = (predicate, stage) => new Promise((resolve, reject) => {
        const finish = (value, error) => {
            observer.disconnect();
            clearTimeout(timeout);
            if (error) reject(error); else resolve(value);
        };
        const check = () => {
            try {
                const value = predicate();
                if (value) finish(value);
            } catch (error) {finish(null, error);}
        };
        const observer = new MutationObserver(check);
        const timeout = setTimeout(() => {
            const buttons = [...document.querySelectorAll('button')].map(button =>
                `${button.textContent.trim()}${enabled(button) ? '' : ' [disabled]'}${button.title ? ': ' + button.title : ''}`);
            finish(null, new Error(`Cannot select the 1v1 queue while ${stage}; url=${location.href}; buttons=${JSON.stringify(buttons)}`));
        }, 20000);
        observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true, characterData: true});
        check();
    });
    const board = read();
    if (board && !board.ended) {
        if (board.mode !== '1v1' || board.rules.game_type !== '1v1')
            throw new Error('The current game is not a 1v1 queue match');
        return 'playing';
    }
    if (board?.ended) {
        const exit = await wait(() => [...document.querySelectorAll('button')]
            .find(button => /^(Exit|退出)$/.test(button.textContent.trim()) && enabled(button)), 'waiting for Exit');
        exit.click();
        // The new menu mounts before the old game and its effects are removed.
        await wait(() => settled() && document.querySelector('#play-buttons button.big'), 'returning to the menu');
    }
    const duel = () => [...document.querySelectorAll('.queue-mode-button-row button')]
        .find(button => button.textContent.trim() === '1v1');
    if (!duel()) {
        const start = await wait(() => {
            const button = document.querySelector('#play-buttons button.big');
            return settled() && enabled(button) ? button : null;
        }, 'waiting for PLAY');
        start.click();
    }
    const button = await wait(() => {
        const button = duel();
        return settled() && enabled(button) ? button : null;
    }, 'waiting for the 1v1 button');
    button.click();
    return 'queued';
})()
