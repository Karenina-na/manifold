// Wire fixtures as typed literals rather than a parsed JSON blob.
//
// They used to live in wire.json and be read through a hand-written `as {...}`
// assertion in fixtures.test.ts. That assertion is not checked against the
// contract: a fixture could be missing a required field (the comment fixture
// lacked authorProvider/authorAvatarUrl, the anchor fixtures lacked
// summary/target, the verify fixture lacked steps/merkle/context) and both
// `tsc --noEmit` and the runtime test stayed green. Declaring each fixture with
// `satisfies` makes a missing required field or an unknown extra field a
// compile error, so the fixtures cannot drift from the contract silently.
import type {
  AdminComment,
  AdminContent,
  AdminOverview,
  AdminSessionList,
  AnalyticsViews,
  AgentMessageList,
  AgentStreamEvent,
  AgentUndoResult,
  ApiErrorBody,
  AuditEvent,
  AuditEventCollection,
  ChainAnchor,
  ChainBlockDetail,
  ChainBlockSummary,
  ChainInfo,
  Collection,
  Comment,
  Content,
  ContentDetail,
  HomeTimeline,
  Media,
  MediaReferenceList,
  Profile,
  SiteComposition,
  SystemStatus,
  VerifyResponse,
} from "../../src/index.ts";

export const collection = {
  data: [
    {
      id: "content_1750000000000000000",
      kind: "THOUGHT",
      slug: "a-quiet-thought",
      title: null,
      summary: "Summary text",
      excerpt: "Derived excerpt",
      tags: ["note", "meta"],
      metadata: { mood: "calm", question: null, context: "reading", source: null },
      publishedAt: "2026-08-24T10:00:00Z",
      createdAt: "2026-08-24T10:00:00Z",
      updatedAt: "2026-08-24T10:00:00Z",
      viewCount: 3,
      likeCount: 1,
      commentCount: 2,
    },
    {
      id: "content_1750000000000000001",
      kind: "ARTICLE",
      slug: "an-article",
      title: "An Article",
      summary: "Article summary",
      excerpt: "Article excerpt",
      tags: [],
      metadata: {
        readingMinutes: 6,
        toc: [{ id: "section", label: "Section", level: 2 }],
        language: "zh",
        aiAssisted: false,
      },
      publishedAt: "2026-08-25T10:00:00Z",
      createdAt: "2026-08-25T10:00:00Z",
      updatedAt: "2026-08-25T10:00:00Z",
      viewCount: 10,
      likeCount: 0,
      commentCount: 0,
    },
  ],
  pagination: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 },
} satisfies Collection<Content>;

// The detail view adds body and latestAnchor on top of the list item. Both
// directions of latestAnchor are pinned: the contract requires the key, Core
// reports null for a content that has no certificate yet.
export const contentDetail = {
  ...collection.data[0],
  body: "A quiet thought, expanded.",
  latestAnchor: {
    anchorId: `cert_${"e".repeat(64)}`,
    subjectHash: "b".repeat(64),
    status: "anchored",
    blockId: "block_2",
  },
} satisfies ContentDetail;

export const contentDetailUnanchored = { ...contentDetail, latestAnchor: null } satisfies ContentDetail;

export const homeTimeline = {
  data: [
    {
      id: "content_1750000000000000000",
      kind: "THOUGHT",
      slug: "a-quiet-thought",
      title: null,
      summary: "Summary text",
      publishedAt: "2026-08-24T10:00:00Z",
    },
  ],
  totalItems: 1,
  truncated: false,
} satisfies HomeTimeline;

export const adminContent = {
  id: "content_1750000000000000002",
  kind: "ARTICLE",
  status: "DRAFT",
  slug: "draft-article",
  title: "Draft Article",
  summary: "Draft summary",
  excerpt: "",
  tags: ["draft"],
  metadata: { readingMinutes: 0, toc: [], language: null, aiAssisted: false },
  publishedAt: null,
  createdAt: "2026-08-26T10:00:00Z",
  updatedAt: "2026-08-26T10:00:00Z",
  version: 2,
  viewCount: 0,
  likeCount: 0,
  commentCount: 0,
  body: "# Draft",
} satisfies AdminContent;

