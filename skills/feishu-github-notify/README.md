# 飞书 × GitHub 通知使用教程

一份给自己看的上手手册。配合 `feishu-github-notify` skill 用，给任何 GitHub 仓库 5 分钟接好飞书机器人通知。

> 还没装 skill？一行搞定：`npx skills add ferry9303/agent-skills --skill feishu-github-notify -g`
> （其他装法见仓库根 `README.md` 或 `onboarding.md` 的"安装两种方式"）

---

## 1. 一次性准备

只做一次，做完以后所有新仓库都能直接复用。

### 1.1 创建飞书机器人

```
飞书群 → 右上角 ⚙️ → 群机器人 → 添加机器人 → 自定义机器人
  ├─ 名字：GitHub 通知
  ├─ 安全设置：勾选「签名校验」
  └─ 完成后复制两个东西：
       • Webhook URL（https://open.feishu.cn/open-apis/bot/v2/hook/<uuid>）
       • Sign Secret
```

> 建议每个项目（或每个工作场景）单独建一个机器人 + 单独的群，方便后续按需关闭。

### 1.2 把凭证存到本地

凭证存在 `~/.config/feishu-bot.env`（权限已设为 `600`，不会被其他用户读取）：

```bash
# ~/.config/feishu-bot.env
export FEISHU_WEBHOOK_URL='https://open.feishu.cn/open-apis/bot/v2/hook/...'
export FEISHU_SIGN_SECRET='...'
```

**不要把这个文件提交到任何 git 仓库**。`.gitignore` 不在它管辖范围（它在 `~/.config/`），但任何手抖的 `cp` 都可能泄露 —— 别复制到项目目录里。

### 1.3 确认工具齐全

```bash
gh auth status           # 必须已登录到目标 GitHub 账号
gh secret list --repo <owner>/<repo>   # 试一下能看到 secret 列表（即使是空的）
```

---

## 2. 给一个新仓库配通知

在 Claude Code 里直接说一句话就行，skill 会自动触发：

> 帮我给 `ferry9303/my-new-repo` 配置飞书 GitHub 通知

或者显式：

> /feishu-github-notify

Claude 会按这个流程走（你只需要在两个地方介入）：

| 步骤 | 谁做 | 干啥 |
|---|---|---|
| 1 | Claude | 提醒你机器人是否已建（已建直接跳过 1.1） |
| 2 | **你** | 把 webhook URL + secret 贴给 Claude（从 `~/.config/feishu-bot.env` 里复制） |
| 3 | Claude | 用 `curl` 测试连通性，飞书群应当立即收到一条绿色"连通性测试"卡片 |
| 4 | Claude | `gh secret set` 写入两个 secret 到目标仓库 |
| 5 | Claude | 复制 `feishu-notify.yml` 到 `.github/workflows/` 目录 |
| 6 | **你** | 确认推送目标（哪个 remote / 哪个 branch；建议开 `chore/feishu-notify` 新分支） |
| 7 | Claude | commit + push，触发首次 workflow 跑通验证 |

完成后飞书群里会自动收到一条 "🚀 ferry9303 pushed to chore/feishu-notify" 卡片。

---

## 3. 批量同步到多个仓库

如果你想给一批已有仓库都装上（workflow 文件每个仓库自己加，但 secret 可以批量同步）：

```bash
# 加载凭证
source ~/.config/feishu-bot.env

# 给指定仓库批量写 secret
~/.claude/skills/feishu-github-notify/sync-secrets.sh \
  ferry9303/repo-a \
  ferry9303/repo-b \
  ferry9303/repo-c

# 或者：给你账号下所有非 fork 仓库都装
gh repo list ferry9303 --no-archived --source --limit 200 \
  --json nameWithOwner -q '.[].nameWithOwner' \
  | ~/.claude/skills/feishu-github-notify/sync-secrets.sh
```

> 这只同步 secret。Workflow 文件仍要每个仓库各自加（让 Claude 帮你跑第 5、7 步即可），或者把 workflow 抽成 reusable workflow 放在 `ferry9303/.github` 仓库统一管理。

---

## 4. 通知卡片样式速查

| 事件 | Emoji | 颜色 | 触发条件 |
|---|---|---|---|
| push | 🚀 | green | 任何分支收到 push 且有 commit |
| PR opened | 🔀 | blue | 新建非 draft PR |
| PR ready_for_review | 👀 | blue | draft → ready |
| PR reopened | 🔄 | orange | 重开 |
| PR closed (未 merge) | 🚫 | grey | 关闭未合 |
| PR merged | 💜 | purple | merge 成功 |
| Review approved | ✅ | green | approve |
| Review changes_requested | ❌ | red | 要求修改 |
| Review commented | 💬 | blue | 普通 review comment |
| Comment (Issue/PR) | 💬 | turquoise | 评论 |
| Issue opened | 🐛 | orange | 开 issue |
| Issue closed | ✔️ | grey | 关 issue |
| Issue reopened | 🔄 | orange | 重开 issue |

每张卡片底部都有跳转按钮（"Open PR" / "查看 diff" / "Open issue"），手机上点一下就能跳到 GitHub 对应页面。

---

## 5. 自动跳过的"噪音"

下面这些事件不会发通知（设计如此）：

- **Bot 用户的动作**：用户名以 `[bot]` 结尾，或者是 `dependabot` / `renovate` / `github-actions`
- **空 push**：删除分支、tag-only push，没有任何 commit 时
- **Draft PR 的 opened**：草稿 PR 太早期，等转 ready 再通知

要改这些过滤规则，编辑 `~/.claude/skills/feishu-github-notify/feishu-notify.yml` 里的 `should_skip()` 函数。

---

## 6. 故障排查

| 现象 | 可能原因 | 解决 |
|---|---|---|
| Workflow 失败：`FileNotFoundError: ''` | 用了 `${{ github.event_path }}` 表达式 | 改用 `GITHUB_EVENT_PATH` 内置环境变量（模板已修复，自己改的版本要注意） |
| 飞书返回 `19021 sign error` | sign secret 不对，或者机器人时间偏差 | 重新核对 secret，签名计算用的是 `f"{ts}\n{secret}"` 不是反过来 |
| 飞书返回 `19024 keyword not match` | 机器人开了「关键词」校验 | 飞书后台改成「签名校验」（推荐），或者在卡片标题里包含关键词 |
| HTTP 404 | webhook URL 写错 / 机器人被删 | 重新到飞书群机器人设置里复制 |
| PR 来自 fork，workflow 失败拿不到 secret | GitHub 安全机制 | 改用 `pull_request_target` 事件（注意：**别 checkout PR 代码再执行任意命令**，会有代码执行风险） |
| Workflow 一直没触发 | 文件路径不对 | 必须是 `.github/workflows/<name>.yml`，目录名两层都要对 |

查日志：

```bash
gh run list --repo <owner>/<repo> --limit 5
gh run view <run-id> --repo <owner>/<repo> --log-failed
```

---

## 7. 文件清单

```
~/.config/feishu-bot.env                              # 你的凭证（chmod 600）
~/.claude/skills/feishu-github-notify/
  ├── SKILL.md                                        # 给 Claude 看的执行指南
  ├── README.md                                       # 给你看的这份教程
  ├── feishu-notify.yml                               # GitHub Actions workflow 模板
  └── sync-secrets.sh                                 # 批量同步 secret 脚本
```

如果模板调整后想推广到所有装过的仓库，目前需要手动把新 `feishu-notify.yml` 复制过去重 push。要避免这种重复，可以把模板抽成 reusable workflow 放在 `ferry9303/.github` 仓库 —— 需要时让 Claude 帮你迁移即可。
