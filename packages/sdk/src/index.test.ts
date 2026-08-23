import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, ManifoldClient } from "./index.js";
test("throws ApiError for structured failures", async () => {
	const client = new ManifoldClient({ baseUrl: "http://core.test", fetch: async () => new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Token required", details: { reason: "expired" }, requestId: "req_1", traceId: "trace_1" } }), { status: 401 }) });
	await assert.rejects(client.health(), (error: unknown) => error instanceof ApiError && error.status === 401 && error.code === "UNAUTHORIZED" && error.message === "Token required" && error.requestId === "req_1" && error.traceId === "trace_1" && (error.details as { reason: string }).reason === "expired");
});

test("sends a trace id with every request", async () => {
	let captured: Request | undefined;
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		fetch: async (input, init) => {
			captured = new Request(input, init);
			return new Response(JSON.stringify({ status: "ok", version: "test" }), { status: 200 });
		},
	});

	await client.health();
	assert.match(captured?.headers.get("X-Trace-ID") ?? "", /^trace_[A-Za-z0-9_-]+$/);
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

test("sends visitor-scoped reaction requests", async () => {
	const requests: Request[] = [];
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		fetch: async (input, init) => {
			requests.push(new Request(input, init));
			return new Response(JSON.stringify({ likeCount: 1, favoriteCount: 0, viewerLiked: true, viewerFavorited: false }), { status: 200 });
		},
	});

	await client.reactions("a-piece", "visitor-123");
	await client.setReaction("a-piece", "LIKE", "visitor-123", true);
	assert.equal(requests[0]?.url, "http://core.test/api/v1/content/a-piece/reactions");
	assert.equal(requests[0]?.headers.get("X-Visitor-ID"), "visitor-123");
	assert.equal(requests[1]?.method, "PUT");
	assert.equal(requests[1]?.headers.get("X-Visitor-ID"), "visitor-123");
});

test("binds the default fetch implementation to its global owner", async () => {
	const originalFetch = globalThis.fetch;
	let receivedThis: unknown;
	globalThis.fetch = function (this: unknown, _input: RequestInfo | URL, _init?: RequestInit) {
		receivedThis = this;
		return Promise.resolve(new Response(JSON.stringify({ status: "ok", version: "test" }), { status: 200 }));
	} as typeof fetch;
	try {
		const client = new ManifoldClient({ baseUrl: "http://core.test" });
		await client.health();
		assert.equal(receivedThis, globalThis);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
