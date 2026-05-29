---
name: feishu-github-notify
description: Configure a GitHub repo to push events (push / PR / review / comment / issue) to a Feishu (Lark) group bot via GitHub Actions. Use when the user says things like "把 GitHub 通知发到飞书", "配置飞书机器人 + GitHub", "GitHub Actions 飞书通知", or sets this up for a new repo.
---

# Feishu × GitHub 通知 Skill

把 GitHub 仓库的 push / PR / review / comment / issue 事件通过 GitHub Actions 推送到飞书群机器人。

## 适用场景

- 用户已经有飞书群（自己的、团队的、项目讨论群）
- 想被动接收某个 GitHub 仓库的活动通知
- 个人 GitHub 账号或 Organization 都适用

## 用户必须自己做的事

机器人创建只能在飞书 App 里手动完成。引导用户走这一遍：

```
飞书群 → 右上角 ⚙️ → 群机器人 → 添加机器人 → 自定义机器人
  ↓
  填名字（如 "GitHub 通知"）→ 下一步
  ↓
  安全设置 → 勾选「签名校验」→ 复制 secret
  ↓
  完成 → 复制 webhook URL（形如 https://open.feishu.cn/open-apis/bot/v2/hook/<uuid>）
```

让用户把 **webhook URL** 和 **sign secret** 都贴出来。如果只贴了 URL 没说签名校验，确认一下是关了还是忘了贴 —— 模板支持两种（没 secret 就跳过签名）。

> 安全提示：webhook URL 本身是凭证，任何拿到的人都能往群里发消息。提醒用户不要把这个 URL 提交到 git。

## 你能代劳的事

在用户给出 webhook URL + secret 后，按顺序执行：

### Step 1 — 验证连通性（必做）

用 Python 计算签名直接 curl 一发到飞书，确认 URL 和 secret 都正确。这一步在写入 secret / 推 workflow 之前做，免得配错了在 Actions 里反复 debug。

```bash
FEISHU_WEBHOOK_URL='<url>' FEISHU_SIGN_SECRET='<secret>' python3 <<'PY'
import os, json, time, hmac, hashlib, base64, urllib.request
ts = str(int(time.time()))
sign = base64.b64encode(hmac.new(
    f"{ts}\n{os.environ['FEISHU_SIGN_SECRET']}".encode(),
    digestmod=hashlib.sha256).digest()).decode()
payload = {
    "timestamp": ts, "sign": sign,
    "msg_type": "interactive",
    "card": {"config": {"wide_screen_mode": True},
             "header": {"title": {"tag": "plain_text", "content": "✅ 连通性测试"},
                        "template": "green"},
             "elements": [{"tag": "markdown", "content": "GitHub → 飞书通道已就绪"}]}}
req = urllib.request.Request(os.environ["FEISHU_WEBHOOK_URL"],
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=10) as r:
    print(r.status, r.read().decode())
PY
```

期望响应：`HTTP 200` + `{"StatusCode":0,...,"msg":"success"}`。

如果失败：
- `19021`/sign error → secret 错了或时间戳偏差
- `19024`/keyword not match → 用户开了关键词校验但模板里没匹配关键词（让用户改成签名校验，或在卡片标题/正文里加上指定关键词）
- HTTP 404 → URL 写错（uuid 错位）

### Step 2 — 检查仓库权限，选择模式

在动手前必须查一下用户对目标仓库的权限：

```bash
gh api repos/<owner>/<repo> --jq '.permissions'
# 关键字段：
#   admin=true  → 完整模式：你可以代用户设置 secret，并 push 验证
#   admin=false → 协作模式：跳过 set secret，只生成文件 + PR 描述，让 repo owner 自己启用
```

并提醒用户：如果目标仓库**不是用户自己的（团队/同事的）**，即使 `push=true`，也要**先和仓库 owner 打招呼**再动 —— 这是别人的 CI 流程。

---

#### Step 2A — 完整模式（admin=true，通常是用户自己的仓库）

```bash
gh secret set FEISHU_WEBHOOK_URL --repo <owner>/<repo> --body "$FEISHU_WEBHOOK_URL"
gh secret set FEISHU_SIGN_SECRET --repo <owner>/<repo> --body "$FEISHU_SIGN_SECRET"
gh secret list --repo <owner>/<repo>  # 确认
```

**个人账号**没有 user-level Actions secret，每个仓库都要单独 set。多仓库批量同步用本目录的 `sync-secrets.sh`。

**Organization** 可以用 `gh secret set --org <org> --visibility selected --repos ...` 一次配齐。

#### Step 2B — 协作模式（admin=false 但有 push 权限）

跳过 secret 设置。workflow 模板自带"secret 缺失则 skip"逻辑（Python 脚本第一段判 `WEBHOOK_URL` 是否为空），所以 workflow 推上去之后即便没 secret 也是 success 状态，**不会污染团队 CI**。然后让 repo owner 在他们方便的时候去 Settings → Secrets 配置启用。

---

### Step 3 — 放置 workflow 文件

把本目录的 `feishu-notify.yml` 复制到目标仓库的 `.github/workflows/feishu-notify.yml`。不需要任何替换 —— secret 名固定为 `FEISHU_WEBHOOK_URL` / `FEISHU_SIGN_SECRET`。

