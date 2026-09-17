# Chain 锚定链契约

> 本文是 Manifold 锚定链的权威契约（设计 2026-09-06 定稿，同日实现合并）。证书/区块结构、哈希与签名、锚定清单、挖矿、验证语义和 `CORE_CHAIN_*` 配置以本文为唯一事实来源。决策背景见 [`docs/decisions/core.md`](decisions/core.md) 的「内嵌通用锚定链」条目。

## 1. 背景与定位

Manifold 在 Core 内嵌一条**通用锚定链（generic anchoring chain）**，作为 Web3 核心理念的可运行探索：

- **承诺（commitment）**：链上只存 payload 的 SHA-256，原文哈希后立即丢弃（OpenTimestamps 同款）。链证明「这个哈希在 T 时刻存在过并被站点密钥签名」，不存储原文、也无法从哈希还原内容。
- **可验证签名**：每张证书由站点 ed25519 密钥签名，任何人可用公开公钥离线验签。
- **PoW 双模式**：区块以 sim/proof 两种模式挖矿——sim 固定延迟、平凡目标，零算力开销；proof 真做 SHA-256 前导 0 碰撞，难度可配。两种块结构一致，`proofMode` 写在块内自述。
- **缓冲成块（mempool → block）**：证书先进入持久化缓冲区，凑满批量阈值或超时才打包挖块，复刻交易池→区块的真实形态。
- **无许可（permissionless）写入**：公开接口允许任何人提交任意 payload 求锚定（限流 + 大小上限）；同时 Core 内部把**每一次业务数据变更**自动锚定。

**诚实边界**：这是单写者链——Core 是唯一矿工和唯一写入者，没有多节点共识。全链重放验证能证明「历史未被篡改」，不能证明「写入者是诚实的」。防事后篡改，不防写入者作恶；这是本探索刻意保留的教学边界，不是缺陷声明。

## 2. 架构与边界

```text
admin 变更内容/评论/站点 ──┐
公开访客评论/点赞 ─────────┤
POST /api/v1/chain/anchors ─┼──> handler 构造 payload ──> chain.Submit()
管理员 POST admin 通道 ─────┘                                │
                                              规范化 → sha256 → ed25519 签名
                                                             │
                                              INSERT chain_anchors (pending)
                                                             │  唤醒信号
矿工 worker: 缓冲集 → 组块（prevHash 串接 + Merkle root）
           → sim 延迟 / proof 碰撞 → 单事务落块 + 回填 block_id
           → 审计 + 内容缓存失效
```

| 层 | 位置 | 职任 |
| --- | --- | --- |
| chain 包 | `app/core/internal/chain/` | 规范化、哈希、签名、组块、PoW、全链重放验证；**对业务一无所知** |
| 提交方 | 各 handler | 业务落库成功后构造 payload 并调用 `Submit()`；失败只记审计，不影响业务请求 |
| 存储 | `chain_anchors` / `chain_blocks` / `chain_keys` 三表 | 只增不改（`block_id` 回填是唯一 UPDATE）；持久缓冲即 pending 集 |

边界规则：

1. `internal/chain` 不 import store 内部包、不解释 payload；业务语义（payload 怎么构造）在 handler 侧。
2. 规范化、哈希、验签只在 Core 实现一次；Web/Admin 永远把原文交给 Core 的 verify 接口重算，不在客户端复制任何链逻辑。
3. 链表是与 `audit_events` 同级的非关键数据：链写入失败绝不让业务请求失败。

## 3. 核心概念

### 3.1 证书（chain_anchors 一行）

| 字段 | 说明 |
| --- | --- |
| `id` | `cert_` + 32 随机字节的 hex，全局唯一 |
| `subject_hash` | `sha256(payload)` 的 hex，唯一被「上链」的东西 |
| `source` | `content` / `comment` / `reaction` / `profile` / `site` / `media` / `auth` / `visitor` / `admin`；枚举由 Go 常量与 contracts 校验，**无 SQL CHECK**（保持表结构对新 source 开放） |
| `subject_ref` | source 语义下最稳定的资源引用（见锚定清单表）；无稳定公开 ID 时为空串 |
| `label` | 提交者可选的公开短标签，≤64 字符，默认空 |
| `metadata_json` | source 特定的事实字段，链只存储不解释 |
| `site_key_id` / `site_public_key` | 签名所用站点密钥；证书自包含，密钥轮换不影响历史证书验签 |
| `site_signature` | ed25519 私钥对 `subject_hash`（hex 字节）的签名，hex |
| `created_at` | 提交时间，UTC RFC3339 |
| `block_id` | `NULL` = pending；回填后不可再变 |

### 3.2 区块（chain_blocks 一行）

