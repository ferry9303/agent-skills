# 🚀 飞书 × GitLab 通知 · 上手指南

把任意 GitLab 项目（自建实例或 gitlab.com）的 **push / Merge Request / Comment / Issue / Tag** 推送到你的飞书群机器人。

由一个 **跨 agent 的 skill** 全程托管 —— 在 Claude Code、Codex、opencode 里都能用。你不用写代码、不用调 API，只需要：**装好 skill + 创建机器人 + 跟你的 AI agent 说一句话**。

> 这是 [飞书 × GitHub 通知](https://github.com/ferry9303/agent-skills) 的 GitLab 版。和 GitHub 版最大的不同：GitLab 需要一个**一次性部署的中继**（一个极小的 Cloudflare Worker），之后给任意项目加通知都只是配一个 webhook。

---

## 是什么 / 解决什么

- GitLab 项目的活动会自动以飞书卡片形式推到指定群
- 每张卡片带 emoji 区分事件类型（🚀 push / 🗑️ 删分支 / 🔀 MR / 💜 merged / ✅ approved / 🐛 issue / 💬 comment / 🏷️ tag）
- 每张卡片底部有跳转按钮，手机上一点就跳到 GitLab
- `*_bot` 账号、空 push、draft MR、MR/issue 的 update 噪音自动过滤，不刷屏
- **机密 issue / 机密评论默认不发**，不会把内部内容泄到群

适合：

- 想被动接收私有 GitLab 项目活动的人（不想一直刷 GitLab）
- 团队群想看 push / MR 流水
- 自建 GitLab 在内网、不可公网入站，但又想要群通知

---

## 为什么 GitLab 要多一个"中继"

GitHub 那套靠 GitHub Actions 在 GitHub 上跑代码，白嫖了执行环境。GitLab 没有等价物能覆盖全部事件：

- **GitLab CI** 只在 push/MR/tag/pipeline 触发，**收不到评论和 issue**；
- **System Hook**（实例级）也**没有评论/issue 事件**。

所以要做到"和 GitHub 一样"，**只能用 webhook**。而 webhook 只是把 GitLab 格式的 JSON 发出去，飞书要的是另一套带签名的格式 —— 中间需要一个**中继**做转换。这个中继就是一个巴掌大的 Cloudflare Worker，**部署一次，所有项目共用**。

```
GitLab(出网 POST) → [CF Worker 转换+签名] → 飞书机器人 → 飞书群
```

自建 GitLab 即便**不可公网入站**也没关系 —— 整条链路是 GitLab 主动往外发，不需要把 GitLab 暴露到公网，只要它能出网即可。

---

## 准备工作

| 项目 | 说明 |
|---|---|
| 飞书账号 + 群 | 用来接收通知；可复用已有的 GitHub 通知群/机器人 |
| GitLab | 自建实例或 gitlab.com 私有项目均可；CE/Free 也行 |
| Cloudflare 账号 | 跑中继 Worker（免费额度足够）；`wrangler` 已登录 |
| AI agent | Claude Code / Codex CLI / opencode 任一即可 |
| `glab` CLI | `brew install glab`，并 `glab auth login` 到你的 GitLab 实例 |

> CE/Free 是**每个项目**配一次 webhook；Premium/Ultimate 可在顶层 group 配一次覆盖全部。

---

## 三步走

### Step 1. 安装 skill（跨 agent，一次搞定）

```bash
npx skills add ferry9303/agent-skills --skill feishu-gitlab-notify -g
```

> `-g` 全局安装；去掉则只装当前项目。指定 agent 加 `-a claude-code -a codex`。以后 `npx skills update` 拉新版。
>
> 不想装 skill / 用 Cursor 等不支持 skill 的工具？直接把 `skills/feishu-gitlab-notify/SKILL.md` 的内容贴给你的 agent，它是纯 Markdown 操作指南。

### Step 2. 创建飞书机器人

在目标群里：**设置 ⚙️ → 群机器人 → 添加机器人 → 自定义机器人**

- 名字随便填（比如 "GitLab 通知"）
- 安全设置勾选 **「签名校验」**
- 记下两个值：**Webhook URL** + **Sign Secret**

建议存到本地 `chmod 600` 的 `~/.config/feishu-bot.env`：

```bash
export FEISHU_WEBHOOK_URL='https://open.feishu.cn/open-apis/bot/v2/hook/...'
export FEISHU_SIGN_SECRET='...'
```

> ⚠️ **Webhook URL 是凭证**，谁拿到都能往群里发消息。不要提交到任何 git 仓库。

### Step 3. 让 agent 装上

在你的 AI agent 里直接说：

> 帮我给 `<host>` 上的 `<namespace/project>` 配置飞书 GitLab 通知

agent 会自动按 skill 流程做完全部步骤：

1. 用 curl 测一发，验证飞书连通
2. **部署中继 Worker**（第一次需要；之后的项目复用，跳过这步）+ 设 3 个 secret
3. 用 `glab` 给该项目加 webhook（token 与 worker 对齐）
4. 直连 + GitLab 原生 test + 真实事件三路验证

完成后飞书群里会立刻收到测试卡片。

---

## 推广到多个项目

中继只部署一次。给后续项目加通知 = 复跑一条命令（skill 自带 `add-gitlab-hook.sh`）：

```bash
./add-gitlab-hook.sh <host> <namespace/project> <worker-url> "$(cat .secrets/gitlab-feishu.token.cred)"
```

或者直接跟 agent 说"再给 `<另一个项目>` 也配上"。

> Premium/Ultimate 用户：在顶层 group 配一个 Group webhook 就能覆盖该 group 下所有项目，无需逐个配。

---

## 进一步阅读

仓库：[https://github.com/ferry9303/agent-skills](https://github.com/ferry9303/agent-skills)

- **完整教程 + 故障排查**：`skills/feishu-gitlab-notify/README.md`
- **执行细节 + 已知坑 + 架构**：`skills/feishu-gitlab-notify/SKILL.md`
- **中继 worker 源码**：`skills/feishu-gitlab-notify/gitlab-feishu.worker.ts`
- **想改卡片样式 / 加新事件**：编辑 worker 的 `buildCard` 后重新 `wrangler deploy`

---

## 遇到问题 / 想反馈

安装报错、想加新事件类型、卡片样式建议，都可以直接戳我。

---

## 一句话总结

> npx skills add 装 skill → 创建机器人 → 跟 agent 说一句话 → agent 部署一次中继并配好 webhook → 飞书群开始收到 GitLab 通知。