### Step 4 — 提交（推/不推视模式而定）

```bash
git add .github/workflows/feishu-notify.yml
git commit -m "ci: add Feishu webhook notifications for GitHub events"
```

**完整模式**：直接 push 触发首次验证。
- 如果本地 branch 和远端 branch 分叉，**不要强推** —— 开新分支（如 `chore/feishu-notify`）推上去
- `gh run list --branch <branch> --limit 3` 看结果

**协作模式**：**不要擅自 push**。改为：
1. 切到新分支 `chore/feishu-notify`，commit 留在本地
2. 给用户准备一段 PR 描述模板，让他自己 push 后开 PR：

```markdown
## 添加 Feishu 通知 workflow

把 GitHub 事件（push / PR / review / comment / issue）通知到 Feishu 群机器人。

### 启用方式
需要 repo admin 在 Settings → Secrets and variables → Actions 添加：
- `FEISHU_WEBHOOK_URL` (必需) — Feishu 自定义机器人的 webhook URL
- `FEISHU_SIGN_SECRET` (可选) — 若机器人开了签名校验则需要

未配置时 workflow 会安静 skip，不影响其它 CI。
```

3. 让用户自己决定走 PR review 还是直接 push（这是别人的仓库，由 owner 节奏决定）

验证（无论哪种模式）：

```bash
gh run list --repo <owner>/<repo> --branch <branch> --limit 3
gh run view <run-id> --repo <owner>/<repo> --log-failed   # 失败时
```

## 模板说明

`feishu-notify.yml` 已包含：

- 监听事件：`push` / `pull_request` (opened, closed, reopened, ready_for_review) / `pull_request_review` (submitted) / `pull_request_review_comment` (created) / `issues` (opened, closed, reopened) / `issue_comment` (created)
- 卡片风格：紧凑 + emoji（🚀 push / 🔀 PR / ✅ approved / ❌ changes / 💜 merged / 🐛 issue / 💬 comment）+ 跳转按钮
- 噪音过滤：bot user（`[bot]` 后缀、dependabot、renovate、github-actions）、空 push（删分支）、draft PR opened 全部跳过
- Body 预览：PR / Issue / Comment 正文截前 200 字、灰色显示
- 签名可选：没设 `FEISHU_SIGN_SECRET` 也能工作（机器人关了签名校验的场景）
- **未配置时自动 skip**：检测到 `FEISHU_WEBHOOK_URL` 为空，`sys.exit(0)` 直接 success 退出 —— 这是协作模式（admin=false）的关键，避免污染团队 CI

## 已知坑

1. **`${{ github.event_path }}` 不是合法表达式**。GitHub Actions context 里没有这个字段。需要直接读 runner 注入的环境变量 `GITHUB_EVENT_PATH`（模板里已修）。
2. **来自 fork 的 PR 拿不到 secrets**（GitHub 安全限制），`pull_request` 事件在那种情况下会失败。如果仓库接受外部 PR 想收通知，改用 `pull_request_target`（但注意安全风险，不要在 workflow 里 checkout PR 代码再执行任意命令）。
3. **飞书 `lark_md` 不支持 blockquote 和列表语法**。模板用 `<font color='grey'>` 做视觉区分；列表项手动加 `•` 字符。
4. **飞书机器人安全设置有三种**：IP 白名单 / 关键词 / 签名校验。本模板按签名校验实现。关键词模式需要在卡片里包含指定关键词，IP 白名单要求 runner IP 落在白名单内（GitHub Actions IP 范围广，不实用）。

## 推广到多个仓库

用本目录的 `sync-secrets.sh` 一次性把 secret 同步到多个仓库。Workflow 文件可以走两条路：

- **简单粗暴**：把 `feishu-notify.yml` 复制到每个仓库
- **集中管理**：在 `<user>/.github` 仓库里建 reusable workflow（`workflow_call`），其他仓库的 `notify.yml` 只声明 `on:` 触发器并 `uses:` 引用。改样式只需改一处

## 完整的执行清单

```
[ ] 引导用户创建飞书机器人，拿 URL + secret（如已存在则跳过）
[ ] 如有 ~/.config/feishu-bot.env，建议用户 source 后用 env vars，不要把值贴进对话
[ ] gh api repos/<owner>/<repo> --jq '.permissions' 查权限，确定模式
[ ] 如果目标不是用户自己的仓库（团队/同事的），提醒用户先打招呼
[ ] 用 Python + curl 验证 URL + secret 正确（Step 1，仅首次或换机器人）
[ ] [完整模式] gh secret set 写入两个 secret（Step 2A）
[ ] [协作模式] 跳过 secret 设置，准备 PR 描述模板（Step 2B）
[ ] 复制 feishu-notify.yml 到 .github/workflows/（Step 3）
[ ] 确认 push 目标 remote / branch，分叉时开新 branch
[ ] [完整模式] commit + push 触发首次验证（Step 4）
[ ] [协作模式] commit 留在新 branch 本地，不擅自 push，让用户走 PR
[ ] gh run list 确认 workflow success（协作模式下未配置 secret 时也应是 success/skip）
[ ] 让用户在飞书群核对卡片样式（完整模式才有，协作模式要等 secret 配上）
```