| 字段 | 说明 |
| --- | --- |
| `id` | `block_<block_index>`，确定性 ID |
| `block_index` | 从 0（genesis）起连续递增，UNIQUE |
| `prev_hash` | 前块 `hash`；genesis 为 64 个 `0` |
| `timestamp` | 区块头组装时间，UTC RFC3339。它是哈希预像的一部分，因此在 PoW 开始前取样一次，挖矿期间与落库时均不改写（见 3.4） |
| `cert_root` | 本块 certId 列表的 Merkle root（见 3.4）；空列表时为 `sha256("")` |
| `cert_ids_json` | 有序 certId 数组；排序为 `created_at ASC`，并列时 `id ASC` |
| `nonce` | sim 恒为 0；proof 为满足难度时的碰撞值 |
| `proof_mode` | `sim` / `proof`，块内自述，验证器按块分别对待 |
| `difficulty` | 前导 0 的十六进制位数；sim 块恒为 0（平凡目标） |
| `hash` | 见 3.4 公式 |

**创世块**：链为空时矿工立即挖出 index 0（不等缓冲）：`prev_hash = 64×"0"`、`cert_ids = []`、`cert_root = sha256("")`，`proof_mode` / `difficulty` 取当时配置。

### 3.3 站点密钥（chain_keys 一行，单例）

- Core 首次启动生成 ed25519 密钥对：`key_id = "site_key_1"`，公钥/私钥 hex 存 `chain_keys`。密钥随 `data/manifold.db` 一起备份、迁移（见 README 发布包数据规则）。创建只发生在两处：`cmd/server` 启动时的 `EnsureSiteKey`，以及 `Submit` 的幂等前置调用。**`GET /api/v1/chain` 是纯读**：它只查 `chain_keys`，缺失时返回空 `sitePublicKey` 而不会补建（读路径不写库）。
- 每张证书记录签名时的 `site_key_id` + `site_public_key`，证书自包含；`chain_keys` 允许多行为未来的密钥轮换预留，**轮换管理本轮不做**。
- 诚实边界：私钥与 SQLite 文件同级保护（`data/` 0700），不是 HSM/KMS 级。密钥泄露只影响**之后**新证书的可信度，历史区块与历史证书不受影响（区块哈希链与每张证书记录的公钥独立可验）。

### 3.4 规范化、哈希与 Merkle

- **结构化 payload**（content/comment/reaction/profile/site/media/auth 的内部提交）：构造为 JSON 对象后由 `chain.CanonicalJSON` 规范化——对象 key 按 UTF-8 字节序递归排序、无空白分隔符、UTF-8 编码——再取哈希。
- **任意 payload**（visitor/admin 通道）：按提交字符串的 **UTF-8 原字节**直接哈希，不做任何规范化、不去空白。验证页贴回的文本必须与提交时逐字节一致（含换行）。
- **区块哈希**：`hash = sha256("<index>|<prevHash>|<timestamp>|<certRoot>|<proofMode>|<difficulty>|<nonce>")`（十进制 index/nonce/difficulty、管道分隔的 UTF-8 串）。`proofMode` 和 `difficulty` **必须**参与哈希：否则事后把历史块从 `proof` 改成 `sim` 或调低难度，重算 hash 仍匹配，全链重放不会报警——那会破坏「防事后篡改」承诺。proof 块要求 `hash` 的 hex 表示前导 `0` 字符数 ≥ `difficulty`；sim 块不校验前导 0。
- **时间戳在 PoW 前冻结**：`timestamp` 同样是哈希预像的一部分，因此**头部组装时取样一次，碰撞搜索期间与落库时都不得改写**。若在挖矿完成后重写时间戳，落库的 `hash` 就不再对应挖矿时搜索 nonce 所用的预像，`Satisfies()` 失败，全链重放会把**每个 proof 块**报为 `invalid`（难度 8 ≈ 2³² 次哈希，必然跨秒边界）。`Ledger` 通过可注入的时钟（`now`）取样，测试可钉死区块时间。
- **Merkle root**：叶子 `leaf_i = sha256(certId_i 的 UTF-8 字节)`；父节点 `sha256(left ‖ right)`，奇数个时复制最后一个；空列表的 root 为 `sha256("")`。验证器从 `cert_ids_json` 的存储顺序重算。

## 4. 锚定清单

**原则：任何写入业务数据的请求路径都必须提交证书。** payload = 行为人已知的变更实质（提交的正文、填写的字段、按下的动作），不含任何密钥材料、密码材料或会话 token；因此提交者永远可以用原文重算自己的哈希。

### 4.1 内部自动锚定（handler 落库成功后触发）

