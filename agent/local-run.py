"""Drawing-host entry point. Reuse bridge environment without exporting secrets."""
import argparse
import fcntl
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent

def run(args, env=None, timeout=1200):
    subprocess.run(args, cwd=ROOT, env=env, check=True, timeout=timeout)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    (ROOT / '.agent-runtime').mkdir(exist_ok=True)
    lock = open(ROOT / '.agent-runtime/local-run.lock', 'a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('Previous local run still active; skipping')
        return
    if args.publish:
        if subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT).strip():
            raise RuntimeError('Working tree is not clean; refusing publication')
        run(['git', 'pull', '--ff-only', 'origin', 'master'])
    pid = subprocess.check_output(['supervisorctl', 'pid', 'oai-image:oai-image_00'], text=True).strip()
    env = os.environ.copy()
    env.update(dict(item.split('=', 1) for item in Path(f'/proc/{pid}/environ').read_bytes().decode().split('\0') if '=' in item))
    (ROOT / 'agent-output').mkdir(exist_ok=True)
    original_head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).strip()
    try:
        run(['node', 'agent/collect-local-bilibili.mjs'], os.environ.copy())
        run(['/root/oai-image/.venv/bin/python', str(ROOT / 'agent/chatgpt-version-research.py'), '--output', str(ROOT / 'agent-output/chatgpt-facts.json')], env)
        run(['node', 'agent/merge-chatgpt-facts.mjs'])
        run(['npm', 'run', 'validate'])
    except Exception:
        if args.publish and subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).strip() == original_head:
            # Publication starts from a verified clean worktree. Only discard
            # this failed run's generated data; keep audit/cache for diagnosis.
            run(['git', 'restore', '--', 'data'])
            run(['git', 'clean', '-fd', '--', 'data/media'])
        raise
    if args.publish:
        run(['git', 'add', '--', 'data/games.json', 'data/media-feed.json', 'data/media'])
        if subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=ROOT).returncode:
            run(['git', 'commit', '-m', 'data: hourly local game research and Bilibili media'])
        run(['git', 'push', 'origin', 'HEAD:master'])
    print('Local game tracker completed; published=' + str(args.publish))

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('Local game tracker failed: ' + type(exc).__name__, file=sys.stderr)
        raise SystemExit(1)
