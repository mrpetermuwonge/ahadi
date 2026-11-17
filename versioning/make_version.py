"""
Ahadi version snapshots.

Every change to the app becomes a numbered version folder:

    <Ahadi folder>/Ahadi Versions/Ahadi v1.12/
        CHANGES.md          this version's changes first, then every earlier version, each clearly labelled
        CHANGES.pdf
        Demo Accounts.md    the demo accounts as they are in this version
        Demo Accounts.pdf
        code/               the full source code of this version (without installed packages or local data)

The running app always stays in "<Ahadi folder>/Ahadi Latest".

How to cut a new version (after a change is finished):
    1. Add an entry at the end of versioning/history.json (version, date, title, changes).
    2. Update "<Ahadi folder>/Demo Accounts.md" if the demo data or login steps changed.
    3. Run:  python versioning/make_version.py
"""
import argparse
import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent          # .../Ahadi/Ahadi Latest
ROOT = PROJECT.parent                                      # .../Ahadi
VERSIONS = ROOT / 'Ahadi Versions'
EXCLUDE_DIRS = {'.next-e2e', 'node_modules', '.next', '.data', '.git', '__pycache__'}
EXCLUDE_FILES = {'.env.local', '.env'}
EXCLUDE_SUFFIXES = {'.tsbuildinfo'}


def load_history():
    return json.loads((PROJECT / 'versioning' / 'history.json').read_text(encoding='utf8'))


# ---------------------------------------------------------------- CHANGES.md

def changes_markdown(history, version):
    """This version's changes first; every earlier version follows, clearly marked with the version it came from."""
    idx = next(i for i, h in enumerate(history) if h['version'] == version)
    cur = history[idx]
    out = [
        f"# Ahadi v{cur['version']} – Changes",
        '',
        f"*{cur['date']} · {cur['title']}*",
        '',
        f"## Latest changes in this version (v{cur['version']})",
        '',
    ]
    out += [f"- {c}" for c in cur['changes']]
    if not cur.get('code_saved', True):
        out += ['', '> The code of this version was not preserved: version folders started after it was built. '
                     'Only the change notes and demo accounts were recreated.']
    earlier = list(reversed(history[:idx]))
    if earlier:
        out += ['', '---', '', '## Earlier versions (for reference)', '',
                'Each section below happened in an earlier version, shown newest first.', '']
        for h in earlier:
            out += [
                f"<!-- Changes made in v{h['version']} ({h['date']}) -->",
                f"### v{h['version']} · {h['date']} · {h['title']}",
                '',
                f"> Happened in **v{h['version']}**, not in this version.",
                '',
            ]
            out += [f"- {c}" for c in h['changes']]
            out += [f"<!-- End of v{h['version']} -->", '']
    return '\n'.join(out).rstrip() + '\n'


# ---------------------------------------------------------------- Markdown → HTML → PDF

def _inline(text):
    t = html.escape(text, quote=False)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'(?<![*\w])\*([^*]+)\*(?!\w)', r'<i>\1</i>', t)
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', t)
    return t


def markdown_to_html(md, title):
    lines = md.splitlines()
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if not s:
            i += 1
            continue
        if s.startswith('<!--'):
            out.append(s)
            i += 1
            continue
        m = re.match(r'^(#{1,6})\s+(.*)$', s)
        if m:
            n = len(m.group(1))
            out.append(f'<h{n}>{_inline(m.group(2))}</h{n}>')
            i += 1
            continue
        if s == '---':
            out.append('<hr>')
            i += 1
            continue
        if s.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')])
                i += 1
            head, body = rows[0], [r for r in rows[1:] if not all(re.fullmatch(r':?-{2,}:?', c) for c in r)]
            out.append('<table><thead><tr>' + ''.join(f'<th>{_inline(c)}</th>' for c in head) + '</tr></thead><tbody>'
                       + ''.join('<tr>' + ''.join(f'<td>{_inline(c)}</td>' for c in r) + '</tr>' for r in body) + '</tbody></table>')
            continue
        if s.startswith('>'):
            buf = []
            while i < len(lines) and lines[i].strip().startswith('>'):
                buf.append(lines[i].strip()[1:].strip())
                i += 1
            out.append('<blockquote>' + _inline(' '.join(buf)) + '</blockquote>')
            continue
        if re.match(r'^(\s*)([-*]|\d+\.)\s+', line):
            ordered = bool(re.match(r'^\s*\d+\.', line))
            tag = 'ol' if ordered else 'ul'
            items = []
            while i < len(lines) and re.match(r'^(\s*)([-*]|\d+\.)\s+', lines[i]):
                indent = len(lines[i]) - len(lines[i].lstrip())
                text = re.sub(r'^\s*([-*]|\d+\.)\s+', '', lines[i])
                items.append((indent, text))
                i += 1
            html_items, open_sub = [], False
            for indent, text in items:
                if indent >= 2 and html_items:
                    if not open_sub:
                        html_items[-1] = html_items[-1][:-5] + '<ul>'
                        open_sub = True
                    html_items[-1] += f'<li>{_inline(text)}</li>'
                else:
                    if open_sub:
                        html_items[-1] += '</ul></li>'
                        open_sub = False
                    html_items.append(f'<li>{_inline(text)}</li>')
            if open_sub:
                html_items[-1] += '</ul></li>'
            out.append(f'<{tag}>' + ''.join(html_items) + f'</{tag}>')
            continue
        buf = []
        while i < len(lines) and lines[i].strip() and not re.match(r'^(#|\||>|---|<!--|\s*([-*]|\d+\.)\s)', lines[i].strip()):
            buf.append(lines[i].strip())
            i += 1
        out.append('<p>' + _inline(' '.join(buf)) + '</p>')
    css = """
      @page { size: A4; margin: 16mm 14mm; }
      body { font-family: 'Segoe UI', Roboto, Arial, sans-serif; color: #18211F; font-size: 11pt; line-height: 1.45; }
      h1 { color: #0D5C54; font-size: 22pt; margin: 0 0 4px; }
      h2 { color: #0D5C54; font-size: 15pt; margin-top: 18px; border-bottom: 2px solid #E4E0D8; padding-bottom: 3px; }
      h3 { font-size: 12pt; margin: 16px 0 4px; }
      table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 10pt; }
      th, td { border: 1px solid #E4E0D8; padding: 5px 7px; text-align: left; vertical-align: top; }
      th { background: #E0F2EF; }
      blockquote { margin: 6px 0; padding: 6px 10px; background: #FCF3DE; border-left: 4px solid #D69E2E; }
      code { background: #F1EEE8; padding: 0 3px; border-radius: 3px; font-size: 9.5pt; }
      hr { border: 0; border-top: 1px solid #E4E0D8; margin: 16px 0; }
      li { margin: 2px 0; }
      .brand { color: #0D5C54; font-weight: 800; font-size: 13pt; margin-bottom: 10px; }
    """
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>{html.escape(title)}</title><style>{css}</style></head>'
            f'<body><div class="brand">Ahadi</div>' + '\n'.join(out) + '</body></html>')


