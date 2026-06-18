---
name: feishu-gitlab-notify
description: Configure a GitLab repo (self-managed or gitlab.com) to push events (push / MR / comment / issue / tag) to a Feishu (Lark) group bot via a small Cloudflare Worker relay. Use when the user says things like "把 GitLab 通知发到飞书", "私有 GitLab 配飞书机器人", "GitLab webhook 飞书通知", or sets this up for a new GitLab project. The GitLab counterpart of feishu-github-notify.
---

# Feishu × GitLab 通知 Skill

把 GitLab 项目的 push / merge request / comment / issue / tag 事件通过一个 **Cloudflare Worker 中继**推送到飞书群机器人。

是 [`feishu-github-notify`](../feishu-github-notify/SKILL.md) 的 GitLab 版。**关键区别**：GitHub 靠 Actions 在 GitHub 跑代码（白嫖执行环境）；GitLab 没有等价物能覆盖全事件，所以必须 **webhook + 一个中继服务**做格式转换。先读完「为什么是这个架构」再动手，否则容易掉进 CI / System Hook 的事件缺失坑。

## 为什么是 webhook + 中继（不是 CI、不是 System Hook）

| 传输方式 | 能否覆盖 评论/issue | 说明 |
|---|---|---|
| GitLab CI (`.gitlab-ci.yml`) | ❌ | CI 只在 push/MR/tag/pipeline 触发，**评论(note)/issue 根本触发不到** |
| **System Hook**（实例级） | ❌ | 只有 push/tag/merge_request/生命周期，**没有 note/issue 事件**（已核实官方文档） |
| **Group Webhook** | ✅ | 全事件，但 **Premium/Ultimate 才有** |
| **Project Webhook** | ✅ | 全事件，**Free/CE 即可** |

所以：
- 要做到跟 GitHub 一样（push/MR/评论/issue 全覆盖）→ **只能用 webhook**。
- **CE/Free → 每个项目配一次 Project webhook**；**Premium+ → 顶层 group 配一个 Group webhook** 覆盖全部。
- Webhook 只是把 GitLab 格式的 JSON POST 出去，飞书要的是另一套带签名的 JSON → 中间**必须有个中继**做转换 + 签名。

```
GitLab(出网 POST, GitLab JSON, X-Gitlab-Token)
   → [CF Worker: 校验 token → 按 object_kind 转飞书卡片 → HMAC 签名 → POST]
   → open.feishu.cn 机器人 → 飞书群
```

### 网络前置（务必先确认）

- GitLab 所在网络要能**出网**到达中继 URL（CF Worker 是公网 HTTPS）；中继要能到达 `open.feishu.cn`。
- 自建 GitLab 即便**不可公网入站**也没关系——整条链路是 GitLab **主动出网**，无需把 GitLab 暴露到公网。
- 若 GitLab **真隔离、完全无出网** → CF Worker 不适用；中继得放进 GitLab 够得着的内网，且只有飞书私有化部署(内网 Lark)时通知才发得出去。
- GitLab **默认禁止 webhook 打本地/私有网段**。中继用公网 `*.workers.dev`/自有域名时无影响；若中继是内网私有 IP，需管理员在 **Admin → Settings → Network → Outbound requests** 勾「Allow requests to the local network from webhooks」。

## 用户必须自己做的事

机器人创建只能在飞书 App 里手动完成（同 GitHub 版，见 [onboarding.md](./onboarding.md)）：

```
飞书群 → ⚙️ → 群机器人 → 添加机器人 → 自定义机器人
  → 填名字（如 "GitLab 通知"）→ 安全设置勾「签名校验」→ 复制 secret
  → 完成 → 复制 webhook URL（https://open.feishu.cn/open-apis/bot/v2/hook/<uuid>）
```

让用户给出 **webhook URL** + **sign secret**（可复用已有的 GitHub 通知机器人/群——卡片带项目名和样式，不会混）。

> 安全：webhook URL 本身是凭证，别提交进 git。建议存 `~/.config/feishu-bot.env`（`chmod 600`），用 `source` 后走 env var，不要把值贴进对话。

## 你能代劳的事

### Step 1 — 验证飞书连通性（必做，仅首次/换机器人）

跟 GitHub 版完全一样，用 Python 算签名直接 curl 一发，确认 URL + secret 正确：

