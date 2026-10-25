import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest


class EntrypointTests(unittest.TestCase):
    def test_launcher_from_another_cwd_preserves_relative_paths_and_agent_command(self):
        root = Path(__file__).resolve().parents[2]
        arguments = ['--user-id-file', 'relative/.user-id', '--record-jsonl', 'relative/game.jsonl',
                     '--agent', 'bash', 'relative/run.sh', '--custom', 'two words']
        with TemporaryDirectory() as directory:
            cwd = Path(directory)
            binary = cwd / 'bin'
            binary.mkdir()
            uv = binary / 'uv'
            uv.write_text(f'#!{sys.executable}\n' +
                          'import json, os, sys\n' +
                          'print(json.dumps(dict(argv=sys.argv[1:], cwd=os.getcwd(), pythonpath=os.environ["PYTHONPATH"])))\n')
            uv.chmod(0o755)
            environment = dict(os.environ, PATH=str(binary) + os.pathsep + os.environ.get('PATH', ''),
                               PYTHONPATH='existing-pythonpath')
            result = subprocess.run(['bash', str(root / 'run.sh'), *arguments], cwd=cwd,
                                    env=environment, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            self.assertEqual(payload['cwd'], str(cwd))
            self.assertEqual(payload['pythonpath'], str(root) + os.pathsep + 'existing-pythonpath')
            self.assertEqual(payload['argv'], ['run', '--project', str(root), '--no-sync',
                                               'python', '-m', 'browser_agent', *arguments])
