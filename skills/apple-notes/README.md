# apple-notes

Read, search, and write the macOS **Notes** app (备忘录) from any agent — and,
crucially, **extract the images inside a note and actually see them**.

It layers two tools that ship with [`macnotesapp`](https://github.com/RhetTbull/macnotesapp):

- the **`notes` CLI** — fast, non-interactive text read / search / create / edit / delete;
- **`scripts/read_note.py`** (the package's Python API) — the *only* way to pull
  image attachments out to real files, so the agent can then open them with its
  Read/vision tool and OCR / describe / analyze the picture. The CLI can't do this.

## Why this over other Apple Notes skills

Most Apple-Notes skills wrap either AppleScript/JXA or the interactive `memo` TUI,
and stop at text — images come back as empty placeholders. This one closes the
loop: locate a note → dump its text → export every image → read the images. It's
also built around one hard-won fact: **every Note attribute access is a separate
~0.1–0.6s AppleScript round-trip**, so it lists titles (capped) to disambiguate
instead of fetching every field for a huge match set, and operates on one note.

## Setup

```bash
pipx install macnotesapp        # provides the `notes` CLI + Python package
```

The Python API lives in an isolated pipx venv, so run the script with that
interpreter (the skill explains how to locate it):

```
~/.local/pipx/venvs/macnotesapp/bin/python scripts/read_note.py --help
```

First run prompts for macOS Automation permission to control Notes — allow once.

## Quick use

```bash
notes list "关键词"                 # search title+body
notes cat "标题" -m                 # print a note as Markdown
# text + images → manifest of saved files:
~/.local/pipx/venvs/macnotesapp/bin/python scripts/read_note.py \
  --text "distinctive words" --out /tmp/note-export
```

See [`SKILL.md`](./SKILL.md) for the full workflow, flags, and write operations.

macOS only.
