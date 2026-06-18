# feishu-gitlab-notify

把 GitLab 项目的 **push / merge request / comment / issue / tag** 事件通过一个 **Cloudflare Worker 中继**推送到飞书群机器人。[`feishu-github-notify`](../feishu-github-notify/) 的 GitLab 版。

- 给 AI agent 用的执行指南：[`SKILL.md`](./SKILL.md)
- 面向用户的上手指南：[`onboarding.md`](./onboarding.md)
- 中继 worker 源码（自包含，无第三方依赖）：[`gitlab-feishu.worker.ts`](./gitlab-feishu.worker.ts)
- 加 webhook 的辅助脚本：[`add-gitlab-hook.sh`](./add-gitlab-hook.sh)

## 架构一句话

```
GitLab(出网 POST, GitLab JSON, X-Gitlab-Token)
  → CF Worker（校验 token → 按 object_kind 转飞书卡片 → HMAC 签名 → POST）
  → open.feishu.cn 机器人 → 飞书群
```

**为什么需要中继**：GitHub 靠 Actions 跑代码；GitLab 的 CI 和 System Hook 都覆盖不到评论/issue，只能用 webhook，而 webhook 发的是 GitLab 格式的原始 JSON，与飞书所需格式不同，必须有个中继做转换+签名。详见 [`SKILL.md`](./SKILL.md) 开头。

## 三步

1. **装 skill**：`npx skills add ferry9303/agent-skills --skill feishu-gitlab-notify -g`
2. **建飞书机器人**（签名校验），拿 URL + secret（可复用 GitHub 那个）
3. **跟 agent 说**："给 `<host>` 上的 `<namespace/project>` 配飞书 GitLab 通知" → agent 部署中继（首次）+ 配 webhook + 验证

## 手动操作（不走 agent）

```bash
# 1. 部署中继（首次，全部项目共用）
#    用 gitlab-feishu.worker.ts 作 worker 入口，wrangler deploy 后记下 URL
#    设 3 个 secret：
openssl rand -hex 32 > .secrets/gitlab-feishu.token.cred           # 目录须 gitignore
printf '%s' "$(cat .secrets/gitlab-feishu.token.cred)" | npx wrangler secret put GITLAB_WEBHOOK_TOKEN -c <cfg>
printf '%s' "$FEISHU_WEBHOOK_URL"  | npx wrangler secret put FEISHU_WEBHOOK_URL  -c <cfg>
printf '%s' "$FEISHU_SIGN_SECRET" | npx wrangler secret put FEISHU_SIGN_SECRET -c <cfg>

# 2. 给项目加 webhook
./add-gitlab-hook.sh <host> <namespace/project> <worker-url> "$(cat .secrets/gitlab-feishu.token.cred)"

# 3. 验证：GitLab 原生 hook test（返回 201 = 投递成功）
glab api --hostname <host> --method POST projects/<id>/hooks/<hook-id>/test/push_events
```

## 覆盖的事件 / 噪音过滤

| 事件 | 卡片 |
|---|---|
| push | 🚀 绿（前 5 commit + diff）；删分支 🗑️ 红 |
| tag_push | 🏷️ 蓝 |
| merge_request | 🔀 open / 🔄 reopen / 💜 merge / 🚫 close / ✅ approved |
| note（评论） | 💬 青（MR `!iid` / Issue `#iid` / Commit） |
| issue | 🐛 open / ✔️ close / 🔄 reopen |

跳过：`*_bot` 账号、空 push（建分支/仅 tag）、draft MR、MR `update`、issue `update`、其它事件（pipeline/job/wiki…）。

## 故障排查

| 现象 | 原因 / 解决 |
|---|---|
| 飞书直连返回 `19021` | 签名错或时间戳偏差——核对 `FEISHU_SIGN_SECRET` |
| 飞书直连返回 `19024` | 机器人开了「关键词校验」——改成「签名校验」，或卡片里含指定关键词 |
| worker 返回 403 | `X-Gitlab-Token` 与 `GITLAB_WEBHOOK_TOKEN` 不一致 |
| GitLab 投递失败 / 群里没卡片 | 收不到评论/issue？确认用的是 **webhook 不是 CI/System Hook**；空仓 push test 会被当空 push 跳过，用真实事件验 |
| `glab auth status` 报 invalid token | 多实例误报——以 `glab api --hostname <host> user` 实际返回为准 |
| 内网 IP 中继收不到 | GitLab 默认拦私网 webhook——管理员在 Admin → Settings → Network → Outbound 放开本地网络；或把中继换成公网 URL |

## 开发 / 本地测试

worker 源码可配合 [wincorp-cf-workers](https://github.com/ferry9303/wincorp-cf-workers) 那套脚手架跑本地回放测试（`npm test`，Node 24 原生跑 `.ts`，喂样例 GitLab payload，纯函数不联网），含签名逐字节对齐 Python 参考值 + handler 鉴权分支。
