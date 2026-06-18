/**
 * GitLab → 飞书(Lark) 群机器人通知中继 Worker。
 *
 * 自建 GitLab（不可公网入站，但有出网）经 Project/Group webhook 主动出网 POST 到本 Worker；
 * Worker 校验 `X-Gitlab-Token` → 按 `X-Gitlab-Event` / `object_kind` 把 GitLab 事件转成飞书
 * interactive 卡片 → 现算 timestamp+HMAC 签名 → POST 飞书机器人。
 *
 * 卡片风格（emoji / 颜色 / 按钮 / 正文截断 / 噪音过滤）对齐 feishu-github-notify 模板。
 * 与 src/index.ts（S3 代签）无关，是独立 worker，各自 jsonc 指向各自 main。
 */

export interface Env {
  // secrets（wrangler secret put）
  FEISHU_WEBHOOK_URL: string; // 飞书自定义机器人 webhook
  GITLAB_WEBHOOK_TOKEN: string; // 与 GitLab webhook 的「Secret token」逐字比对
  FEISHU_SIGN_SECRET?: string; // 机器人开了「签名校验」才需要
}

// ---------- 卡片基元（与 GitHub 模板一致）----------
interface Element {
  tag: string;
  [k: string]: unknown;
}

export interface FeishuCard {
  msg_type: "interactive";
  card: {
    config: { wide_screen_mode: boolean };
    header: { title: { tag: "plain_text"; content: string }; template: string };
    elements: Element[];
  };
}

const ZERO_SHA = "0000000000000000000000000000000000000000";

function div(md: string): Element {
  return { tag: "div", text: { tag: "lark_md", content: md } };
}

function btn(text: string, url: string, type: string = "default"): Element {
  return { tag: "button", text: { tag: "plain_text", content: text }, url, type };
}

/** 正文截断 + 灰字（lark_md 无 blockquote，用灰色做视觉区分）。 */
function quote(s: string | undefined | null, limit: number = 200): string {
  let t = (s ?? "").trim().replace(/\r/g, "");
  if (!t) return "";
  if (t.length > limit) t = t.slice(0, limit).trimEnd() + "…";
  return `<font color='grey'>${t}</font>`;
}

/** 提交信息取首行并限长。 */
function firstLine(msg: string | undefined, limit: number = 80): string {
  let t = (msg ?? "").split("\n")[0].trim();
  if (t.length > limit) t = t.slice(0, limit) + "…";
  return t;
}

/**
 * 机器人账号过滤。GitLab 项目/群组 access token 会生成形如
 * `project_42_bot_xxx` / `group_7_bot_xxx` 的用户名；外部集成有时也带 `[bot]`。
 */
function isBot(username: string | undefined): boolean {
  if (!username) return false;
  return /(_bot(_|\d|$)|\[bot\]|^ghost$)/i.test(username);
}

function actorName(ev: any): string {
  return ev?.user?.name || ev?.user?.username || ev?.user_name || ev?.user_username || "someone";
}

function projectName(ev: any): string {
  const p = ev?.project ?? {};
  return p.path_with_namespace || p.name || "repo";
}

// ---------- 各事件 → 卡片；返回 null = 跳过（噪音 / 不关心的事件）----------

