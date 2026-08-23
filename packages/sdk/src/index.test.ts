import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, ManifoldClient } from "./index.js";
test("throws ApiError for structured failures", async () => {
	const client = new ManifoldClient({ baseUrl: "http://core.test", fetch: async () => new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Token required", details: { reason: "expired" }, requestId: "req_1" } }), { status: 401 }) });
	await assert.rejects(client.health(), (error: unknown) => error instanceof ApiError && error.status === 401 && error.code === "UNAUTHORIZED" && error.message === "Token required" && error.requestId === "req_1" && (error.details as { reason: string }).reason === "expired");
});

test("encodes collection queries and bearer authentication", async () => {
	let captured: Request | undefined;
	const client = new ManifoldClient({
		baseUrl: "http://core.test/",
		token: "token-1",
		fetch: async (input, init) => {
			captured = new Request(input, init);
			return new Response(JSON.stringify({ data: [], pagination: { nextCursor: null, hasMore: false } }), { status: 200 });
		},
	});

	await client.feed({ kind: ["POST", "NOTE"], tag: "systems", limit: 10 });
	assert.equal(captured?.url, "http://core.test/api/v1/feed?kind=POST%2CNOTE&tag=systems&limit=10");
	assert.equal(captured?.headers.get("Authorization"), "Bearer token-1");
});

test("encodes admin status, cursor, and partial update inputs", async () => {
	const requests: Request[] = [];
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		token: "token-1",
		fetch: async (input, init) => {
			requests.push(new Request(input, init));
			return new Response(JSON.stringify({ data: [], pagination: { nextCursor: null, hasMore: false } }), { status: 200 });
		},
	});

	await client.adminContent({ status: "DRAFT", cursor: "MQ", limit: 10 });
	await client.updateContent("content-1", { title: "Updated", expectedVersion: 3 });
	assert.equal(requests[0]?.url, "http://core.test/api/v1/admin/content?status=DRAFT&cursor=MQ&limit=10");
	assert.equal(requests[1]?.method, "PATCH");
	assert.deepEqual(await requests[1]?.json(), { title: "Updated", expectedVersion: 3 });
});

test("handles empty success responses", async () => {
	const client = new ManifoldClient({ baseUrl: "http://core.test", fetch: async () => new Response(null, { status: 204 }) });
	assert.equal(await client.deleteContent("content-1"), undefined);
});
