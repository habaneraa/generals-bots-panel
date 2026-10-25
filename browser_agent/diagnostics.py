"""Core console messages and detailed per-run diagnostics."""

from contextlib import contextmanager
from datetime import datetime
import logging
from pathlib import Path
import sys


logger = logging.getLogger('browser_agent')


@contextmanager
def session_log():
    directory = Path(__file__).parent / 'logs'
    directory.mkdir(exist_ok=True)
    path = directory / f'{datetime.now():%Y%m%d-%H%M%S-%f}.log'
    detail = logging.FileHandler(path, encoding='utf-8')
    detail.setLevel(logging.DEBUG)
    detail.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
    console = logging.StreamHandler(sys.stderr)
    console.setLevel(logging.INFO)
    console.setFormatter(logging.Formatter('%(message)s'))
    previous_level, previous_propagate = logger.level, logger.propagate
    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    logger.addHandler(detail)
    logger.addHandler(console)
    try:
        logger.info('Detailed log: %s', path)
        yield path
    except KeyboardInterrupt:
        logger.info('Stopped by user.')
        raise
    except Exception:
        logger.debug('Browser bridge failed', exc_info=True)
        raise
    finally:
        for handler in (detail, console):
            logger.removeHandler(handler)
            handler.close()
        logger.setLevel(previous_level)
        logger.propagate = previous_propagate


def diagnostic_stream():
    """Send subprocess diagnostics to the current run's file, if configured."""
    return next((handler.stream for handler in logger.handlers
                 if isinstance(handler, logging.FileHandler)), None)
