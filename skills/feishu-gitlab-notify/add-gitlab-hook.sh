#!/usr/bin/env bash
# 给一个 GitLab 项目添加飞书通知 webhook（经 glab）。
#   ./add-gitlab-hook.sh <host> <project-id-或-path> <worker-url> <gitlab-webhook-token>
#
# 例：
#   ./add-gitlab-hook.sh gitlab.example.com mygroup/myrepo \
#       https://<your-relay-worker>.<your-account>.workers.dev \
#       "$(cat .secrets/gitlab-feishu.token.cred)"
#
# token 必须与中继 worker 的 GITLAB_WEBHOOK_TOKEN 一致（GitLab 放进 X-Gitlab-Token 头）。
# project 可传数字 id 或 namespace/path（含 / 会自动 URL 编码）。
# Premium+ 想覆盖整个 group：把下面的 projects/<id> 换成 groups/<id>。
set -euo pipefail

host="${1:?usage: $0 <host> <project-id-or-path> <worker-url> <token>}"
project="${2:?need project id or path}"
url="${3:?need worker url}"
token="${4:?need gitlab webhook token}"

# namespace/path 需 URL 编码（数字 id 原样通过）
proj_enc=$(printf '%s' "$project" | sed 's:/:%2F:g')

glab api --hostname "$host" --method POST "projects/${proj_enc}/hooks" \
  -f url="$url" \
  -f token="$token" \
  -f push_events=true \
  -f tag_push_events=true \
  -f issues_events=true \
  -f merge_requests_events=true \
  -f note_events=true \
  -f enable_ssl_verification=true

echo "✓ hook added to ${project} on ${host}"