| source | 触发路径 | payload（被哈希的字节） | `subject_ref` | metadata |
| --- | --- | --- | --- | --- |
| `content` | create / update / publish / unpublish / delete / restore | 变更后行实质：`{kind, slug, title, summary, body, tags(排序), metadata(仅编辑字段：Thought 的 mood/question/context/source；Article 的 language/aiAssisted，不含派生的 readingMinutes/toc)}` | contentId | `{contentId, kind, status, version, slug}`（slug 供矿工自包含地失效内容缓存） |
| `comment` | 公开/管理员创建、hide、unhide、软删、恢复、编辑作者 | 变更后行实质：`{contentId, authorName, authorUrl, body, replyToId, avatarSeed, authorProvider, authorAvatarUrl}`（取持久化后的值；状态翻转动作的 payload 是未变的实质、重签一次，动作记 metadata） | commentId | `{commentId, action: created/hidden/unhidden/deleted/restored/author-updated}` |
| `reaction` | 点赞 PUT / DELETE | 动作描述符：`{contentId, visitorId, action: added/removed}` | 空 | `{contentId, action}` |
| `profile` | PUT profile | 提交的 ProfileInput 整体 | `profile_1` | `{}` |
| `site` | PUT site | 提交的 SiteConfigInput 整体 | `site_1` | `{target: site}` |
| `site` | PUT thoughts/writings config（置顶替换） | `{kind, pinnedIds}` | `thoughts_1` / `writings_1` | `{target: pins, kind}` |
| `media` | 上传（新字节入库时；sha256 去重命中旧行则无写入、不锚定） | `{mime, size, sha256, filename}` | mediaId | `{mediaId, action: uploaded}` |
| `media` | 删除（硬删行） | 动作描述符：`{mediaId, action: deleted}` | mediaId | `{mediaId, action: deleted}` |
| `auth` | 登录、登出、登出全部、按 id 登出、改密码 | 动作描述符：`{username, action}`；**永不包含任何密码材料** | 空 | `{sessionId?}`（JWT jti，非 token 本身） |

规则说明：

- **同一正文跨生命周期哈希不变**：publish/unpublish/delete 只改状态，payload（正文实质）哈希不变，status/version 变化记录在 metadata——同一篇文字的全部版本与状态轨迹在链上完整可查。
- **行实质优先、描述符兜底**：存在持久化实体的动作用「变更后行实质投影」做 payload（live 行永远能对上最新证书）；实体不复存在的动作（auth、reaction、媒体硬删）用动作描述符。
- **请求史而非行态史**：幂等重复请求（如对已点赞再次 PUT）同样成证。证书记录「该变更请求发生过」，不承诺行发生了物理变化。
- **崩溃窗口**：业务写提交与证书插入是两个步骤，进程在两者之间崩溃会产生一条未锚定变更（审计可对照发现）。不合并事务是刻意解耦：链故障不阻塞业务。
- **种子数据**：dev seed 的 20 篇演示内容（全部 PUBLISHED）在应用种子时同步补签 `PUBLISHED/v1` 证书（先确保 `chain_keys` 有站点密钥），新库启动数秒内即有可验证的链；生产骨架与 profile/site 单例初始化属于建库结构行为，不逐行锚定。seed 补签是 handler 之外唯一允许构造证书的路径（它模拟的是「种子内容的作者提交」），payload 构造函数与 handler 侧共用，不复制格式定义。

### 4.2 例外（不锚定，需在改动时维持）

| 路径 | 理由 |
| --- | --- |
| `presence` 心跳 | 高频可再生观测数据，无归档价值；上链会让链被心跳淹没 |
| `content_view_events` 浏览事件 | 随流量无界增长、可再生；每多一次浏览多一张永久证书没有承诺意义 |
| `audit_events` 写入 | 结构性不能上链：挖块产生审计事件 → 审计事件又要求上链 → 无限回归 |
| `identities` upsert（OAuth 换发时刷新第三方账号资料） | 第三方账号资料镜像，可再生（下次 GitHub 登录重新拉取），非本站用户内容，无承诺价值 |
| `chain_keys` 站点密钥创建 | 链自身的签名基础设施，不是被承诺的业务内容；对它的承诺会是循环的（证书由该密钥签名） |
| `agent_settings` 更新 | 私有运行配置，不代表公开内容或用户交互事实；只写 `agent.settings.updated` 审计，元数据不得包含 API key 明文 |

新增数据库写路径时，必须先在本清单登记（或说明归入哪条例外），再合并实现；见第 14 节。

### 4.3 公开提交（permissionless）

- `POST /api/v1/chain/anchors`（公开，挂 `publicLimiter` 限流）：`{payload: string, label?}`，payload ≤ `CORE_CHAIN_ANCHOR_MAX_BYTES`，source = `visitor`。
- `POST /api/v1/admin/chain/anchors`（JWT，source = `admin`）：请求体相同，走管理员身份。
- 两者哈希后立即丢弃 payload，响应 `202 { anchorId, subjectHash, status: "pending" }`。

