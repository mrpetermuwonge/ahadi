"""
Upload a saved version to GitHub (private repo mrpetermuwonge/ahadi).

Run after make_version.py:   python versioning/push_github.py            (latest version)
                             python versioning/push_github.py 1.30       (a given version)

It copies "Ahadi Versions\\Ahadi vX.Y\\code" into the local clone E:\\peter m\\Project\\Ahadi\\ahadi-github,
commits it as "Ahadi vX.Y – <title>" with the change notes, tags it vX.Y and pushes. Secrets and data never go up:
.env / .env.local, the database (.data), build folders, node_modules and local tool settings are skipped.
"""
import datetime, json, os, shutil, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
REPO = os.path.join(ROOT, 'ahadi-github')
VERS = os.path.join(ROOT, 'Ahadi Versions')
SKIP = {'node_modules', '.next', '.next-e2e', '.data', '.env', '.env.local', '.claude', 'coverage'}


def git(*args, inp=None, env=None):
    r = subprocess.run(['git', *args], cwd=REPO, input=inp, capture_output=True, text=True, encoding='utf8', env=env)
    if r.returncode != 0:
        sys.exit(f'git {" ".join(args)} failed:\n{r.stderr}')
    return r.stdout.strip()


history = json.load(open(os.path.join(ROOT, 'Ahadi Latest', 'versioning', 'history.json'), encoding='utf8'))
v = sys.argv[1] if len(sys.argv) > 1 else history[-1]['version']
h = next((x for x in history if x['version'] == v), None)
src = os.path.join(VERS, f'Ahadi v{v}', 'code')
if not h or not os.path.isdir(src):
    sys.exit(f'version {v} not found (run make_version.py first)')
if f'v{v}' in git('tag').split():
    sys.exit(f'v{v} is already on GitHub')

for n in os.listdir(REPO):
    if n != '.git':
        p = os.path.join(REPO, n)
        shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
for n in os.listdir(src):
    if n in SKIP:
        continue
    s, d = os.path.join(src, n), os.path.join(REPO, n)
    if os.path.isdir(s):
        shutil.copytree(s, d, ignore=lambda _d, names: [x for x in names if x in SKIP])
    else:
        shutil.copy2(s, d)
gi = os.path.join(REPO, '.gitignore')
txt = open(gi, encoding='utf8').read() if os.path.exists(gi) else ''
if '.claude/' not in txt:
    open(gi, 'a', encoding='utf8').write(('' if not txt or txt.endswith('\n') else '\n') + '.claude/\n')

title = h.get('title', '')
msg = f'Ahadi v{v}' + (f' – {title}' if title else '') + '\n\n' + '\n'.join(f'- {c}' for c in h.get('changes', [])) \
    + '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n'
env = dict(os.environ)
try:
    dt = datetime.datetime.strptime(h.get('date', ''), '%d %b %Y').replace(hour=12)
    env['GIT_AUTHOR_DATE'] = env['GIT_COMMITTER_DATE'] = dt.strftime('%Y-%m-%dT%H:%M:%S+03:00')
except ValueError:
    pass
git('add', '-A')
leaked = [f for f in git('diff', '--cached', '--name-only').splitlines() if f.split('/')[0] in SKIP or f.endswith('.env.local')]
if leaked:
    sys.exit(f'refusing to upload: {leaked}')
git('commit', '-q', '-F', '-', inp=msg, env=env)
git('tag', '-a', f'v{v}', '-m', f'Ahadi v{v}' + (f' – {title}' if title else ''))
git('push', 'origin', 'main')
git('push', 'origin', f'v{v}')
print(f'uploaded v{v}: {git("rev-parse", "--short", "HEAD")}')
