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
| [feishu-github-notify](skills/feishu-github-notify/) | Wire a GitHub repo's push / PR / review / comment / issue events to a Feishu (Lark) group bot via GitHub Actions |

## Install

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

| Agent | Skills directory | Notes |
|---|---|---|
| Claude Code | `~/.claude/skills/` | |
| opencode | `~/.claude/skills/` | reads Claude's dir natively — covered by the same symlink |
| Codex CLI | `~/.codex/skills/` | restart Codex after installing; some builds use `~/.agents/skills/` |

`install.sh` only writes into an agent's directory if that agent is actually
installed (its home dir exists), so it won't litter folders for tools you don't use.

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