```bash
FEISHU_WEBHOOK_URL='<url>' FEISHU_SIGN_SECRET='<secret>' python3 <<'PY'
import os, json, time, hmac, hashlib, base64, urllib.request
ts = str(int(time.time()))
sign = base64.b64encode(hmac.new(f"{ts}\n{os.environ['FEISHU_SIGN_SECRET']}".encode(),
    digestmod=hashlib.sha256).digest()).decode()
payload = {"timestamp": ts, "sign": sign, "msg_type": "interactive",
  "card": {"config": {"wide_screen_mode": True},
    "header": {"title": {"tag": "plain_text", "content": "✅ 连通性测试"}, "template": "green"},
    "elements": [{"tag": "markdown", "content": "GitLab → 飞书通道已就绪"}]}}
req = urllib.request.Request(os.environ["FEISHU_WEBHOOK_URL"],
    data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=10) as r: print(r.status, r.read().decode())
PY
```

期望 `200` + `{"StatusCode":0,...,"msg":"success"}`。失败：`19021`=签名错/时间戳偏差；`19024`=开了关键词校验但卡片没含关键词；`404`=URL 错。

### Step 2 — 部署中继 Worker（一次性，全部项目共用一个）

中继代码就是本目录的 [`gitlab-feishu.worker.ts`](./gitlab-feishu.worker.ts)。它**自包含、无第三方依赖**（只用 WebCrypto / fetch）。

**已有 `wincorp-cf-workers` 那套脚手架时**（一份共享代码 + 每 target 一个 jsonc）：
1. 把 `gitlab-feishu.worker.ts` 放到 `src/gitlab-feishu.ts`。
2. 建 `workers/gitlab-feishu-dev.jsonc`：`name` / `account_id` / `main: ../src/gitlab-feishu.ts` / `workers_dev: true`。
3. `./scripts/deploy.sh gitlab-feishu-dev`（记下 `*.workers.dev` URL）。

**从零建一个 Worker**：
```bash
npm create cloudflare@latest gitlab-feishu -- --type hello-world --ts --no-deploy
# 用 gitlab-feishu.worker.ts 覆盖 src/index.ts，然后：
npx wrangler deploy
```

**设 3 个 secret**（不要写进 jsonc/vars）：
```bash
# 生成一个随机的 GitLab webhook token（也用于下一步 GitLab 侧）
openssl rand -hex 32 > .secrets/gitlab-feishu.token.cred   # 目录须 gitignore
printf '%s' "$(cat .secrets/gitlab-feishu.token.cred)" | npx wrangler secret put GITLAB_WEBHOOK_TOKEN -c <cfg>
printf '%s' "$FEISHU_WEBHOOK_URL"  | npx wrangler secret put FEISHU_WEBHOOK_URL  -c <cfg>
printf '%s' "$FEISHU_SIGN_SECRET" | npx wrangler secret put FEISHU_SIGN_SECRET -c <cfg>   # 机器人开签名校验才需要
```

> ⚠️ 若仓库里有 S3 专用的 `set-secrets.sh`（建 IAM key 那种），**不要用它**——本 worker 的 secret 手动 `wrangler secret put`。

### Step 3 — 给 GitLab 项目加 webhook

先确认 glab 真能连上目标实例（`glab auth status` 在多实例下会误报"invalid token"——以实际 API 调用为准）：

```bash
glab api --hostname <host> user        # 返回当前用户 JSON 即 OK
```

用本目录的 [`add-gitlab-hook.sh`](./add-gitlab-hook.sh)（或直接 glab api）：

```bash
./add-gitlab-hook.sh <host> <project-id-或-path> <worker-url> "$(cat .secrets/gitlab-feishu.token.cred)"
# 等价于：
glab api --hostname <host> --method POST projects/<id>/hooks \
  -f url="<worker-url>" -f token="<token>" \
  -f push_events=true -f tag_push_events=true -f issues_events=true \
  -f merge_requests_events=true -f note_events=true -f enable_ssl_verification=true
```

要点：
- `token` 必须 = worker 的 `GITLAB_WEBHOOK_TOKEN`（GitLab 把它放 `X-Gitlab-Token` 头，worker 逐字比对）。
- **机密 issue/评论默认不发**（`confidential_*_events` 不开），避免泄密到群。
- 没权限（非己有项目、非 Maintainer+）→ 403，照实报告，让 owner 自己加或在 UI 配（Settings → Webhooks）。
- Premium+ 想一次覆盖整个 group → 把 `projects/<id>/hooks` 换成 `groups/<id>/hooks`。

