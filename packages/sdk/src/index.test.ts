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
			return new Response(JSON.stringify({ data: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 } }), { status: 200 });
		},
	});

	await client.content({ kind: ["ARTICLE", "THOUGHT"], tag: "systems", pageSize: 10, limit: 99 } as never);
	assert.equal(captured?.url, "http://core.test/api/v1/content?kind=ARTICLE%2CTHOUGHT&tag=systems&pageSize=10");
	assert.equal(captured?.headers.get("Authorization"), "Bearer token-1");
});

test("requests tag aggregation and encodes content page filters", async () => {
	const requests: Request[] = [];
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		fetch: async (input, init) => {
			requests.push(new Request(input, init));
			return new Response(JSON.stringify({ data: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 } }), { status: 200 });
		},
	});

	await client.tags({ kind: "THOUGHT" });
	assert.equal(requests[0]?.url, "http://core.test/api/v1/tags?kind=THOUGHT");

	await client.content({ kind: "ARTICLE", q: "boundary", sort: "updated", aiAssisted: false, page: 3, pageSize: 10 });
	assert.equal(requests[1]?.url, "http://core.test/api/v1/content?kind=ARTICLE&q=boundary&sort=updated&aiAssisted=false&page=3&pageSize=10");

	await client.content({ kind: "ARTICLE", tag: ["systems", "go"] });
	assert.equal(requests[2]?.url, "http://core.test/api/v1/content?kind=ARTICLE&tag=systems%2Cgo");
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
	assert.equal(requests[1]?.method, "PUT");
	assert.deepEqual(await requests[1]?.json(), { featuredThoughtId: "thought-1" });
});

test("encodes admin status and full replacement update inputs", async () => {
	const requests: Request[] = [];
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		token: "token-1",
		fetch: async (input, init) => {
			requests.push(new Request(input, init));
			return new Response(JSON.stringify({ data: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 } }), { status: 200 });
		},
	});

	await client.adminContent({ status: "DRAFT", pageSize: 10 });
	await client.updateContent("content-1", { kind: "ARTICLE", slug: "updated", title: "Updated", summary: "", body: "Body", tags: [], metadata: { language: null, aiAssisted: false }, expectedVersion: 3 });
	assert.equal(requests[0]?.url, "http://core.test/api/v1/admin/content?status=DRAFT&pageSize=10");
	assert.equal(requests[1]?.url, "http://core.test/api/v1/admin/content/content-1");
	assert.equal(requests[1]?.method, "PUT");
	assert.deepEqual(await requests[1]?.json(), { kind: "ARTICLE", slug: "updated", title: "Updated", summary: "", body: "Body", tags: [], metadata: { language: null, aiAssisted: false }, expectedVersion: 3 });
});

test("URL-encodes path segments for admin mutations", async () => {
	const requests: Request[] = [];
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		fetch: async (input, init) => {
			requests.push(new Request(input, init));
			return new Response(JSON.stringify({ id: "x" }), { status: 200 });
		},
	});

	await client.publishContent("content 1/x");
	await client.deleteContent("content 1/x");
	await client.restoreContent("content 1/x");
	await client.deleteComment("comment 1/x");
	await client.updateContent("content 1/x", { kind: "THOUGHT", slug: "thought", title: null, summary: "", body: "Body", tags: [], metadata: { mood: null, question: null, context: null, source: null }, expectedVersion: 1 });
	assert.equal(requests[0]?.url, "http://core.test/api/v1/admin/content/content%201%2Fx/publish");
	assert.equal(requests[1]?.url, "http://core.test/api/v1/admin/content/content%201%2Fx");
	assert.equal(requests[2]?.url, "http://core.test/api/v1/admin/content/content%201%2Fx/restore");
	assert.equal(requests[3]?.url, "http://core.test/api/v1/admin/comments/comment%201%2Fx");
	assert.equal(requests[4]?.url, "http://core.test/api/v1/admin/content/content%201%2Fx");
});

