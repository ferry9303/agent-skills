# agent-skills

A personal collection of **cross-agent skills**. Each skill is a self-contained
`SKILL.md` + supporting files following the open
[Agent Skills standard](https://agentskills.io) — the *same* folder works in
Claude Code, opencode, Codex, Cursor, Gemini CLI, and other tools that support it.

The format is universal; only the **install location** differs per agent. The
`install.sh` script handles that difference for you.

## Skills

| Skill | What it does |
|---|---|
| [apple-notes](skills/apple-notes/) | Read / search / write the macOS Notes app (备忘录), including extracting a note's image attachments to files so the agent can actually see (OCR / describe) them — text-only skills stop at placeholders. macOS only |
| [feishu-github-notify](skills/feishu-github-notify/) | Wire a GitHub repo's push / PR / review / comment / issue events to a Feishu (Lark) group bot via GitHub Actions |
| [feishu-gitlab-notify](skills/feishu-gitlab-notify/) | Wire a GitLab project's push / MR / comment / issue / tag events to a Feishu (Lark) group bot via a small Cloudflare Worker relay (GitLab counterpart of the above) |

## Install

### Option A — `npx skills add` (no clone needed)

The cross-agent [`skills` CLI](https://github.com/vercel-labs/skills) pulls skills
straight from this repo into whichever agents you have installed — nothing to clone:

```bash
npx skills add ferry9303/agent-skills                              # all skills, pick agents interactively
npx skills add ferry9303/agent-skills --skill feishu-github-notify # just one skill
npx skills add ferry9303/agent-skills --list                       # see what's in the repo first
npx skills add ferry9303/agent-skills -g -a claude-code -a codex   # global install, Claude Code + Codex
```

By default it installs into the current project (`./.claude/skills/` …); pass `-g`
to install globally under your home dir (matching `install.sh`'s footprint), and
`--copy` if your filesystem doesn't support symlinks. Run `npx skills update` later
to pull newer versions.

### Option B — clone + `install.sh` (for editing the skills yourself)

```bash
git clone git@github.com:ferry9303/agent-skills.git ~/Project/agent-skills
cd ~/Project/agent-skills
./install.sh                       # all skills → all installed agents (symlink)
./install.sh feishu-github-notify  # just one skill
./install.sh --copy                # copy instead of symlink
```

Symlink is the default: edit a skill here once, every agent picks it up. Keep the
repo cloned at a stable path (the symlinks point back to it). Use `--copy` on
machines where you won't keep the clone around.

### Where each agent looks

`install.sh` symlinks each skill into all three of these (whichever exist):

| Directory | Used by |
|---|---|
| `~/.claude/skills/` | Claude Code (and opencode, which reads it natively) |
| `~/.codex/skills/` | Codex CLI — restart Codex after installing to reload metadata |
| `~/.agents/skills/` | the cross-agent standard dir several tools honor |

These overlap on purpose — it's the same footprint the `lark-cli` skills installer
uses. Agents dedupe by skill `name`, so a skill in more than one dir is listed once.
`install.sh` only writes into a directory whose parent (the agent's home) already
exists, so it won't create folders for tools you don't have.

## Using a skill in an arbitrary agent

Any agent that reads `AGENTS.md` (Cursor, Jules, Windsurf, …) but doesn't support
the skills mechanism can still use a skill: point it at the skill's `SKILL.md`, or
paste the relevant part into your project's `AGENTS.md`. The instructions are plain
Markdown with no agent-specific assumptions.

## Adding a new skill

1. Create `skills/<new-skill>/SKILL.md` with `name` + `description` frontmatter
2. Drop any scripts / templates / reference docs alongside it
3. `./install.sh <new-skill>`

## Security

These skills never contain secrets. Credentials (e.g. the Feishu webhook) live
outside the repo — see each skill's README. Don't commit `*.env` or webhook URLs.