## 5. 运行配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CORE_CHAIN_PROOF_MODE` | `sim` | `sim` 固定延迟出块；`proof` 真跑 SHA-256 碰撞 |
| `CORE_CHAIN_DIFFICULTY` | `6` | proof 模式前导 0 十六进制位数；sim 下忽略（存 0）。合法区间是 `[1, 6]`，由 `chain.MinProofDifficulty` / `chain.MaxProofDifficulty` 定义：目标代价是 16^difficulty 次哈希，6 位约 1.7e7 次（单核数秒），8 位约 4.3e9 次（十几分钟），12 位以年计，而 `InsertBlock` 只在进程关闭时才收到取消信号。`config.Validate()` 在 proof 模式下越界即拒绝启动（所有环境，不只 production），`NewLedger` 另外对直接调用方做一次 clamp 兜底 |
| `CORE_CHAIN_SIM_DELAY` | `1s` | sim 模式模拟挖矿延迟 |
| `CORE_CHAIN_BATCH_SIZE` | `32` | 缓冲满阈值：pending 达到该数量立即打包 |
| `CORE_CHAIN_MAX_BLOCK_ANCHORS` | `500` | 单块证书上限，超出分多块连挖 |
| `CORE_CHAIN_FLUSH_TIMEOUT` | `30s` | 防饿死阀门：最老 pending 等待超过该时长即打包 |
| `CORE_CHAIN_ANCHOR_MAX_BYTES` | `65536` | 公开/Admin 提交 payload 上限（64KB），超限 413 |
| `CORE_CHAIN_VERIFY_RATE_PER_MIN` | `20` | 四个 verify 入口共用的独立限流配额（每分钟）；每个验证请求都会全链重放（见第 10 节），比公开提交更昂贵，故配额更紧 |

发布打包脚本校验：`CORE_CHAIN_PROOF_MODE ∈ {sim, proof}`；`proof` 模式下 `CORE_CHAIN_DIFFICULTY ∈ [1, 6]`（与 Core 的 `config.Validate()` 同一区间，避免打包通过而启动被拒）。sim 模式可在生产运行（这是学习特性站点，链延迟出块不影响业务正确性）。

## 6. 公开 API

基础路径 `/api/v1/chain`，无认证，不走内容 TTL 缓存（链数据低频且要求即时可见 pending 状态）。集合统一 `{ data, pagination }`，分页边界与 Core 通用约定一致：空集是第 1/1 页，请求页超出末页时返回末页数据并把 `page` 夹紧到末页。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/chain` | `ChainInfo`：`{height, totalAnchors, pendingAnchors, proofMode, difficulty, genesisHash, tipHash, sitePublicKey}` |
| `GET` | `/chain/anchors?source=&ref=&page=&pageSize=` | 证书列表（`createdAt` 降序）；`source`/`ref` 可选过滤；默认 pageSize 20、范围 1..100 |
| `POST` | `/chain/anchors` | 提交锚定，`publicLimiter` 限流；`202 {anchorId, subjectHash, status:"pending"}`；payload 超限 `413 PAYLOAD_TOO_LARGE` |
| `GET` | `/chain/anchors/{id}` | 单张证书 |
| `GET` | `/chain/blocks?page=&pageSize=` | 区块摘要列表（`block_index` 降序）；摘要含 `anchorCount` 不含 `certIds` |
| `GET` | `/chain/blocks/{id}` | 区块详情：`certIds` + 内含全部证书 |
| `GET` | `/chain/verify?hash=<sha256hex>` | 按哈希查证 |
| `POST` | `/chain/verify` | 贴原文查证：`{payload: string}`，Core 按原字节重算哈希后查证 |
| `GET` | `/chain/verify/content/{slug}` | 按公开内容查证：Core 从 live 行重建 canonical payload → 哈希 → 查证；仅 PUBLISHED 内容（草稿/删除 404） |
| `GET` | `/chain/verify/comment/{id}` | 按评论查证：同上从 live 评论行重建；隐藏/软删评论 404（其历史承诺仍可被持有原文者用哈希验证，见第 10 节） |
| `GET` | `/chain/keys` | `{keys: [{keyId, publicKey, createdAt}]}` 站点公钥列表 |

> **响应字段（anchorView）**：证书对象即 contracts 的 `ChainAnchor`。除存储直出字段（`id`/`subjectHash`/`source`/`subjectRef`/`label`/`metadata`/`siteSignature`/`createdAt`/`status`/`blockId`）外，handler 在 `listChainAnchors`/`getChainAnchor`/`getChainBlock`/`verify` 四处统一派生两个字段：
> - `summary`：人类可读概述，由 source + metadata 生成（不读 payload，见第 2 节边界）：content → `Writing “<slug>” · published · v2`（kind 决定路径）/`Thought “<slug>” · …`；comment → `Comment created/hidden/unhidden/deleted/restored/author updated`；reaction → `Like added/removed`；media → `Media uploaded/deleted`；profile → `Profile updated`；site → `Site updated` 或 `Pinned content updated`；auth → `Sign-in/Sign-out/…`；visitor/admin → `Public/Admin commitment · “<label>”`。
> - `target`（`AnchorTarget {kind, href, label}` 或 `null`）：可跳转目标。content → `/writing/<slug>` 或 `/thoughts/<slug>`（kind 决定路径）；comment → 所属内容页 `#comments` 锚点（Core 经 `comments.content_id` → `content.slug/kind` 解析，评论或内容已删则 `null`）；reaction → 所属内容页；media → `/api/v1/media/<id>`；其余 source 一律 `null`。客户端只渲染不派生。

