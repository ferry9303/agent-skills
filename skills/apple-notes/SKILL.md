---
name: apple-notes
description: >-
  Read, search, and write macOS Apple Notes — including extracting and actually
  *seeing* the images inside a note. Use this whenever the user wants to read /
  open / search / summarize / OCR a note from Apple Notes (备忘录), pull text or
  pictures out of a note, or create / edit / delete notes. Trigger even when the
  user just says things like "read my note about X", "what's in that 备忘录",
  "grab the screenshot from my note", or "save this to Apple Notes" — anything
  touching the macOS Notes app. macOS only.
---

# Apple Notes

Read and write the macOS Notes app from the terminal. Two layers, used together:

- **`notes` CLI** (from `macnotesapp`) — text read/search and all writes. Fast,
  non-interactive.
- **`scripts/read_note.py`** (Python API) — the *only* way to extract image
  attachments to real files, so they can then be opened with the Read tool and
  read visually (OCR / describe / analyze). The CLI cannot export images.

## Prerequisites

- macOS with Notes.app, and `macnotesapp` installed (`pipx install macnotesapp`).
- First run triggers a macOS "Automation" permission prompt to control Notes —
  the user must click Allow once.
- **Python path:** the package lives in an isolated pipx venv; the system
  `python3` cannot import it. Use the bundled interpreter:
  ```
  ~/.local/pipx/venvs/macnotesapp/bin/python
  ```
  If that path doesn't exist, find it:
  `pipx environment --value PIPX_LOCAL_VENVS` → append `/macnotesapp/bin/python`.

## Performance — read this first

Every attribute access on a note (`.name`, `.folder`, `.attachments`, …) is a
separate AppleScript round-trip (~0.1–0.6s each). A broad query that matches
hundreds of notes will crawl if you touch every field. So: **narrow the query
first, then operate on one note.** `read_note.py` is built around this — it
never fetches every field for a big match set; it lists titles (capped) and asks
you to narrow. Reads from the CLI are faster because they go through the notes
SQLite store; writes go through AppleScript and take ~1–2s each.

## Reading TEXT only

When the user just wants the words, the CLI is enough:

```bash
notes list "关键词"            # search title+body, returns a table of matches
notes list "关键词" -a iCloud  # limit to an account
notes cat "笔记标题" -m        # print as Markdown   (-p plain, -h HTML, -j JSON)
```

`notes cat` matches by exact title. If several notes share a title, prefer the
image workflow below (it can disambiguate by index) or `notes list` to scope.

## Reading a note WITH its images

This is the headline capability. Run the export script, then Read the images it
saved.

**Step 1 — export text + images to a folder:**
```bash
~/.local/pipx/venvs/macnotesapp/bin/python <skill-dir>/scripts/read_note.py \
  --text "distinctive words from the note" --out /tmp/note-export
```
Locate the note with whichever is most specific:
`--name "Title"` (title substring), `--exact` (title equals --name exactly),
`--text "words"` (full-text substring), or `--id "x-coredata://…"`.

The script prints a JSON manifest. Three shapes:
- **One match** → it exports. `exported[].text_file` is the text; `exported[].images[]`
  lists each saved image `path`; `inline_image_placeholders` counts the `￼`
  markers in the text (where images sit relative to the words).
- **Several matches** → `{"matches":[{index,name}…], "ambiguous":true}`. Re-run
  with `--index N` to pick one, `--exact` to pin the title, or a narrower `--text`.
- **No match** → `{"matches":[], "total":0}`.

Useful flags: `--list-only` (just show titles, export nothing), `--index N`
(pick the Nth match), `--all --limit N` (export several matches).

**Step 2 — read the images visually:** open each `images[].path` with the Read
tool. Now you can describe, OCR, or analyze what's actually in the picture.
`text.md` holds the words; the `￼` placeholders mark where each image appeared.

### Worked example

> User: "read my todo note, there are some screenshots in it"

```bash
PY=~/.local/pipx/venvs/macnotesapp/bin/python
$PY <skill-dir>/scripts/read_note.py --name "todo" --exact --out /tmp/todo-note
```
If that reports `ambiguous` (several notes titled "todo"), re-run with `--index 0`
(or narrow by `--text`). On success the manifest gives `text.md` + e.g. four
`Pasted Graphic N.png`. Read `text.md`, then Read each PNG and tell the user
what's in them.

## Writing notes

All writes go through the CLI (non-interactive, safe to script):

```bash
notes add --title "标题" --body "正文"          # create (--body accepts HTML)
echo "正文内容" | notes add --title "标题"        # create from stdin
notes edit "标题"                                # replace an existing note's body
notes delete "标题"                              # delete by exact title
notes mkdir "文件夹" ; notes move "标题" "文件夹"  # organize
notes rename "旧标题" "新标题"
```

Writes are not easily reversible (a `delete` is gone, an `edit` overwrites the
body). Confirm with the user before deleting or editing existing notes, and
prefer creating a new note over overwriting one you didn't create.

## Notes & limits

- macOS only; needs the native Notes.app and Automation permission.
- Password-protected (locked) notes return empty text/attachments until unlocked
  in the app; the manifest flags them as `"locked": true`.
- Image extraction is Python-API-only — there is no `notes` CLI command for it.
- The same `notes` commands can be pasted into a Codex `AGENTS.md` to reuse this
  on other agents; only the image-export script depends on the Python API.
