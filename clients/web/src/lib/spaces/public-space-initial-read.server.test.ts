import { describe, expect, it, vi } from "vitest";
import { readPublicSpaceInitialData } from "./public-space-initial-read.server";

describe("public Space initial server read", () => {
	it("loads an authorized bounded recent window through the anonymous request boundary", async () => {
		const paths: string[] = [];
		const proxyRequestImpl = vi.fn(({ request }: { request: Request }) => {
			const url = new URL(request.url);
			paths.push(`${url.pathname}${url.search}`);
			expect(request.headers.get("cookie")).toBeNull();
			if (url.pathname.endsWith("/entry-resolution")) {
				return Promise.resolve(jsonResponse(createAllowedEntry()));
			}
			if (url.pathname.endsWith("/status")) {
				return Promise.resolve(jsonResponse(createPublicReadData().status));
			}
			if (
				url.pathname.endsWith("/signals") &&
				!url.pathname.includes("/threads/")
			) {
				return Promise.resolve(jsonResponse(createPublicReadData().history));
			}
			if (url.pathname.endsWith("/threads")) {
				return Promise.resolve(jsonResponse(createPublicReadData().threads));
			}
			if (url.pathname.endsWith("/history-navigation")) {
				return Promise.resolve(jsonResponse({ entries: [], total: 1 }));
			}
			throw new Error(`Unexpected request: ${url.pathname}`);
		});

		const result = await readPublicSpaceInitialData({
			gatewayUrl: "https://gateway.openmeld.test",
			proxyRequestImpl,
			requestHeaders: new Headers(),
			spaceId: "space-123",
			webAppUrl: "https://openmeld.test",
		});

		expect(result.content?.signals).toEqual([
			expect.objectContaining({
				id: "read1141-main-240",
				data: { text: "read1141-main-240" },
			}),
		]);
		expect(paths).toEqual([
			"/v1/spaces/space-123/entry-resolution",
			"/v1/spaces/space-123/status",
			"/v1/spaces/space-123/signals?limit=80&recent=1",
			"/v1/spaces/space-123/threads",
			"/v1/spaces/space-123/history-navigation",
		]);
	});

	it("does not request content after the entry authority denies reading", async () => {
		const proxyRequestImpl = vi.fn(() =>
			Promise.resolve(
				jsonResponse({
					participation: { state: "unavailable" },
					recovery: null,
					safeContext: {},
					target: { spaceId: "space-private" },
					view: { state: "unavailable" },
				})
			)
		);

		const result = await readPublicSpaceInitialData({
			gatewayUrl: "https://gateway.openmeld.test",
			proxyRequestImpl,
			requestHeaders: new Headers(),
			spaceId: "space-private",
			webAppUrl: "https://openmeld.test",
		});

		expect(result.content).toBeUndefined();
		expect(proxyRequestImpl).toHaveBeenCalledTimes(1);
	});

	it("loads an anchored window and the selected Thread for a reply link", async () => {
		const paths: string[] = [];
		const proxyRequestImpl = vi.fn(({ request }: { request: Request }) => {
			const url = new URL(request.url);
			paths.push(`${url.pathname}${url.search}`);
			if (url.pathname.endsWith("/entry-resolution")) {
				return Promise.resolve(
					jsonResponse({
						...createAllowedEntry(),
						target: {
							signalId: "reply-150",
							spaceId: "space-123",
							threadRootSignalId: "root-149",
						},
					})
				);
			}
			if (url.pathname.endsWith("/status")) {
				return Promise.resolve(jsonResponse(createPublicReadData().status));
			}
			if (
				url.pathname.endsWith("/signals") &&
				!url.pathname.includes("/threads/")
			) {
				return Promise.resolve(jsonResponse(createPublicReadData().history));
			}
			if (url.pathname.endsWith("/threads")) {
				return Promise.resolve(
					jsonResponse({
						previews: [],
						threads: [
							{
								createdAt: "2026-09-17T00:00:00.000Z",
								createdByProfileId: "11111111-1111-4111-8111-111111111111",
								rootSignalId: "root-149",
								spaceId: "space-123",
								threadId: "thr_11111111-1111-4111-8111-111111111111",
								updatedAt: "2026-09-17T00:00:01.000Z",
							},
						],
					})
				);
			}
			if (url.pathname.endsWith("/history-navigation")) {
				return Promise.resolve(jsonResponse({ entries: [], total: 240 }));
			}
			if (
				url.pathname.endsWith(
					"/threads/thr_11111111-1111-4111-8111-111111111111/signals"
				)
			) {
				return Promise.resolve(
					jsonResponse({
						placements: [],
						signals: [
							{
								...createPublicReadData().history.signals[0],
								id: "reply-150",
								data: { text: "read1141-thread-reply" },
							},
						],
					})
				);
			}
			throw new Error(`Unexpected request: ${url.pathname}`);
		});

		const result = await readPublicSpaceInitialData({
			gatewayUrl: "https://gateway.openmeld.test",
			proxyRequestImpl,
			requestHeaders: new Headers(),
			signalId: "reply-150",
			spaceId: "space-123",
			threadRootSignalId: "root-149",
			webAppUrl: "https://openmeld.test",
		});

		expect(result.threadSignals?.signals[0]?.id).toBe("reply-150");
		expect(paths).toEqual([
			"/v1/spaces/space-123/entry-resolution?signalId=reply-150&threadRootSignalId=root-149",
			"/v1/spaces/space-123/status",
			"/v1/spaces/space-123/signals?aroundSignalId=root-149&beforeCount=30&afterCount=30",
			"/v1/spaces/space-123/threads",
			"/v1/spaces/space-123/history-navigation",
			"/v1/spaces/space-123/threads/thr_11111111-1111-4111-8111-111111111111/signals?includeWakeContinuation=conversation",
		]);
	});
});

function jsonResponse(value: unknown) {
	return new Response(JSON.stringify(value), {
		headers: { "content-type": "application/json" },
		status: 200,
	});
}

function createAllowedEntry() {
	return {
		participation: { state: "self_join_available" },
		recovery: null,
		safeContext: { spaceName: "Shared Roadmap" },
		target: { spaceId: "space-123" },
		view: { experience: "public", state: "allowed" },
	};
}

function createPublicReadData() {
	const generatedAt = "2026-09-17T00:00:00.000Z";
	return {
		status: {
			spaceId: "space-123",
			generatedAt,
			name: "Shared Roadmap",
			accessMode: "public",
			passwordProtected: false,
			dispatchPolicy: { mode: "mention_only" },
			publicationMode: "collaboration",
			allowedActions: ["post_message", "post_status", "stay_silent"],
			resultArchivePolicy: { mode: "space_reply_only" },
			entryBrief: "default",
			dispatchBrief: "default",
			members: {
				totalCount: 1,
				humanCount: 1,
				agentCount: 0,
				liveNowCount: 0,
				liveHumanCount: 0,
				liveAgentCount: 0,
			},
		},
		history: {
			signals: [
				{
					v: 1,
					id: "read1141-main-240",
					spaceId: "space-123",
					ts: 1_805_000_000_000,
					profile: {
						kind: "human",
						profileId: "profile-reader-fixture",
						profileName: "Reader Fixture",
					},
					type: "signal.text",
					data: { text: "read1141-main-240" },
				},
			],
			nextCursor: "older-page",
		},
		threads: { threads: [], previews: [] },
	};
}
