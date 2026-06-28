#!/usr/bin/env python3
"""Locate an Apple Note and export its text + image attachments to a folder.

Why this exists: the `notes` CLI prints text but cannot extract image
attachments. The macnotesapp Python API can (`attachment.save(dir)`), so the
agent can then open the saved PNG/JPG with the Read tool and actually *see* the
image content (OCR, describe, analyze).

PERFORMANCE NOTE (important): every attribute access on a Note
(`.name`, `.folder`, `.attachments`, ...) is a separate AppleScript round-trip
(~0.1-0.6s each). So this script is careful to touch as few notes/attributes as
possible: when several notes match, it lists only their titles (capped) instead
of fetching every field for every match. Narrow with --exact / a more specific
--name / --text, then export the one you want.

Run with the macnotesapp-bundled Python (it lives in an isolated pipx venv, so
the system python3 cannot import macnotesapp). The skill documents the path.

Output: a JSON manifest on stdout describing what was written, so the caller
knows which files to Read next.
"""
import argparse
import json
import os
import re
import sys
import tempfile

LIST_CAP = 30  # max titles to fetch when disambiguating (each is an AppleScript call)

try:
    from macnotesapp import NotesApp
except ImportError:
    sys.exit(
        "macnotesapp not importable. Run this with the pipx-bundled python, e.g.\n"
        "  ~/.local/pipx/venvs/macnotesapp/bin/python read_note.py ...\n"
        "Find it with: pipx environment --value PIPX_LOCAL_VENVS  (then /macnotesapp/bin/python)"
    )


def safe(name: str) -> str:
    name = (name or "untitled").strip() or "untitled"
    return re.sub(r"[^\w一-鿿 .-]", "_", name)[:80]


def light_list(notes):
    """Titles only, capped. Touches just .name (cheapest field) and never the
    slow .folder/.account/.attachments for the whole set."""
    shown = [{"index": i, "name": n.name} for i, n in enumerate(notes[:LIST_CAP])]
    return {"matches": shown, "total": len(notes),
            "truncated": len(notes) > LIST_CAP}


def export_note(idx, n, out_root, single):
    sub = out_root if single else os.path.join(out_root, f"{idx}-{safe(n.name)}")
    os.makedirs(sub, exist_ok=True)

    text = n.plaintext or ""
    text_file = os.path.join(sub, "text.md")
    with open(text_file, "w") as f:
        f.write(text)

    images, others = [], []
    try:
        attachments = n.attachments
    except Exception:
        attachments = []
    for a in attachments:
        try:
            path = a.save(sub)
        except Exception as e:
            others.append({"name": getattr(a, "name", None), "error": str(e)})
            continue
        ext = os.path.splitext(path)[1].lower().lstrip(".")
        entry = {"name": a.name, "path": path, "ext": ext}
        is_img = ext in {"png", "jpg", "jpeg", "gif", "heic", "webp", "tiff"}
        (images if is_img else others).append(entry)

    return {
        "index": idx,
        "name": n.name,
        "folder": n.folder,
        "account": n.account,
        "locked": bool(getattr(n, "password_protected", False)),
        "text_file": text_file,
        "text_chars": len(text),
        "inline_image_placeholders": text.count("￼"),  # ￼ marks where images sit
        "images": images,
        "other_attachments": others,
    }


def main():
    ap = argparse.ArgumentParser(description="Export an Apple Note's text + images.")
    ap.add_argument("--name", action="append", help="filter by title substring (repeatable)")
    ap.add_argument("--text", action="append", help="filter by full-text substring (repeatable)")
    ap.add_argument("--id", dest="note_id", action="append", help="filter by note id (repeatable)")
    ap.add_argument("--account", action="append", help="limit to account(s)")
    ap.add_argument("--exact", action="store_true",
                    help="keep only notes whose title exactly equals --name (case-insensitive)")
    ap.add_argument("--index", type=int, help="when several match, pick this one (0-based)")
    ap.add_argument("--all", action="store_true", help="export every match (capped by --limit)")
    ap.add_argument("--limit", type=int, default=10, help="max notes to export with --all")
    ap.add_argument("--list-only", action="store_true", help="only list matching titles, export nothing")
    ap.add_argument("--out", help="output dir (default: a fresh temp dir)")
    args = ap.parse_args()

    if not any([args.name, args.text, args.note_id]):
        sys.exit("Provide at least one of --name / --text / --id to locate the note.")

    app = NotesApp()
    notes = app.notes(name=args.name, text=args.text, id=args.note_id, accounts=args.account)

    if args.exact and args.name:
        wanted = {s.lower() for s in args.name}
        notes = [n for n in notes if n.name.lower() in wanted]

    if not notes:
        print(json.dumps({"matches": [], "total": 0, "exported": []}, ensure_ascii=False))
        return

    if args.list_only:
        print(json.dumps({**light_list(notes), "exported": []}, ensure_ascii=False, indent=2))
        return

    # Decide which notes to export, avoiding any whole-set attribute fetch.
    if args.all:
        targets = list(enumerate(notes[:args.limit]))
    elif args.index is not None:
        targets = [(args.index, notes[args.index])]
    elif len(notes) == 1:
        targets = [(0, notes[0])]
    else:
        # Ambiguous: don't guess and don't fetch every field. Show titles so the
        # caller can re-run with --index, --exact, or a narrower query.
        print(json.dumps({**light_list(notes), "ambiguous": True, "exported": []},
                         ensure_ascii=False, indent=2))
        return

    out_root = args.out or tempfile.mkdtemp(prefix="applenote-")
    os.makedirs(out_root, exist_ok=True)
    single = len(targets) == 1

    exported = [export_note(idx, n, out_root, single) for idx, n in targets]

    result = {"out_dir": out_root, "exported": exported}
    if args.all and len(notes) > args.limit:
        result["truncated"] = True
        result["total_matched"] = len(notes)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