function pushCard(ev: any): FeishuCard | null {
  if (isBot(ev.user_username)) return null;
  const repo = projectName(ev);
  const webUrl: string = ev?.project?.web_url ?? "";
  const actor = actorName(ev);
  const ref = String(ev.ref ?? "").replace("refs/heads/", "");
  const before = String(ev.before ?? "");
  const after = String(ev.after ?? "");
  const commits: any[] = Array.isArray(ev.commits) ? ev.commits : [];

  const elements: Element[] = [];
  const buttons: Element[] = [];
  let title = "";
  let template = "green";

  if (after === ZERO_SHA) {
    // 删除分支（`git push origin :xxx`）—— 单独 🗑️ 卡片
    title = `🗑️ ${actor} deleted branch ${ref}`;
    template = "red";
    elements.push(div(`**${repo}**`));
    if (before && before !== ZERO_SHA) {
      const commitUrl = webUrl ? `${webUrl}/-/commit/${before}` : "";
      elements.push(div(`删除前最后提交：\`${before.slice(0, 8)}\``));
      if (commitUrl) buttons.push(btn("查看删除前提交", commitUrl, "primary"));
    }
  } else {
    if (!commits.length) return null; // 空 push（建分支无提交 / 仅 tag）跳过
    const n = Number(ev.total_commits_count ?? commits.length) || commits.length;
    title = `🚀 ${actor} → ${ref}  (${n} commit${n !== 1 ? "s" : ""})`;
    elements.push(div(`**${repo}**`));
    const lines = commits.slice(0, 5).map(
      (c) => `• [\`${String(c.id ?? "").slice(0, 7)}\`](${c.url}) ${firstLine(c.message)}`,
    );
    if (n > 5) lines.push(`… and ${n - 5} more`);
    elements.push(div(lines.join("\n")));
    if (webUrl && before && after) {
      buttons.push(btn("查看 diff", `${webUrl}/-/compare/${before}...${after}`, "primary"));
    } else if (commits[0]?.url) {
      buttons.push(btn("查看提交", commits[0].url, "primary"));
    }
  }

  return assemble(title, template, elements, buttons);
}

function tagCard(ev: any): FeishuCard | null {
  if (isBot(ev.user_username)) return null;
  const repo = projectName(ev);
  const actor = actorName(ev);
  const tag = String(ev.ref ?? "").replace("refs/tags/", "");
  const after = String(ev.after ?? "");
  const deleted = after === ZERO_SHA;
  const title = deleted ? `🏷️ ${actor} deleted tag ${tag}` : `🏷️ ${actor} pushed tag ${tag}`;
  return assemble(title, deleted ? "grey" : "blue", [div(`**${repo}**`)], []);
}

function mrCard(ev: any): FeishuCard | null {
  if (isBot(ev?.user?.username)) return null;
  const oa = ev?.object_attributes ?? {};
  const action: string = oa.action ?? "";
  // 噪音：update（每次推分支/改标签都触发）、unapproved；空 action 也跳过
  if (!action || action === "update" || action === "unapproved" || action === "unapproval") {
    return null;
  }
  // draft MR 打开不通知
  if (action === "open" && (oa.work_in_progress === true || /^draft:/i.test(String(oa.title ?? "")))) {
    return null;
  }
  const map: Record<string, [string, string, string]> = {
    open: ["🔀", "blue", "opened"],
    reopen: ["🔄", "orange", "reopened"],
    merge: ["💜", "purple", "merged"],
    close: ["🚫", "grey", "closed"],
    approved: ["✅", "green", "approved"],
    approval: ["✅", "green", "approved"],
  };
  const [emoji, template, verb] = map[action] ?? ["🔀", "blue", action];
  const repo = projectName(ev);
  const iid = oa.iid;
  const elements: Element[] = [
    div(`**${repo}** · @${ev?.user?.username ?? actorName(ev)} · \`${oa.source_branch}\` → \`${oa.target_branch}\``),
  ];
  if (action === "open") {
    const body = quote(oa.description);
    if (body) elements.push(div(body));
  }
  const buttons = oa.url ? [btn("Open MR", oa.url, "primary")] : [];
  return assemble(`${emoji} MR !${iid} ${verb}: ${oa.title}`, template, elements, buttons);
}

function noteCard(ev: any): FeishuCard | null {
  if (isBot(ev?.user?.username)) return null;
  const oa = ev?.object_attributes ?? {};
  const nt: string = oa.noteable_type ?? "";
  let kind = nt || "note";
  let num = "";
  let targetTitle = "";
  if (nt === "MergeRequest") {
    kind = "MR";
    num = `!${ev?.merge_request?.iid ?? ""}`;
    targetTitle = ev?.merge_request?.title ?? "";
  } else if (nt === "Issue") {
    kind = "Issue";
    num = `#${ev?.issue?.iid ?? ""}`;
    targetTitle = ev?.issue?.title ?? "";
  } else if (nt === "Commit") {
    kind = "commit";
    num = String(ev?.commit?.id ?? "").slice(0, 7);
    targetTitle = firstLine(ev?.commit?.message);
  }
  const repo = projectName(ev);
  const elements: Element[] = [
    div(`**${repo}**${targetTitle ? ` · *${targetTitle}*` : ""}`),
  ];
  const body = quote(oa.note);
  if (body) elements.push(div(body));
  const buttons = oa.url ? [btn("Open comment", oa.url, "primary")] : [];
  return assemble(
    `💬 @${ev?.user?.username ?? actorName(ev)} commented on ${kind} ${num}`.trim(),
    "turquoise",
    elements,
    buttons,
  );
}