四个 verify 入口（`/chain/verify` GET/POST、`verify/content/{slug}`、`verify/comment/{id}`）共用独立的 `verifyLimiter`（`CORE_CHAIN_VERIFY_RATE_PER_MIN`，默认 20/min）。每次验证都全链重放（见第 10 节），比写入更消耗 CPU/DB，因此配额远低于公开提交限流，命中返回 `429`。

## 7. Admin API

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `POST` | `/api/v1/admin/chain/anchors` | 管理员提交任意 payload，source = `admin`，请求体与响应同公开通道；无独立限流（已有 JWT 门槛） |

Admin 不新增链相关 workspace；管理员用公开浏览器与公开 verify 接口。Core Agent 在链启用时注册只读 `get_chain_status` 工具，复用 `Ledger.ChainInfo` 返回 height/tip/anchor 统计，不提交 payload、不新增 source、也不写链表。内部 source（content/comment 等）的证书在对应业务操作中自动产生，无需管理动作。

## 8. 数据模型

迁移 `db/migrations/0005_init.sql` 引入锚定链三表（`chain_keys`、`chain_anchors`、`chain_blocks`）。当前 Core `schemaVersion` 为 7；后续迁移 `db/migrations/0006_init.sql` 引入第三方身份和评论 provider 字段，`0007_init.sql` 引入不锚定的 `agent_settings` 运行配置：

```sql
CREATE TABLE IF NOT EXISTS chain_keys (
    key_id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL UNIQUE,
    private_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chain_anchors (
    id TEXT PRIMARY KEY,
    subject_hash TEXT NOT NULL,
    source TEXT NOT NULL,
    subject_ref TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    site_key_id TEXT NOT NULL,
    site_public_key TEXT NOT NULL,
    site_signature TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    block_id TEXT REFERENCES chain_blocks(id)
);

CREATE TABLE IF NOT EXISTS chain_blocks (
    id TEXT PRIMARY KEY,
    block_index INTEGER NOT NULL UNIQUE,
    prev_hash TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cert_root TEXT NOT NULL,
    cert_ids_json TEXT NOT NULL DEFAULT '[]',
    nonce INTEGER NOT NULL DEFAULT 0,
    proof_mode TEXT NOT NULL,
    difficulty INTEGER NOT NULL DEFAULT 0,
    hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chain_anchors_pending ON chain_anchors(created_at) WHERE block_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_chain_anchors_subject ON chain_anchors(subject_hash);
CREATE INDEX IF NOT EXISTS idx_chain_anchors_ref ON chain_anchors(subject_ref, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chain_anchors_source ON chain_anchors(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chain_anchors_block ON chain_anchors(block_id);
```

约束语义：

- `source` 与 `proof_mode` **故意不设 SQL CHECK**：枚举在 Go 常量与 contracts 校验，新增枚举值不需要改表。
- 两张链表只增不改。唯一合法 UPDATE 是矿工把 `chain_anchors.block_id` 从 `NULL` 回填为块 ID（单向、一次性）；不可改写、不可清空。该不变量由代码路径保证、由全链重放验证兜底，不依赖 SQL 触发器。
- `chain_blocks.id` 由 `block_index` 派生（`block_<index>`），确定性可寻址。

## 9. 矿工生命周期

矿工是 `main.go` 启动的单 goroutine（与审计 dispatcher 同层的生命周期语义），**缓冲区就是 `chain_anchors` 中 `block_id IS NULL` 的持久 pending 集**——不在内存，进程重启后原样保留、重启续挖，天然幂等。

