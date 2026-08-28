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

	await client.feed({ kind: ["ARTICLE", "THOUGHT"], tag: "systems", limit: 10 });
	assert.equal(captured?.url, "http://core.test/api/v1/feed?kind=ARTICLE%2CTHOUGHT&tag=systems&limit=10");
	assert.equal(captured?.headers.get("Authorization"), "Bearer token-1");
});

test("reads the paginated thought archive from Core", async () => {
	let captured: Request | undefined;
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		fetch: async (input, init) => {
			captured = new Request(input, init);
			return new Response(JSON.stringify({ featured: null, data: [], pagination: { page: 2, pageSize: 8, totalItems: 0, totalPages: 1 } }), { status: 200 });
		},
	});

	await client.thoughts({ page: 2, limit: 8 });
	assert.equal(captured?.url, "http://core.test/api/v1/thoughts?page=2&limit=8");
});

test("requests tag aggregation and encodes content page filters", async () => {
	const requests: Request[] = [];
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		fetch: async (input, init) => {
			requests.push(new Request(input, init));
			return new Response(JSON.stringify({ data: [], pagination: { nextCursor: null, hasMore: false } }), { status: 200 });
		},
	});

	await client.tags({ kind: "THOUGHT" });
	assert.equal(requests[0]?.url, "http://core.test/api/v1/tags?kind=THOUGHT");

	await client.content({ kind: "ARTICLE", q: "boundary", sort: "updated", aiAssisted: false, page: 3, limit: 10, skipFirst: true });
	assert.equal(requests[1]?.url, "http://core.test/api/v1/content?kind=ARTICLE&q=boundary&sort=updated&aiAssisted=false&page=3&limit=10&skipFirst=true");
});

test("reads and updates the admin thought configuration", async () => {
	const requests: Request[] = [];
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		token: "token-1",
		fetch: async (input, init) => {
			requests.push(new Request(input, init));
			return new Response(JSON.stringify({ featuredThoughtId: "thought-1", updatedAt: "2026-08-27T00:00:00Z" }), { status: 200 });
		},
	});

	await client.adminThoughtConfig();
	await client.updateThoughtConfig({ featuredThoughtId: "thought-1" });
	assert.equal(requests[0]?.url, "http://core.test/api/v1/admin/thoughts/config");
	assert.equal(requests[1]?.method, "PATCH");
	assert.deepEqual(await requests[1]?.json(), { featuredThoughtId: "thought-1" });
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

test("encodes typed content metadata for admin creation", async () => {
	let captured: Request | undefined;
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		fetch: async (input, init) => {
			captured = new Request(input, init);
			return new Response(JSON.stringify({ id: "content-1" }), { status: 201 });
		},
	});
	await client.createContent({ kind: "ARTICLE", slug: "draft", title: "Draft", summary: "", body: "Body", tags: [], metadata: { readingMinutes: 10 } });
	assert.deepEqual(await captured?.json(), { kind: "ARTICLE", slug: "draft", title: "Draft", summary: "", body: "Body", tags: [], metadata: { readingMinutes: 10 } });
});

test("handles empty success responses", async () => {
	const client = new ManifoldClient({ baseUrl: "http://core.test", fetch: async () => new Response(null, { status: 204 }) });
	assert.equal(await client.deleteContent("content-1"), undefined);
});

test("sends visitor-scoped like requests", async () => {
	const requests: Request[] = [];
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		fetch: async (input, init) => {
			requests.push(new Request(input, init));
			return new Response(JSON.stringify({ likeCount: 1, viewerLiked: true }), { status: 200 });
		},
	});

	await client.likes("a-piece", "visitor-123");
	await client.setLike("a-piece", "visitor-123", true);
	assert.equal(requests[0]?.url, "http://core.test/api/v1/content/a-piece/likes");
	assert.equal(requests[0]?.headers.get("X-Visitor-ID"), "visitor-123");
	assert.equal(requests[1]?.method, "PUT");
	assert.equal(requests[1]?.headers.get("X-Visitor-ID"), "visitor-123");
});

test("sends a presence heartbeat with the visitor id", async () => {
	let captured: Request | undefined;
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		fetch: async (input, init) => {
			captured = new Request(input, init);
			return new Response(JSON.stringify({ activeVisitors: 3, observedAt: "2026-08-25T10:00:00Z" }), { status: 200 });
		},
	});

	assert.deepEqual(await client.presence("visitor-123"), { activeVisitors: 3, observedAt: "2026-08-25T10:00:00Z" });
	assert.equal(captured?.url, "http://core.test/api/v1/presence");
	assert.equal(captured?.method, "POST");
	assert.equal(captured?.headers.get("X-Visitor-ID"), "visitor-123");
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