export const comment = {
  id: "comment_1750000000000000000",
  contentId: "content_1750000000000000000",
  authorName: "Guest",
  authorUrl: null,
  body: "Nice",
  createdAt: "2026-08-24T11:00:00Z",
  replyToId: null,
  avatarSeed: "seed-1",
  authorProvider: "visitor",
  authorAvatarUrl: "",
  hidden: false,
} satisfies Comment;

export const adminComment = {
  ...comment,
  id: "comment_1750000000000000001",
  authorName: "Admin",
  body: "Reply",
  createdAt: "2026-08-24T12:00:00Z",
  replyToId: "comment_1750000000000000000",
  avatarSeed: "seed-2",
  deletedAt: null,
  hiddenAt: null,
  contentTitle: "A thought",
  contentSlug: "a-quiet-thought",
  contentKind: "THOUGHT",
} satisfies AdminComment;

export const profile = {
  id: "profile_1",
  displayName: "Jane",
  handle: "@jane",
  headline: "Engineer",
  bio: "Bio",
  avatarUrl: "https://example.com/a.png",
  location: "Shanghai",
  organization: "Acme",
  websiteUrl: "https://jane.example",
  resumeUrl: null,
  interests: ["go"],
  education: [{ institution: "MIT", program: "CS", period: "2010-2014" }],
  experience: [{ organization: "Acme", role: "Dev", period: "2014-" }],
  series: [{ name: "S", url: "https://example.com", description: "d", category: null }],
  contacts: [{ label: "Email", url: "mailto:j@example.com", handle: null, icon: null }],
  updatedAt: "2026-08-24T10:00:00Z",
} satisfies Profile;

export const site = {
  title: "Manifold",
  description: "Desc",
  footer: "Footer",
  social: [{ label: "GitHub", href: "https://github.com", external: true }],
  commentsEnabled: true,
  navigation: [{ label: "Thoughts", href: "/thoughts", external: false }],
  sections: ["PROFILE", "RECENT_CONTENT", "CONTACT"],
  pinnedThoughts: [],
  pinnedWritings: [],
} satisfies SiteComposition;

export const auditEvent = {
  id: "audit_1750000000000000000",
  eventName: "content.updated",
  resourceType: "content",
  resourceId: "content_1750000000000000000",
  actor: "admin",
  requestId: "req_abc123",
  traceId: "trace_def456",
  metadataJson: '{"ok":true}',
  createdAt: "2026-08-24T10:00:00Z",
} satisfies AuditEvent;

// AuditEventCollection is not a `Collection<T>`: the events live under `events`,
// not `data`, which is why it needs its own fixture rather than reusing one.
export const auditEventCollection = {
  events: [auditEvent],
  pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
} satisfies AuditEventCollection;

export const adminOverview = {
  content: {
    contentCount: 12,
    draftCount: 2,
    articleCount: 4,
    thoughtCount: 8,
    wordCount: 9000,
    totalViews: 340,
    totalLikes: 21,
    totalComments: 7,
    activeVisitors: 3,
  },
  trend: { monthly: [{ month: "2026-08", created: 5, published: 4 }] },
  topContent: [
    { id: "content_1750000000000000001", kind: "ARTICLE", slug: "an-article", title: "An Article", viewCount: 120, likeCount: 9, commentCount: 3 },
  ],
  tags: [{ name: "go", count: 4 }],
} satisfies AdminOverview;

export const analyticsViews = {
  totalViews: 340,
  uniqueVisitors: 88,
  range: { days: 30, from: "2026-08-13T00:00:00Z", to: "2026-09-12T00:00:00Z" },
  daily: [{ date: "2026-09-12", views: 12, uniqueVisitors: 7 }],
  referrers: [{ source: "direct", count: 20 }],
} satisfies AnalyticsViews;