### Step 4 — 验证

```bash
# A) 直连 worker（证明 部署+密钥+签名+转发）：正确 token 应 feishu success，错 token 应 403
curl -s -X POST "<worker-url>" -H "X-Gitlab-Token: <token>" -H "X-Gitlab-Event: Push Hook" \
  -H "Content-Type: application/json" -d '{"object_kind":"push","user_username":"me","ref":"refs/heads/main","before":"1","after":"2","total_commits_count":1,"project":{"path_with_namespace":"a/b","web_url":"http://x"},"commits":[{"id":"2","message":"test","url":"http://x"}]}'

# B) GitLab 侧投递（证明 GitLab 够得着 worker）：返回 201 即投递成功
glab api --hostname <host> --method POST projects/<id>/hooks/<hook-id>/test/push_events

# C) 真实事件（最干净）：建个 issue 触发 → 删掉
glab api --hostname <host> --method POST projects/<id>/issues -f title="联调测试(可删)"
glab api --hostname <host> --method DELETE projects/<id>/issues/<iid>   # DELETE 不触发 webhook
```

最后让用户肉眼确认飞书群收到卡片（我看不到群）。

## 事件 → 卡片映射（worker 内置）

- push：🚀 绿（列前 5 条 commit + diff 按钮）；删分支 🗑️ 红
- tag_push：🏷️ 蓝
- merge_request：🔀 open / 🔄 reopen / 💜 merge / 🚫 close / ✅ approved
- note（评论）：💬 青（MR `!iid` / Issue `#iid` / Commit）
- issue：🐛 open / ✔️ close / 🔄 reopen
- 噪音过滤：`*_bot` 账号、空 push（建分支/仅 tag）、draft MR、MR `update`、issue `update` → 全跳过
- 其它（pipeline/job/wiki…）静默 200，不通知（想加就在 `buildCard` 的 switch 里补）

## 已知坑（GitLab 特有）

1. **别用 CI 或 System Hook**——都覆盖不到评论/issue（见上文表）。
2. **鉴权机制和 GitHub 不同**：GitLab 用 `X-Gitlab-Token` 头**明文比对**（不是 HMAC 签名）。worker 用常量时间比较。
3. **GitLab 没有独立 review 事件**：审批 = MR `action=approved` + note 事件；不存在 GitHub 那种 `pull_request_review`。
4. **MR `action=update` 极吵**（每次推分支/改标签都触发）→ worker 默认跳过；issue `update` 同理。
5. **飞书 `lark_md` 不支持 blockquote/列表语法** → 用 `<font color='grey'>` 做灰字，列表项手动加 `•`。
6. **飞书签名**：key = `${timestamp}\n${secret}`，对**空消息**做 HMAC-SHA256 再 base64（worker 已实现，有测试逐字节对齐 Python 参考值）。
7. **glab `auth status` 误报**：多实例下某个实例（如 gitlab.com）token 失效会让整体报错并对目标实例显示"invalid token"——以 `glab api --hostname <host> user` 实际返回为准。
8. **GitLab 默认拦私网 webhook**：中继是公网 URL 时无碍；内网 IP 中继需管理员放开 outbound 本地网络。

## 完整执行清单

```
[ ] 引导用户建飞书机器人，拿 URL + secret（可复用 GitHub 那个，同群）
[ ] 确认网络：GitLab 能出网到中继？中继能到 open.feishu.cn？
[ ] 确认 GitLab 版本：CE/Free → per-project webhook；Premium+ → group webhook
[ ] Step 1 Python+curl 验证飞书 URL+secret（仅首次/换机器人）
[ ] Step 2 部署中继 worker（一次性），设 3 个 secret（GITLAB_WEBHOOK_TOKEN 随机生成）
[ ] glab api --hostname <host> user 确认能连上目标实例
[ ] Step 3 给每个目标项目加 webhook（token = GITLAB_WEBHOOK_TOKEN）；非己有项目先打招呼
[ ] Step 4 直连 curl + glab 原生 test + 真实事件 三路验证
[ ] 让用户在飞书群肉眼核对卡片样式
```
