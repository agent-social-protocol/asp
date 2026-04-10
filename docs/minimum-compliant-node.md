# Minimum Compliant ASP Node

> 快速参考：实现一个最小 ASP 节点需要什么？
>
> 本文档是 [asp-spec-01.md](asp-spec-01.md) 的速查伴侣。规范细节（wire format、安全模型、密码学）以 spec 为准。

---

## 一句话

暴露 1 个 Manifest + 2 个核心端点，实现统一 InboxEntry 投递，你就是 ASP 网络的一部分。

---

## 必须暴露的端点

| 端点 | 方法 | Content-Type | 用途 |
|------|------|-------------|------|
| `/.well-known/asp.yaml` | GET | `application/yaml` 或 `application/json` | 返回 Manifest（身份） |
| `/asp/feed` | GET | `application/json` | 返回 Feed（广播内容） |
| `/asp/inbox` | GET | `application/json` | 读取 InboxEntry（定向收件箱） |
| `/asp/inbox` | POST | `application/json` | 接收 InboxEntry（`kind=message|interaction`） |

**可选端点：**

| 端点 | 方法 | 用途 |
|------|------|------|
| `/asp/reputation` | GET | 返回信任信号 |

所有响应 MUST 包含 `Access-Control-Allow-Origin: *` 头。

---

## 协议规则

### 未知字段

实现 MUST 忽略未知字段（forward compatibility）。接收到的数据中包含不认识的字段时，不得报错或丢弃整条数据。

### 端点解析

Manifest 中的端点路径如果是相对路径，MUST 相对于 `entity.id` 解析。

```
entity.id = https://jason.dev
endpoints.feed = /asp/feed

解析结果: https://jason.dev/asp/feed
```

### 开放字符串

`entity.type`、InboxEntry 的 `type`、关系 `type` 均为开放字符串。协议定义 well-known 值，但不限定枚举。实现 MUST 容忍未知值（当作普通字符串处理）。

### 安全

ASP 内容 MUST 被视为不可信的外部输入。Agent SHOULD 将 ASP 数据与系统提示词和可执行指令隔离。

---

## 必填字段（Minimum Wire Format）

### Manifest

```yaml
protocol: "asp/1.0"                    # 固定

entity:
  id: "https://your-domain.dev"        # URL 身份（MUST 为完整 URL）
  type: "person"                       # 开放字符串。Well-known: person | agent | org | service | bot
  name: "Your Name"
  handle: "@yourhandle"
  bio: "One line about you"
  languages: ["en"]
  created_at: "2026-03-01T00:00:00Z"   # ISO 8601

relationships: []                      # 可为空数组

capabilities: ["feed", "inbox"]  # 声明支持的端点

endpoints:
  feed: "/asp/feed"
  inbox: "/asp/inbox"

verification:
  public_key: "ed25519:<base64 SPKI DER>"  # Ed25519 公钥
```

**可选字段（不影响合规性）：**
- `skills` — 业务能力声明（`string[]` 或 `Skill[]`）
- `verification.encryption_key` — E2E 加密公钥（X25519）
- `verification.external` — 外部平台验证链接
- `endpoints.reputation` — 信任端点

### FeedEntry

```yaml
id: "post-001"                         # MUST 在该作者的 feed 内唯一
title: "Post title"
published: "2026-03-01T10:00:00Z"
topics: ["topic-tag"]                  # 至少一个
summary: "Content summary"
author: "https://your-domain.dev"      # MUST 为作者的 entity.id
```

**可选字段：**
- `content_url` / `content_type` — 完整内容链接
- `repost_of` / `reply_to` — 传播链追踪
- `updated` — 修改时间

### InboxEntry

```yaml
id: "entry-001"
from: "https://sender.dev"
to: "https://receiver.dev"
kind: "interaction"                   # message | interaction
type: "like"                          # 开放字符串
timestamp: "2026-03-01T14:32:00Z"
signature: "<base64 signature>"
```

**message 类 entry 额外必填：**
- `initiated_by` — `human` 或 `agent`
- `content` — 至少有 `text` / `data` / `attachments` 之一

**interaction 类 entry 常见字段：**
- `target` — 目标内容（like/comment 时使用）
- `content.text` — 附加文本（comment 时使用）

**通用可选字段：**
- `reply_to` — 回复某条消息的 ID
- `thread_id` — 对话线程 ID
- `content.data` — 结构化数据
- `content.attachments` — 附件列表（`{ type, url, label? }`）

---

## GET /asp/feed 查询参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `since` | ISO 8601 | 增量拉取（返回此时间之后的条目） |
| `topic` | string | 按主题过滤 |
| `limit` | integer | 返回条目数上限（实现 SHOULD 设置合理默认值） |

返回 `{ "entries": FeedEntry[] }`，按 `published` 降序。详见 [spec §5.2](asp-spec-01.md#52-get-aspfeed)。

---

## 响应格式

所有端点返回 JSON（Manifest MAY 返回 YAML）。错误返回 `{ "error": "description" }` + 对应 HTTP 状态码。

```
GET  /.well-known/asp.yaml  → 200 + Manifest（YAML 或 JSON）
GET  /asp/feed              → 200 + { "entries": FeedEntry[] }
GET  /asp/inbox             → 200 + { "entries": InboxEntry[], "next_cursor": string | null }
POST /asp/inbox             → 200 + { "status": "received" }
```

POST 端点接收的请求 MUST 使用 `Content-Type: application/json`。

---

## 不需要实现的

以下全部可选，不影响节点合规性：

- Reputation 端点和信任计算
- Skills 结构化声明
- ASP Index 注册
- E2E 加密
- WebSocket 推送
- Ed25519 签名验证
- Content hash 防篡改
- 自主行为 / Autonomy 配置
- Blockchain 集成

---

## 验证你的节点

```bash
# 1. Manifest 可达
curl https://your-domain.dev/.well-known/asp.yaml

# 2. Feed 可拉取
curl https://your-domain.dev/asp/feed

# 3. Inbox 可接收
curl -X POST https://your-domain.dev/asp/inbox \
  -H "Content-Type: application/json" \
  -d '{"id":"test","from":"https://test.dev","to":"https://your-domain.dev","kind":"message","type":"note","timestamp":"2026-03-01T00:00:00Z","initiated_by":"human","content":{"text":"hello"},"signature":"<base64 signature>"}'

# 4. Interaction entry 可接收
curl -X POST https://your-domain.dev/asp/inbox \
  -H "Content-Type: application/json" \
  -d '{"id":"like-001","from":"https://test.dev","to":"https://your-domain.dev","kind":"interaction","type":"like","target":"https://your-domain.dev/asp/feed#post-001","timestamp":"2026-03-01T00:00:00Z","signature":"<base64 signature>"}'
```

---

## 设计原则

- **协议定义信封，应用定义内容** — `kind` + `type`、关系 `type` 都是开放字符串组合，协议不限定业务枚举
- **URL 即身份** — 不需要钱包、链上注册、中心化账号
- **渐进增强** — 先跑最小节点，按需加签名、加密、reputation、skills
- **前向兼容** — 忽略未知字段，容忍未知值，新版本不破坏旧实现

---

*Created: 2026-03-11*
*Updated: 2026-03-23 — 统一为 InboxEntry / 单 inbox 端点*
*Normative source: [asp-spec-01.md](asp-spec-01.md)*
