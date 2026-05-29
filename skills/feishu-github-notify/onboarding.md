# 🚀 飞书 × GitHub 通知 · 5 分钟上手

把任意 GitHub 仓库的 **push / PR / Review / Comment / Issue** 推送到你的飞书群机器人。

由 Claude Code skill 全程托管，你不用写 yaml，不用调 API，只需要：**创建机器人 + 跟 Claude 说一句话**。

---

## 是什么 / 解决什么

- GitHub 仓库的活动会自动以飞书卡片形式推到指定群
- 每张卡片带 emoji 区分事件类型（🚀 push / 🔀 PR / ✅ approved / 💜 merged / 🐛 issue / 💬 comment）
- 每张卡片底部有跳转按钮，手机上一点就跳到 GitHub
- bot 用户、空 push、draft PR 自动过滤，不刷屏
- **未配置 secret 时 workflow 安静 skip**，可以放心装到团队仓库不污染 CI

适合：
- 想被动接收某个仓库活动的人（不想一直刷 GitHub）
- 团队群想看 push / PR 流水
- 给客户/老板装一个"研发动态"群

---

## 准备工作

| 项目 | 说明 |
|---|---|
| 飞书账号 + 群 | 用来接收通知，建议为每个项目独立建群 |
| GitHub 账号 | 个人账号或 Org 都行 |
| Claude Code | https://claude.ai/code，装好并登录 |
| `gh` CLI | `brew install gh && gh auth login` |

---

## 三步走

### Step 1. 拿到 skill

如果你身边有人（比如 ferry）已经装了这个 skill，复制整个目录到你的 `~/.claude/skills/` 即可：

```
~/.claude/skills/feishu-github-notify/
  ├── SKILL.md       # 给 Claude 看的执行清单
  ├── README.md      # 完整使用教程（推荐先读 §1）
  ├── feishu-notify.yml  # GitHub Actions workflow 模板
  └── sync-secrets.sh    # 批量同步 secret 脚本
```

### Step 2. 创建飞书机器人

在目标群里：**设置 ⚙️ → 群机器人 → 添加机器人 → 自定义机器人**

- 名字随便填（比如 "GitHub 通知"）
- 安全设置勾选 **「签名校验」**
- 记下两个值：**Webhook URL** + **Sign Secret**

建议把这两个值存到本地一个 `chmod 600` 的文件，比如 `~/.config/feishu-bot.env`：

```bash
export FEISHU_WEBHOOK_URL='https://open.feishu.cn/open-apis/bot/v2/hook/...'
export FEISHU_SIGN_SECRET='...'
```

> ⚠️ **Webhook URL 是凭证**，任何人拿到都能往群里发消息。不要提交到任何 git 仓库。

### Step 3. 让 Claude 装上

在 Claude Code 里直接说：

> 帮我给 `<owner>/<repo>` 配置飞书 GitHub 通知

Claude 会自动按 skill 流程做完全部步骤：

1. 检查你对该仓库的权限
2. 用 curl 测一发，验证飞书连通
3. 写入 GitHub repo secret（如果你是 admin）
4. 把 workflow 文件复制到 `.github/workflows/feishu-notify.yml`
5. 切到 `chore/feishu-notify` 新分支，commit + push 触发首次验证

完成后飞书群里会立刻收到一条 "🚀 ... pushed to chore/feishu-notify" 卡片。

---

## 两种模式

Claude 会根据你对仓库的权限自动选：

| 权限 | 模式 | 行为 |
|---|---|---|
| **admin**（你自己的仓库） | 完整模式 | Claude 全程托管：设 secret + push + 验证 |
| **只有 push，不是 admin**（团队/同事仓库） | 协作模式 | 只生成 workflow + PR 描述模板，**不**擅自设 secret 或 push；由 repo admin 自己启用 |

协作模式下 workflow 即便没配 secret 也是 `success`（自动 skip），不会让团队 CI 变红。

---

## 推广到多个仓库

如果你想给一批仓库一起装上，用 skill 自带的批量脚本：

```bash
source ~/.config/feishu-bot.env

# 给指定仓库批量写 secret
~/.claude/skills/feishu-github-notify/sync-secrets.sh \
  myname/repo-a myname/repo-b myname/repo-c

# 或：给你账号下所有非 fork 仓库都装
gh repo list myname --no-archived --source --limit 200 \
  --json nameWithOwner -q '.[].nameWithOwner' \
  | ~/.claude/skills/feishu-github-notify/sync-secrets.sh
```

> 这只同步 secret。Workflow 文件仍需让 Claude 帮每个仓库装一次（重复 Step 3）。

---

## 进一步阅读

- **完整教程 + 故障排查**：`~/.claude/skills/feishu-github-notify/README.md`
- **执行细节 + 已知坑**：`~/.claude/skills/feishu-github-notify/SKILL.md`
- **想改卡片样式 / 加新事件**：编辑 `feishu-notify.yml` 后让 Claude 帮你重推

---

## 一句话总结

> 拿到 skill → 创建机器人 → 跟 Claude 说一句话 → 飞书群开始收到通知。
