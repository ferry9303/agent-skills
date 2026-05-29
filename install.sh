#!/usr/bin/env bash
# Install skills from this repo into each agent's skills directory.
#
# WHY THIS SCRIPT EXISTS:
#   SKILL.md is a cross-agent open standard (agentskills.io). The skill *content*
#   is identical for every agent — only the *location* each agent scans differs.
#   This script symlinks (default) each skill into those locations so one edit in
#   this repo updates every agent at once.
#
# USAGE:
#   ./install.sh                       # all skills → all installed agents (symlink)
#   ./install.sh feishu-github-notify  # one skill
#   ./install.sh --copy                # copy instead of symlink (for machines that
#                                      #   won't keep this repo cloned)
#
# Agent skill paths (verified 2026-05):
#   Claude Code : ~/.claude/skills      (also read by opencode)
#   opencode    : ~/.claude/skills      ← covered by the Claude target, no separate entry
#   Codex CLI   : ~/.codex/skills       (CODEX_HOME/skills)
#
# If your Codex build uses the newer cross-standard ~/.agents/skills instead,
# add it to AGENT_DIRS below. (Don't ALSO add ~/.agents/skills for opencode's sake —
# opencode already sees the skill via ~/.claude/skills, and a second copy would make
# it list the skill twice.)

set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SRC="$REPO_DIR/skills"

# Each entry is the skills dir an agent scans. A target is only used if its
# parent (the agent's home dir) already exists, so we never litter dirs for
# agents you don't have installed.
AGENT_DIRS=(
  "$HOME/.claude/skills"   # Claude Code + opencode
  "$HOME/.codex/skills"    # Codex CLI
  # "$HOME/.agents/skills" # uncomment if your Codex uses the .agents/skills convention
)

MODE="link"
SKILLS=()
for arg in "$@"; do
  case "$arg" in
    --copy) MODE="copy" ;;
    --link) MODE="link" ;;
    -*) echo "unknown flag: $arg" >&2; exit 1 ;;
    *)  SKILLS+=("$arg") ;;
  esac
done

# default: every skill in the repo
if [[ ${#SKILLS[@]} -eq 0 ]]; then
  for d in "$SKILLS_SRC"/*/; do SKILLS+=("$(basename "$d")"); done
fi

install_one() {
  local skill="$1" destroot="$2"
  local src="$SKILLS_SRC/$skill"
  [[ -d "$src" ]] || { echo "    skip (no such skill): $skill" >&2; return; }
  local dest="$destroot/$skill"
  if [[ -L "$dest" ]]; then
    rm "$dest"
  elif [[ -e "$dest" ]]; then
    mv "$dest" "$dest.bak.$(date +%s)"
    echo "    backed up existing real dir → $dest.bak.*"
  fi
  if [[ "$MODE" == "link" ]]; then
    ln -sfn "$src" "$dest"; echo "    linked  $dest"
  else
    cp -R "$src" "$dest"; echo "    copied  $dest"
  fi
}

installed_any=0
for destroot in "${AGENT_DIRS[@]}"; do
  agent_home="$(dirname "$destroot")"
  if [[ ! -d "$agent_home" ]]; then
    echo "→ $destroot  (skip — $agent_home not found; agent not installed)"
    continue
  fi
  echo "→ $destroot"
  mkdir -p "$destroot"
  for skill in "${SKILLS[@]}"; do install_one "$skill" "$destroot"; done
  installed_any=1
done

echo
if [[ "$installed_any" -eq 1 ]]; then
  echo "Done (mode: $MODE)."
  echo "opencode reads ~/.claude/skills natively, so it's already covered."
  echo "Codex: restart it so it reloads skill metadata."
else
  echo "No agents found. Install Claude Code / Codex first, then re-run."
fi