```text
循环（1s tick + Submit 时的唤醒信号双触发）:
  链为空            → 立即挖 genesis（不等缓冲）
  pending 为空      → 等待
  触发打包的条件（满足其一）:
    a) pending 数量 ≥ CORE_CHAIN_BATCH_SIZE      （缓冲满）
    b) 最老 pending 年龄 ≥ CORE_CHAIN_FLUSH_TIMEOUT（防饿死阀门）
  组块: index = tip+1, prevHash = tip.hash,
        certIds = pending 按 created_at ASC（并列 id ASC），截取 ≤ CORE_CHAIN_MAX_BLOCK_ANCHORS
        certRoot = merkle(certIds)
        timestamp = 头部组装时取样一次（UTC RFC3339），此后冻结
  挖矿: sim → sleep(SIM_DELAY), nonce=0
        proof → 递增 nonce 直到 hash 前导 0 ≥ difficulty
        （挖矿不得改写头部任何字段；时间戳参与预像，改写会使落库 hash 不满足难度）
  单事务: INSERT chain_blocks + UPDATE chain_anchors SET block_id（只允许 NULL → 值）
  后处理: 审计 chain.block.mined；对本块 content 源证书失效对应内容详情缓存
```

- **防饿死阀门是必须的**：只有「满才打包」会让个人站点的最后一次变更永远停在 pending。默认 30s 上限保证任何证书最迟约 30s + 挖矿时长内确认。
- **超出单块上限**：剩余证书留在缓冲，下一轮 tick 缓冲仍满、立即连挖下一块；低于批量阈值且未超时的剩余量等待下一次触发。
- **优雅关闭**：context 取消会中止尚未提交的 sim 延迟或 proof 搜索，`RouterWithLifecycle` 等待矿工 goroutine 退出后再排空审计队列；未组块证书保留在持久 pending 集中，重启后续挖。
- **故障自愈**：矿工 panic → recover → 审计 `chain.miner.crashed` → 5s 后重启循环。SQLite 单连接（`SetMaxOpenConns(1)`）已消除写竞争。
- **审计事件**：`chain.anchor.submitted`（含 source）、`chain.block.mined`（index、证书数、nonce、模式、耗时 ms）、`chain.anchor.failed`（提交失败、含 source 与原因）、`chain.miner.crashed`。审计事件本身不上链（4.2 例外）。
- **证书提交失败不阻塞业务**：`Submit()` 报错只记 `chain.anchor.failed`，原业务请求照常成功返回。
- **实现事实**：矿工 goroutine 由 `handler.RouterWithLifecycle` 启动（main 构造 `chain.NewLedger` 后传入），其 `OnMined` 钩子（仅在本轮真正产出区块时触发——空转 tick 不触发）发布 `chain.block.mined` 审计并对本块 content 源证书按 metadata.slug 失效内容缓存；close 顺序为取消矿工、等待 goroutine 退出、再 drain 审计队列。`main.go` 在启动矿工前调用 `seedAnchorsForDevContents`：链为空（新库或首次启用链）时为全部 PUBLISHED 内容补签 PUBLISHED 证书（payload 经 `internal/application` 构造，不复制格式）。业务写入由 `internal/application` 统一编排持久化后的 audit、anchor 和缓存失效，handler 只负责 HTTP 边界。PoW（sim 延迟与 proof 碰撞）在**事务外**执行：头部组装先对 tip 快照挖矿，随后短事务复查 tip 未变再落块，tip 已移动则由下一轮 tick 重新评估；context 取消发生在事务提交前时，本轮块不落库——SQLite 单连接下把挖矿放进事务会冻结全部请求。`subject_ref` 是 `Submit()` 的显式参数（调用方按 §4.1 语义传入），不从 metadata 推导。

## 10. 验证语义

所有 verify 入口统一返回 `VerifyResponse`：

```text
{ found, anchor?, block?, signatureValid, chainIntegrity, steps, merkle?, context? }
```

`verify/comment/{id}` 优先按当前评论投影（含 `authorAvatarUrl`）查证；对已有的不含该字段的评论证书回退到原投影哈希，确保历史证书仍可验证。新证书始终覆盖当前表格列出的完整 payload。

