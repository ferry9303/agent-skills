# AGENTS.md — agent-skills repo

This repository is a **collection of installable agent skills**, not an
application. If you are an AI agent working in this repo, read this first.

## What's here

- `skills/<name>/SKILL.md` — each is a self-contained, cross-agent skill following
  the open Agent Skills standard. The Markdown body is the authoritative procedure.
- `install.sh` — symlinks (or copies) skills into each agent's skills directory.

## Rules for editing

- **Edit skills here, in `skills/<name>/`** — never edit the installed copies under
  `~/.claude/skills`, `~/.codex/skills`, etc. Those are symlinks back to this repo
  (or copies that `install.sh` overwrites).
- Keep each skill self-contained: a `SKILL.md` with `name` + `description`
  frontmatter, plus any scripts/templates beside it. No cross-skill imports.
- **Never commit secrets.** Webhook URLs, tokens, `*.env` files stay out of the
  repo. Skills reference credentials by env-var name or external file path only.

## To use a skill's capability

Open `skills/<name>/SKILL.md` and follow its procedure. Each skill states what the
user must do manually vs. what you can automate, and any required CLIs (e.g. `gh`).
