import assert from "node:assert/strict";
import test from "node:test";
import { appendPendingCommit } from "../features/chain/use-pending-commits.ts";

function commit(id) {
  return {
    anchorId: id,
    subjectHash: id.padEnd(64, "0"),
    label: id,
    payload: id,
    at: "2026-09-11T00:00:00.000Z",
    status: "pending",
    blockId: null,
  };
}

test("pending commitments retain only the eight most recent entries", () => {
  const existing = Array.from({ length: 8 }, (_, index) => commit(String(index)));
  const next = appendPendingCommit(existing, commit("8"));

  assert.deepEqual(next.map((item) => item.anchorId), ["1", "2", "3", "4", "5", "6", "7", "8"]);
});