- `signatureValid`：用证书自带的 `site_public_key` 对 `subject_hash` 验证 `site_signature`。
- **限流**：verify 每请求全链重放，四个入口共用独立限流桶（`CORE_CHAIN_VERIFY_RATE_PER_MIN`，默认 20/min），命中 `429`；Web 端按钮同步冷却，防止按住不放打满 CPU/DB。
- `chainIntegrity`：**全链重放**——从 genesis 到 tip 逐块重算 `hash`（含 `proofMode`/`difficulty`）、校验 `prev_hash` 串接、按 `cert_ids_json` 重算 `cert_root`；sim 块跳过前导 0 校验、proof 块强制校验。整个重放在**单个只读事务**内执行：矿工可能在重放中途提交新块，不取快照会让孤儿扫描读到「属于新块的证书、而块查询没看到该块」，在并发下产生虚假篡改报告。该事务与其中的每条查询都以调用方传入的 `context.Context` 开启（handler 传 `r.Context()`），因此客户端断开或服务关闭会中止在途重放，而不是为一个已经没人等待的请求把整条链走完。个人站点规模（数百块）下 O(n) 重放开销可忽略，且「每次验证都真验整条链」正是本探索的教学卖点。
- **`steps`（验证过程明细，chain 浏览器 proof-path 可视化用）**：固定 5 步——`lookup`（证书按 subject_hash 命中）、`signature`（ed25519 验签）、`merkle`（按 `cert_ids_json` 重算根并比较 `cert_root`）、`block-hash`（按头部 preimage 重算 `sha256(index‖prevHash‖timestamp‖certRoot‖proofMode‖difficulty‖nonce)`）、`chain`（全链重放统计）。每步含 `status`（passed/failed）、`detail`、以及**真实计算明细**：`inputs`（计算输入名值对，如验签的 publicKey/message/signature、块哈希的 7 个 preimage 字段）、`computations`（中间计算表达式 → 结果，如 merkle 每一层的 `sha256(a‖b)` 与父节点值）、`output`（该步结论）。
- **`merkle`（审计路径）**：证书所在块的 merkle 树路径——`leafIndex`、`leaf`（`sha256(cert id)`）、自底向上的 `siblings`（含左右位置）、`root` 与 `matches`（与 `block.certRoot` 比较），以及逐层 `computations`。
- **`context`（链上下文）**：`prev`/`current`/`next` 三个块摘要（`blockSummaryView`），`current` 是证书所在块，`prev`/`next` 按块索引相邻查询（genesis 无 prev、tip 无 next 时为 `null`），供 Web 渲染「前一块 → 当前块 → 后一块」链结构并跳转账本。
- `found=false` 时其余字段为缺省（`signatureValid`/`chainIntegrity` 仍返回全链结果，允许验证不存在的哈希时顺带确认链完整性；`steps` 只含 lookup 失败与 chain 两步）。
- **同哈希多证书**：同一正文多次提交（重发布、幂等请求）会产生相同 `subject_hash` 的多张证书。按哈希查证时返回**最新一张**（`createdAt` 降序、并列 `id` 降序的第一条），`found` 即表示「该哈希曾至少被承诺一次」。

不可撤销性的诚实属性：

- **隐藏/删除不撤销承诺**：评论被隐藏或软删后只是从公开视图消失；其创建时证书的哈希永久留在链上。持有原文的任何人（包括在隐藏前看过的人）仍能贴文重算哈希证明它曾被锚定。这是承诺模式的固有属性，也是「区块链记忆 vs 站点审核」张力的教学案例——审核只控制可见性，链承诺的是历史存在性。为与公开可见性一致，`verify/comment/{id}` 对隐藏/软删评论返回 404。
- **写入者作恶不在防护范围**：single-writer 链只能证明「历史未被篡改」，无法证明 Core 本身诚实（见第 1 节诚实边界）。

## 11. 契约与 SDK

`packages/contracts/src/index.ts` 新增（修改顺序遵循 contracts → sdk → core → web/admin）：

```ts
export type ChainProofMode = "sim" | "proof";
export type AnchorStatus = "pending" | "anchored";
export type AnchorSource = "content" | "comment" | "reaction" | "profile" | "site" | "media" | "auth" | "visitor" | "admin";
export type AnchorMetadata = Record<string, string | number | boolean | null>;

export interface ChainPublicKey { keyId: string; publicKey: string; createdAt: string }
export interface ChainAnchor { id: string; subjectHash: string; source: AnchorSource; subjectRef: string; label: string; metadata: AnchorMetadata; siteKeyId: string; sitePublicKey: string; siteSignature: string; createdAt: string; status: AnchorStatus; blockId: string | null }
export interface SubmitAnchorInput { payload: string; label?: string }
export interface SubmitAnchorResponse { anchorId: string; subjectHash: string; status: "pending" }
export interface ChainBlockSummary { id: string; index: number; prevHash: string; timestamp: string; certRoot: string; nonce: number; proofMode: ChainProofMode; difficulty: number; hash: string; anchorCount: number }
export interface ChainBlockDetail extends ChainBlockSummary { certIds: string[]; anchors: ChainAnchor[] }
export interface ChainInfo { height: number; totalAnchors: number; pendingAnchors: number; proofMode: ChainProofMode; difficulty: number; genesisHash: string; tipHash: string; sitePublicKey: string }
export interface VerifyResponse { found: boolean; anchor: ChainAnchor | null; block: ChainBlockSummary | null; signatureValid: boolean; chainIntegrity: boolean }
export interface AnchorQuery { source?: AnchorSource; ref?: string; page?: number; pageSize?: number }
```