export const systemStatus = {
  version: "0.1.0",
  startedAt: "2026-09-12T00:00:00Z",
  uptimeSeconds: 3600,
  database: { sizeBytes: 4096 },
  caches: { contentEntries: 5 },
  runtime: { heapAllocBytes: 1048576, numGoroutine: 12, sysRssBytes: 20971520 },
  resources: {
    cpuPercent: 1.5,
    cpuCores: 8,
    memTotalBytes: 17179869184,
    memUsedBytes: 8589934592,
    memUsedPercent: 50,
    loadAvg1: 0.4,
    loadAvg5: 0.3,
    loadAvg15: 0.2,
    diskTotalBytes: 494384795648,
    diskUsedBytes: 247192397824,
    diskUsedPercent: 50,
  },
  host: { hostname: "manifold.local", os: "darwin", platform: "darwin", kernelArch: "arm64" },
  auditEventCount: 42,
} satisfies SystemStatus;

// url is a required key in the contract and Core no longer omits it, so the
// fixture carries the absolute address the admin writes back into Markdown.
export const media = {
  id: "media_1750000000000000000",
  url: "https://cdn.example/api/v1/media/media_1750000000000000000",
  mime: "image/png",
  size: 20480,
  filename: "cover.png",
  createdAt: "2026-08-24T10:00:00Z",
} satisfies Media;

export const mediaReferences = {
  references: [
    { contentId: "content_1750000000000000001", kind: "ARTICLE", title: "An Article", slug: "an-article", status: "PUBLISHED" },
    { contentId: "content_1750000000000000002", kind: "ARTICLE", title: null, slug: "draft-article", status: "DRAFT" },
  ],
} satisfies MediaReferenceList;

export const error = {
  error: {
    code: "VALIDATION_ERROR",
    message: "invalid input",
    requestId: "req_abc123",
    traceId: "trace_def456",
  },
} satisfies ApiErrorBody;

export const sessionList = {
  sessions: [
    {
      id: "ses_1750000000000000000",
      createdAt: "2026-08-24T09:00:00Z",
      expiresAt: "2026-08-24T21:00:00Z",
      revokedAt: null,
      active: true,
      current: true,
    },
    {
      id: "ses_1750000000000000001",
      createdAt: "2026-08-24T10:00:00Z",
      expiresAt: "2026-08-24T22:00:00Z",
      revokedAt: "2026-08-24T11:00:00Z",
      active: false,
      current: false,
    },
  ],
} satisfies AdminSessionList;

export const agentMessages = {
  messages: [{
    id: "msg_1",
    role: "assistant",
    content: "Hello.",
    createdAt: "2026-09-17T00:00:00Z",
    trace: {
      steps: [
        { id: "run_1-reasoning-0", kind: "reasoning", status: "complete" },
        { id: "call_1", kind: "tool", name: "get_current_time", input: {}, output: { date: "2026-09-17" }, status: "complete" },
      ],
      finishReason: "stop",
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    },
  }],
} satisfies AgentMessageList;

export const agentUndo = {
  draft: "Revise this",
  messages: [{ id: "msg_1", role: "user", content: "Earlier", createdAt: "2026-09-17T00:00:00Z" }],
} satisfies AgentUndoResult;

export const agentEvents = [
  { type: "run.started", runId: "run_1", messageId: "msg_1" },
  { type: "reasoning.started", runId: "run_1" },
  { type: "tool.started", callId: "call_1", name: "get_current_time", input: {} },
  { type: "tool.completed", callId: "call_1", name: "get_current_time", output: { date: "2026-09-17" }, isError: false },
  { type: "reasoning.completed", runId: "run_1" },
  { type: "content.delta", delta: "Hello." },
  { type: "run.completed", runId: "run_1", finishReason: "stop", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } },
] satisfies AgentStreamEvent[];

