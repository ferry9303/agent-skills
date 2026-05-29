#!/usr/bin/env bash
# Sync FEISHU_WEBHOOK_URL + FEISHU_SIGN_SECRET to multiple GitHub repos.
#
# Usage:
#   1. Source your secrets from somewhere safe (env or a chmod 600 file):
#        export FEISHU_WEBHOOK_URL='https://open.feishu.cn/open-apis/bot/v2/hook/...'
#        export FEISHU_SIGN_SECRET='...'
#   2. Pass repos as args (owner/repo), or pipe them in:
#        ./sync-secrets.sh ferry9303/repo-a ferry9303/repo-b
#        gh repo list ferry9303 --no-archived --source --limit 200 \
#          --json nameWithOwner -q '.[].nameWithOwner' | ./sync-secrets.sh
#
# Requires: gh auth login done once.

set -euo pipefail

: "${FEISHU_WEBHOOK_URL:?FEISHU_WEBHOOK_URL must be set in env}"
: "${FEISHU_SIGN_SECRET:?FEISHU_SIGN_SECRET must be set in env}"

# Gather repo list from args, falling back to stdin
repos=()
if [[ $# -gt 0 ]]; then
  repos=("$@")
elif [[ ! -t 0 ]]; then
  while IFS= read -r line; do
    [[ -n "$line" ]] && repos+=("$line")
  done
fi

if [[ ${#repos[@]} -eq 0 ]]; then
  echo "No repos provided. Pass as args or pipe in." >&2
  exit 1
fi

for repo in "${repos[@]}"; do
  echo "==> $repo"
  gh secret set FEISHU_WEBHOOK_URL --repo "$repo" --body "$FEISHU_WEBHOOK_URL"
  gh secret set FEISHU_SIGN_SECRET --repo "$repo" --body "$FEISHU_SIGN_SECRET"
done

echo
echo "Done. ${#repos[@]} repo(s) updated."