test("supports comment moderation and author updates", async () => {
	const requests: Request[] = [];
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		token: "token-1",
		fetch: async (input, init) => {
			requests.push(new Request(input, init));
			return new Response(null, { status: 204 });
		},
	});

	await client.hideComment("comment 1/x");
	await client.unhideComment("comment 1/x");
	await client.updateCommentAuthor("comment 1/x", { authorName: "Edited", authorUrl: null, avatarSeed: "seed-edited" });
	assert.equal(requests[0]?.url, "http://core.test/api/v1/admin/comments/comment%201%2Fx/hide");
	assert.equal(requests[0]?.method, "POST");
	assert.equal(requests[1]?.url, "http://core.test/api/v1/admin/comments/comment%201%2Fx/unhide");
	assert.equal(requests[1]?.method, "POST");
	assert.equal(requests[2]?.url, "http://core.test/api/v1/admin/comments/comment%201%2Fx");
	assert.equal(requests[2]?.method, "PUT");
	assert.deepEqual(await requests[2]?.json(), { authorName: "Edited", authorUrl: null, avatarSeed: "seed-edited" });
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
	await client.createContent({ kind: "ARTICLE", slug: "draft", title: "Draft", summary: "", body: "Body", tags: [], metadata: { language: null, aiAssisted: false } });
	assert.deepEqual(await captured?.json(), { kind: "ARTICLE", slug: "draft", title: "Draft", summary: "", body: "Body", tags: [], metadata: { language: null, aiAssisted: false } });
});

test("handles empty success responses", async () => {
	const client = new ManifoldClient({ baseUrl: "http://core.test", fetch: async () => new Response(null, { status: 204 }) });
	assert.equal(await client.deleteContent("content-1"), undefined);
});

test("lists media references with content status", async () => {
	const payload = { references: [{ contentId: "content-1", kind: "ARTICLE", title: "Used here", slug: "used-here", status: "PUBLISHED" }] };
	let captured: Request | undefined;
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		token: "token-1",
		fetch: async (input, init) => {
			captured = new Request(input, init);
			return new Response(JSON.stringify(payload), { status: 200 });
		},
	});
	const result = await client.mediaReferences("media 1/x");
	assert.equal(captured?.url, "http://core.test/api/v1/admin/media/media%201%2Fx/references");
	assert.equal(captured?.method, "GET");
	assert.equal(captured?.headers.get("Authorization"), "Bearer token-1");
	assert.deepEqual(result, payload);
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

test("sends the visitor id on tracked detail reads", async () => {
	const requests: Request[] = [];
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		fetch: async (input, init) => {
			requests.push(new Request(input, init));
			return new Response(JSON.stringify({ id: "c1" }), { status: 200 });
		},
	});

	await client.contentBySlug("a-piece", undefined, "visitor-123");
	await client.contentBySlug("a-piece", { trackView: false, referrer: "https://example.com" });
	assert.equal(requests[0]?.url, "http://core.test/api/v1/content/a-piece");
	assert.equal(requests[0]?.headers.get("X-Visitor-ID"), "visitor-123");
	assert.equal(requests[1]?.url, "http://core.test/api/v1/content/a-piece?trackView=false&referrer=https%3A%2F%2Fexample.com");
	assert.equal(requests[1]?.headers.get("X-Visitor-ID"), null);
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

test("posts change-password payload and returns void on 204", async () => {
	let captured: Request | undefined;
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		token: "token-1",
		fetch: async (input, init) => {
			captured = new Request(input, init);
			return new Response(null, { status: 204 });
		},
	});
	await client.changePassword({ currentPassword: "old", newPassword: "new-secret-9" });
	assert.equal(captured?.url, "http://core.test/api/v1/admin/password");
	assert.equal(captured?.method, "POST");
	assert.deepEqual(await captured?.json(), { currentPassword: "old", newPassword: "new-secret-9" });
	assert.equal(captured?.headers.get("Authorization"), "Bearer token-1");
});

test("posts logout endpoints", async () => {
	const urls: string[] = [];
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		token: "token-1",
		fetch: async (input, init) => {
			urls.push(new Request(input, init).url);
			return new Response(null, { status: 204 });
		},
	});
	await client.logoutSession();
	await client.logoutAllSessions();
	assert.deepEqual(urls, ["http://core.test/api/v1/admin/session/logout", "http://core.test/api/v1/admin/session/logout-all"]);
});

test("gets the admin session list", async () => {
	const payload = { sessions: [{ id: "ses_1", createdAt: "c", expiresAt: "e", revokedAt: null, active: true, current: true }] };
	let captured: Request | undefined;
	const client = new ManifoldClient({
		baseUrl: "http://core.test",
		token: "token-1",
		fetch: async (input, init) => {
			captured = new Request(input, init);
			return new Response(JSON.stringify(payload), { status: 200 });
		},
	});
	const result = await client.adminSessions();
	assert.equal(captured?.url, "http://core.test/api/v1/admin/session/list");
	assert.equal(captured?.method, "GET");
	assert.deepEqual(result, payload);
});