export const chainInfo = {
  height: 3,
  totalAnchors: 7,
  pendingAnchors: 1,
  proofMode: "sim",
  difficulty: 0,
  genesisHash: "a".repeat(64),
  tipHash: "c".repeat(64),
  sitePublicKey: "d".repeat(64),
} satisfies ChainInfo;

// A content anchor carries the derived summary/target pair the explorer renders
// (docs/chain.md §6); the values mirror what anchorSummary/anchorTarget produce
// for a published Writing.
export const chainAnchor = {
  id: `cert_${"e".repeat(64)}`,
  subjectHash: "b".repeat(64),
  source: "content",
  subjectRef: "content_1",
  label: "",
  metadata: { contentId: "content_1", kind: "ARTICLE", status: "PUBLISHED", version: 1, slug: "a-small-signal" },
  siteKeyId: "site_key_1",
  sitePublicKey: "d".repeat(64),
  siteSignature: "f".repeat(128),
  createdAt: "2026-09-06T00:00:00Z",
  status: "anchored",
  blockId: "block_2",
  summary: "Writing “a-small-signal” · published · v1",
  target: { kind: "content", href: "/writing/a-small-signal", label: "Writing “a-small-signal”" },
} satisfies ChainAnchor;

export const chainBlock = {
  id: "block_2",
  index: 2,
  prevHash: "a".repeat(64),
  timestamp: "2026-09-06T00:00:01Z",
  certRoot: "1".repeat(64),
  nonce: 0,
  proofMode: "sim",
  difficulty: 0,
  hash: "2".repeat(64),
  anchorCount: 1,
} satisfies ChainBlockSummary;

// The detail view is the summary plus the certificate ids and the anchors
// themselves; anchorCount in the summary has to agree with anchors.length.
export const chainBlockDetail = { ...chainBlock, certIds: [chainAnchor.id], anchors: [chainAnchor] } satisfies ChainBlockDetail;

// The verify response is the richest shape in the contract, and the fixture used
// to carry only the four verdict booleans plus anchor/block — steps, merkle and
// context were absent, so nothing pinned them.
export const chainVerify = {
  found: true,
  anchor: chainAnchor,
  block: chainBlock,
  signatureValid: true,
  chainIntegrity: true,
  steps: [
    {
      id: "lookup",
      label: "Certificate lookup",
      status: "passed",
      detail: "cert_eeee… → block_2",
      inputs: [
        { name: "subjectHash", value: "b".repeat(64) },
        { name: "certificate", value: `cert_${"e".repeat(64)}` },
      ],
      output: "cert sealed in block_2 ✓",
    },
    {
      id: "chain",
      label: "Chain replay",
      status: "passed",
      detail: "3 blocks replayed",
      inputs: [{ name: "height", value: "3" }],
      output: "intact ✓",
    },
  ],
  merkle: {
    leafIndex: 0,
    leaf: "3".repeat(64),
    siblings: [{ position: "right", value: "4".repeat(64) }],
    root: "1".repeat(64),
    matches: true,
    computations: [{ expression: `sha256(${"3".repeat(64)} ‖ ${"4".repeat(64)})`, value: "1".repeat(64) }],
  },
  context: { prev: null, current: chainBlock, next: null },
} satisfies VerifyResponse;

export const wire = {
  collection,
  contentDetail,
  contentDetailUnanchored,
  homeTimeline,
  adminContent,
  comment,
  adminComment,
  profile,
  site,
  auditEvent,
  auditEventCollection,
  adminOverview,
  analyticsViews,
  systemStatus,
  media,
  mediaReferences,
  error,
  sessionList,
  agentMessages,
  agentUndo,
  agentEvents,
  chainInfo,
  chainAnchor,
  chainBlock,
  chainBlockDetail,
  chainVerify,
};