def find_edge():
    for p in [r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', r'C:\Program Files\Microsoft\Edge\Application\msedge.exe']:
        if Path(p).exists():
            return p
    return shutil.which('msedge') or shutil.which('chrome') or shutil.which('google-chrome')


def markdown_to_pdf(md_path: Path, pdf_path: Path, title: str):
    browser = find_edge()
    if not browser:
        print(f'  ! no Edge/Chrome found, skipped {pdf_path.name}')
        return
    # Edge can hand back control before it has finished writing the PDF, so wait for the file to settle.
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        tmp = Path(tmp)
        page = tmp / 'doc.html'
        page.write_text(markdown_to_html(md_path.read_text(encoding='utf8'), title), encoding='utf8')
        out = tmp / 'doc.pdf'
        subprocess.run([browser, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', f'--user-data-dir={tmp / "profile"}',
                        f'--print-to-pdf={out}', page.as_uri()], check=False, timeout=120,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        last = -1
        for _ in range(60):  # up to 30 seconds
            size = out.stat().st_size if out.exists() else -1
            if size > 0 and size == last:
                break
            last = size
            time.sleep(0.5)
        if out.exists() and out.stat().st_size > 0:
            shutil.copyfile(out, pdf_path)
        else:
            print(f'  ! PDF not produced for {pdf_path.name}')


# ---------------------------------------------------------------- snapshot

def copy_code(dest: Path):
    def ignore(dirpath, names):
        return [n for n in names if n in EXCLUDE_DIRS or n in EXCLUDE_FILES or Path(n).suffix in EXCLUDE_SUFFIXES]
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(PROJECT, dest, ignore=ignore)


def make_version(version=None, demo_md=None, with_code=True):
    history = load_history()
    version = version or history[-1]['version']
    entry = next(h for h in history if h['version'] == version)
    folder = VERSIONS / f'Ahadi v{version}'
    folder.mkdir(parents=True, exist_ok=True)
    print(f'Ahadi v{version} -> {folder}')

    changes = folder / 'CHANGES.md'
    changes.write_text(changes_markdown(history, version), encoding='utf8')
    markdown_to_pdf(changes, folder / 'CHANGES.pdf', f'Ahadi v{version} – Changes')

    demo_src = Path(demo_md) if demo_md else ROOT / 'Demo Accounts.md'
    demo = folder / 'Demo Accounts.md'
    if demo_src.resolve() != demo.resolve():
        shutil.copyfile(demo_src, demo)
    markdown_to_pdf(demo, folder / 'Demo Accounts.pdf', f'Ahadi v{version} – Demo Accounts')

    if with_code and entry.get('code_saved', True):
        copy_code(folder / 'code')
        print('  code copied (run "npm install" inside code/ to use it)')
    elif not (folder / 'code').exists():
        (folder / 'CODE NOT PRESERVED.txt').write_text(
            f'The source code of Ahadi v{version} was not kept: version folders started at v1.12.\n'
            'CHANGES.md and Demo Accounts.md describe this version. Every version from v1.12 on includes its code.\n',
            encoding='utf8')
    print('  done')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Create the Ahadi version folder for a version in history.json')
    ap.add_argument('--version', help='e.g. 1.13 (default: the last entry in history.json)')
    ap.add_argument('--demo', help='Markdown file to use as this version\'s Demo Accounts (default: <Ahadi>/Demo Accounts.md)')
    ap.add_argument('--no-code', action='store_true', help='do not copy the source code')
    a = ap.parse_args()
    make_version(a.version, a.demo, not a.no_code)
    sys.exit(0)
