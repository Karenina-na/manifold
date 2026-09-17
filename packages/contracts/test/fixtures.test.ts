import test from "node:test";
import { isApiErrorCode } from "../src/index.ts";
import { wire } from "./fixtures/wire.ts";

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
  // The comment fixture used to omit these two, and nothing noticed: the JSON
  // was read through an unchecked assertion, so a missing required field was
  // invisible to both tsc and this test.
  if (wire.comment.authorProvider !== "visitor" || wire.comment.authorAvatarUrl !== "") throw new Error("comment author identity");
  if (wire.adminComment.authorProvider !== wire.comment.authorProvider) throw new Error("admin comment author identity");
  if (wire.adminComment.deletedAt !== null) throw new Error("admin deletedAt");
  if (wire.adminComment.hiddenAt !== null) throw new Error("admin hiddenAt");
  if (wire.site.pinnedThoughts.length !== 0 || wire.site.pinnedWritings.length !== 0) throw new Error("site featured");
  if (wire.auditEvent.requestId !== "req_abc123") throw new Error("audit requestId");
  if (wire.error.error.code !== "VALIDATION_ERROR") throw new Error("error code");
  // The fixture used to pin VALIDATION_FAILED, a code Core has never emitted.
  if (!isApiErrorCode(wire.error.error.code)) throw new Error("error code is not modelled");
  if (wire.sessionList.sessions.length !== 2) throw new Error("session list length");
  if (wire.agentMessages.messages[0]?.role !== "assistant" || wire.agentMessages.messages[0]?.trace?.steps.length !== 2 || wire.agentEvents.at(-1)?.type !== "run.completed") throw new Error("agent contract");
  if (wire.agentUndo.draft !== "Revise this" || wire.agentUndo.messages.length !== 1) throw new Error("agent undo contract");
  const current = wire.sessionList.sessions.find((session) => session.current);
  if (current?.active !== true || current?.revokedAt !== null) throw new Error("session current active");
  const revoked = wire.sessionList.sessions.find((session) => !session.active);
  if (revoked?.revokedAt === null) throw new Error("session revoked at");
  if (wire.adminOverview.content.contentCount !== 12 || wire.adminOverview.trend.monthly.length !== 1) throw new Error("admin overview");
  if (wire.adminOverview.topContent[0]?.title !== "An Article") throw new Error("admin overview top content");
  if (wire.analyticsViews.range.days !== 30 || wire.analyticsViews.daily.length !== 1) throw new Error("analytics views");
  if (wire.systemStatus.resources.cpuCores !== 8 || wire.systemStatus.auditEventCount !== 42) throw new Error("system status");
  if (wire.auditEventCollection.events[0]?.id !== wire.auditEvent.id) throw new Error("audit envelope");
  if (wire.auditEventCollection.pagination.totalPages !== 1) throw new Error("audit envelope pagination");
  if (wire.media.url === "" || wire.media.mime !== "image/png") throw new Error("media url");
  if (wire.mediaReferences.references.length !== 2) throw new Error("media references");
  // The reference list is only ever built from non-deleted content, so the
  // status union there excludes DELETED. Both surviving values are pinned so a
  // future switch over them has both branches exercised.
  const referenceStatuses = wire.mediaReferences.references.map((reference) => reference.status);
  if (!referenceStatuses.includes("DRAFT") || !referenceStatuses.includes("PUBLISHED")) throw new Error("media reference statuses");
  if (wire.contentDetail.body !== "A quiet thought, expanded.") throw new Error("content detail body");
  if (wire.contentDetail.latestAnchor?.blockId !== "block_2") throw new Error("content detail anchor");
  if (wire.contentDetailUnanchored.latestAnchor !== null) throw new Error("content detail unanchored");
});

test("chain wire fixtures conform to contracts", () => {
  if (wire.chainInfo.proofMode !== "sim" || wire.chainInfo.height !== 3) throw new Error("chain info");
  if (typeof wire.chainInfo.sitePublicKey !== "string" || wire.chainInfo.sitePublicKey.length !== 64) throw new Error("chain site key");
  if (wire.chainAnchor.source !== "content" || wire.chainAnchor.status !== "anchored") throw new Error("chain anchor");
  if (wire.chainAnchor.blockId !== "block_2") throw new Error("chain anchor block");
  if (wire.chainAnchor.metadata.version !== 1 || wire.chainAnchor.metadata.kind !== "ARTICLE") throw new Error("chain anchor metadata");
  // summary/target are required by the contract and always emitted by Core;
  // the fixture omitted both, so the explorer's derived fields were unpinned.
  if (wire.chainAnchor.summary === "") throw new Error("chain anchor summary");
  if (wire.chainAnchor.target?.kind !== "content" || wire.chainAnchor.target.href !== "/writing/a-small-signal") throw new Error("chain anchor target");
  if (wire.chainBlock.anchorCount !== 1 || wire.chainBlock.proofMode !== "sim") throw new Error("chain block");
  if (wire.chainBlockDetail.certIds.length !== wire.chainBlock.anchorCount) throw new Error("chain block detail cert ids");
  if (wire.chainBlockDetail.anchors[0]?.id !== wire.chainAnchor.id) throw new Error("chain block detail anchors");
  if (wire.chainVerify.found !== true || wire.chainVerify.signatureValid !== true || wire.chainVerify.chainIntegrity !== true) throw new Error("chain verify");
  if (wire.chainVerify.anchor?.id !== wire.chainAnchor.id) throw new Error("chain verify anchor");
  // steps/merkle/context are all required on VerifyResponse and were absent
  // from the fixture entirely; merkle.computations was missing from the
  // contract too, so Core emitted a field no type described.
  if (wire.chainVerify.steps.length !== 2 || wire.chainVerify.steps[0]?.status !== "passed") throw new Error("verify steps");
  if (wire.chainVerify.merkle?.computations.length !== 1) throw new Error("verify merkle computations");
  if (wire.chainVerify.merkle.matches !== true || wire.chainVerify.merkle.root !== wire.chainBlock.certRoot) throw new Error("verify merkle root");
  if (wire.chainVerify.context?.current?.id !== wire.chainBlock.id || wire.chainVerify.context.prev !== null) throw new Error("verify chain context");
});