`ContentDetail` 增量（向后兼容，Core 一律输出键）：`latestAnchor: { anchorId: string; subjectHash: string; status: AnchorStatus; blockId: string | null } | null`——按 `subject_ref = contentId` 的最新 content 源证书填充，无证书时为 `null`。

`packages/sdk/src/index.ts` 新增方法：`chain()`、`submitAnchor(input)`、`anchors(query?)`、`anchor(id)`、`blocks(query?)`、`block(id)`、`verifyByHash(hash)`、`verifyPayload(payload)`、`verifyContent(slug)`、`verifyComment(id)`、`chainKeys()`、`adminSubmitAnchor(input)`。

## 12. Web 展示

1. **内容详情页徽标**（Writing 与 Thought 详情页）：由 `ContentDetail.latestAnchor` 驱动，展示内容指纹（`subjectHash` 截断）、`pending`（挖矿中）/`anchored`（含块高）状态；已封存证书深链 `/chain/explorer?tab=blocks&block=<blockId>`，pending 状态进入 `/chain/tools?tab=submit`。
2. **`/chain` 路由组**：
   - `/chain` 只负责高度、证书总数、pending 数、当前 proofMode/difficulty、站点公钥、genesis/tip 和最近活动，并提供 Explorer/Tools 入口。
   - `/chain/explorer` 负责区块与证书分页浏览；证书支持 source/ref 筛选，区块和证书详情使用查询参数保持可寻址，并可在详情间继续跳转。
   - `/chain/tools` 提供贴原文（POST verify）、按哈希、内容 slug、评论 ID 查证，以及公开提交和 pending 记录。
   - Web 不做任何哈希/规范化——一律调 Core。旧 `/chain?block=<id>` 与 `/chain?page=N` 由 Web 服务端兼容导向 Explorer。
3. Admin 本轮不新增 UI。

## 13. 错误处理

| 场景 | 状态码 / 语义 |
| --- | --- |
| 公开提交 payload 超 `CORE_CHAIN_ANCHOR_MAX_BYTES` | `413 PAYLOAD_TOO_LARGE` |
| label 超 64 字符、payload 空、请求体非法 | `422 VALIDATION_ERROR` / `400` |
| 限流命中（公开 POST 与 verify 入口） | `429`（公开提交沿用 `publicLimiter`；verify 走独立 `verifyLimiter`，默认 20/min） |
| `source`/`ref` 非法、分页参数非法 | `400 INVALID_QUERY` |
| verify 的 hash 非 64 位 hex | `400 INVALID_QUERY` |
| verify content/comment 目标不存在或不可见 | `404`（对齐公开可见性） |
| Admin 通道未带 JWT | `401`（沿用 RequireAdmin） |

## 14. 修改与验证清单

本文档与 `docs/core.md` 同级管理：**任何触及锚定链行为或数据库写路径的变更，都必须在同一变更中 review 并同步本文。**

- 新增数据库写路径 → 在 4.1 登记 source/payload/`subject_ref`/metadata，或说明归入 4.2 例外，并接入 `Submit()`。
- 新增/修改 source 枚举、payload 格式、区块结构、哈希/Merkle 公式、挖矿触发条件、验证语义 → 同步本文对应小节，并按触及面同步 `docs/core.md`（新路由/配置/表）、`docs/decisions/web.md` 与 `docs/web.md`（/chain 路由或徽标变化）、`packages/contracts/README.md`、`packages/sdk/README.md`。
- 修改 `CORE_CHAIN_*` 配置 → 同步第 5 节与 README 配置表。

关键测试期望：

- chain 单测：canonical 确定性（key 乱序同哈希）、Merkle 与区块哈希公式、proof 低难度确定性碰撞、sim 1s 出块、genesis 结构、**proof 块时间戳在 PoW 前冻结（注入时钟，读一次/块，全链重放完整）**、篡改任一历史块（hash/prev_hash/cert_root/证书行）→ 全链重放失败、验签对错公钥的行为。
- API 测试：公开提交 202 → pending → 矿工确认 → anchored 全流程；413 超限；Admin 通道无 JWT 401；verify 四种入口的往返（提交文本 → 按哈希/贴原文查证）；内容发布 → `verify/content/{slug}` 命中。
- 迁移测试：`0005` 在 `userVersion=4` 旧库上增量升级成功。
- Store 测试：dev seed 在新库补签 20 张 content 证书。

```bash
cd app/core && go test -count=1 ./... && go vet ./...
cd ../..
pnpm check
pnpm test
pnpm build
pnpm browser-test
git diff --check
```
