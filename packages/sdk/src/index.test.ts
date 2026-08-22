import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, ManifoldClient } from "./index.js";
test("throws ApiError for structured failures", async () => {
  const client = new ManifoldClient({ baseUrl: "http://core.test", fetch: async () => new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Token required" } }), { status: 401 }) });
  await assert.rejects(client.health(), (error: unknown) => error instanceof ApiError && error.status === 401 && error.code === "UNAUTHORIZED");
});
