import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type {
  AdminComment,
  AdminContent,
  AdminSessionList,
  ApiErrorBody,
  AuditEvent,
  ChainBlockSummary,
  ChainInfo,
  ChainAnchor,
  Collection,
  Comment,
  HomeTimeline,
  Profile,
  SiteComposition,
  VerifyResponse,
} from "../src/index.ts";

const wire = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/wire.json", import.meta.url)), "utf8")) as {
  collection: Collection<CollectionFixture>;
  homeTimeline: HomeTimeline;
  adminContent: AdminContent;
  comment: Comment;
  adminComment: AdminComment;
  profile: Profile;
  site: SiteComposition;
  auditEvent: AuditEvent;
  error: ApiErrorBody;
  sessionList: AdminSessionList;
  chainInfo: ChainInfo;
  chainAnchor: ChainAnchor;
  chainBlock: ChainBlockSummary;
  chainVerify: VerifyResponse;
};

type CollectionFixture = Extract<Collection<never>["data"][number], { kind: "THOUGHT" | "ARTICLE" }>;

test("wire fixtures conform to contracts", () => {
  for (const item of wire.collection.data) {
    if (item.kind === "THOUGHT") {
      if (typeof item.metadata.mood !== "string" && item.metadata.mood !== null) throw new Error("thought metadata");
    } else if (typeof item.metadata.readingMinutes !== "number") {
      throw new Error("article metadata");
    }
  }
  if (wire.adminContent.status !== "DRAFT") throw new Error("admin status");
  if (wire.homeTimeline.totalItems !== 1 || wire.homeTimeline.truncated) throw new Error("home timeline bounds");
  if (wire.homeTimeline.data[0]?.kind !== "THOUGHT" || wire.homeTimeline.data[0]?.summary !== "Summary text") throw new Error("home timeline content");
  if (typeof wire.adminContent.body !== "string") throw new Error("admin body");
  if (wire.comment.authorUrl !== null) throw new Error("comment authorUrl null");
  if (wire.comment.hidden !== false) throw new Error("comment hidden");
  if (wire.adminComment.deletedAt !== null) throw new Error("admin deletedAt");
  if (wire.adminComment.hiddenAt !== null) throw new Error("admin hiddenAt");
  if (wire.site.pinnedThoughts.length !== 0 || wire.site.pinnedWritings.length !== 0) throw new Error("site featured");
  if (wire.auditEvent.requestId !== "req_abc123") throw new Error("audit requestId");
  if (wire.error.error.code !== "VALIDATION_FAILED") throw new Error("error code");
  if (wire.sessionList.sessions.length !== 2) throw new Error("session list length");
  const current = wire.sessionList.sessions.find((session) => session.current);
  if (current?.active !== true || current?.revokedAt !== null) throw new Error("session current active");
  const revoked = wire.sessionList.sessions.find((session) => !session.active);
  if (revoked?.revokedAt === null) throw new Error("session revoked at");
});

test("chain wire fixtures conform to contracts", () => {
  if (wire.chainInfo.proofMode !== "sim" || wire.chainInfo.height !== 3) throw new Error("chain info");
  if (typeof wire.chainInfo.sitePublicKey !== "string" || wire.chainInfo.sitePublicKey.length !== 64) throw new Error("chain site key");
  if (wire.chainAnchor.source !== "content" || wire.chainAnchor.status !== "anchored") throw new Error("chain anchor");
  if (wire.chainAnchor.blockId !== "block_2") throw new Error("chain anchor block");
  if (wire.chainAnchor.metadata.version !== 1 || wire.chainAnchor.metadata.kind !== "ARTICLE") throw new Error("chain anchor metadata");
  if (wire.chainBlock.anchorCount !== 1 || wire.chainBlock.proofMode !== "sim") throw new Error("chain block");
  if (wire.chainVerify.found !== true || wire.chainVerify.signatureValid !== true || wire.chainVerify.chainIntegrity !== true) throw new Error("chain verify");
  if (wire.chainVerify.anchor?.id !== wire.chainAnchor.id) throw new Error("chain verify anchor");
});