function issueCard(ev: any): FeishuCard | null {
  if (isBot(ev?.user?.username)) return null;
  const oa = ev?.object_attributes ?? {};
  const action: string = oa.action ?? "";
  if (!action || action === "update") return null; // 噪音
  const map: Record<string, [string, string]> = {
    open: ["🐛", "orange"],
    close: ["✔️", "grey"],
    reopen: ["🔄", "orange"],
  };
  const [emoji, template] = map[action] ?? ["📋", "blue"];
  const repo = projectName(ev);
  const elements: Element[] = [div(`**${repo}** · @${ev?.user?.username ?? actorName(ev)}`)];
  if (action === "open") {
    const body = quote(oa.description);
    if (body) elements.push(div(body));
  }
  const buttons = oa.url ? [btn("Open issue", oa.url, "primary")] : [];
  return assemble(`${emoji} Issue #${oa.iid} ${action}: ${oa.title}`, template, elements, buttons);
}

function assemble(
  title: string,
  template: string,
  elements: Element[],
  buttons: Element[],
): FeishuCard {
  const els = [...elements];
  if (buttons.length) els.push({ tag: "action", actions: buttons });
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: { title: { tag: "plain_text", content: title.slice(0, 150) }, template },
      elements: els,
    },
  };
}

/**
 * GitLab 事件 → 飞书卡片。`event` = X-Gitlab-Event 头（如 "Push Hook"）；
 * 以 body.object_kind 为准分流，header 仅兜底。返回 null 表示跳过。
 */
export function buildCard(event: string, ev: any): FeishuCard | null {
  const kind: string = ev?.object_kind ?? "";
  switch (kind) {
    case "push":
      return pushCard(ev);
    case "tag_push":
      return tagCard(ev);
    case "merge_request":
      return mrCard(ev);
    case "note":
      return noteCard(ev);
    case "issue":
      return issueCard(ev);
    default:
      return null; // pipeline / job / wiki / deployment 等暂不通知，需要再加
  }
}

// ---------- 签名 ----------

/** 飞书签名：key = `${ts}\n${secret}`，对空消息做 HMAC-SHA256，base64。 */
export async function feishuSign(ts: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${ts}\n${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new Uint8Array(0));
  let bin = "";
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function signedPayload(card: FeishuCard, secret?: string): Promise<unknown> {
  if (!secret) return card;
  const ts = String(Math.floor(Date.now() / 1000));
  const sign = await feishuSign(ts, secret);
  return { timestamp: ts, sign, ...card };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    // 1) 鉴权：比对 GitLab 的 Secret token
    const token = request.headers.get("X-Gitlab-Token") ?? "";
    if (!env.GITLAB_WEBHOOK_TOKEN || !timingSafeEqual(token, env.GITLAB_WEBHOOK_TOKEN)) {
      return new Response("Forbidden", { status: 403 });
    }

    // 2) 解析事件
    const event = request.headers.get("X-Gitlab-Event") ?? "";
    let ev: any;
    try {
      ev = await request.json();
    } catch {
      return new Response("Bad Request: invalid JSON", { status: 400 });
    }

    // 3) 转卡片（噪音 / 不关心的事件 → 静默 200，避免 GitLab 标红重试）
    const card = buildCard(event, ev);
    if (!card) return new Response("skipped", { status: 200 });

    if (!env.FEISHU_WEBHOOK_URL) {
      return new Response("FEISHU_WEBHOOK_URL not set — skipping", { status: 200 });
    }

    // 4) 签名 + 转发飞书
    const payload = await signedPayload(card, env.FEISHU_SIGN_SECRET);
    const resp = await fetch(env.FEISHU_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    return new Response(`feishu ${resp.status}: ${text}`, { status: resp.ok ? 200 : 502 });
  },
};
