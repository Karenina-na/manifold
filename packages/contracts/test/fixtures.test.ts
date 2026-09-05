import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type {
  AdminComment,
  AdminContent,
  AdminSessionList,
  ApiErrorBody,
  AuditEvent,
  Collection,
  Comment,
  Profile,
  SiteComposition,
} from "../src/index.ts";

const wire = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/wire.json", import.meta.url)), "utf8")) as {
  collection: Collection<CollectionFixture>;
  adminContent: AdminContent;
  comment: Comment;
  adminComment: AdminComment;
  profile: Profile;
  site: SiteComposition;
  auditEvent: AuditEvent;
  error: ApiErrorBody;
  sessionList: AdminSessionList;
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
