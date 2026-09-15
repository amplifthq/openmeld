import type {
	PatchProfileSpaceHistoryStatusResponse,
	ProfileSpaceHistoryRecord,
	UpsertProfileSpaceHistoryResponse,
} from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
	server: false,
	gateway: "https://GATEWAY-B.test:8787",
}));
vi.mock("@tanstack/react-start", () => ({
	createIsomorphicFn: () => ({
		client: (client: (...args: unknown[]) => unknown) => ({
			server:
				(server: (...args: unknown[]) => unknown) =>
				(...args: unknown[]) =>
					(runtime.server ? server : client)(...args),
		}),
	}),
}));
vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => new Headers({ cookie: "session=ssr-owner" }),
}));
vi.mock("#/lib/openmeld-api/proxy-cloudflare-runtime.server", () => ({
	readWebProxyCloudflareRuntimeEvidence: () => null,
}));
vi.mock("#/env", () => ({
	getRequiredServerEnv: (name: string) => {
		if (name === "OPENMELD_GATEWAY_URL") {
			return runtime.gateway;
		}
		if (name === "WEB_APP_URL") {
			return "https://web-b.test";
		}
		if (name === "BETTER_AUTH_URL") {
			return "https://auth-b.test";
		}
		throw new Error(`Unexpected server env ${name}`);
	},
}));

import { updateProfileSpaceHistoryStatus } from "#/lib/onboarding/update-profile-space-history-status";
import { upsertProfileSpaceHistory } from "#/lib/onboarding/upsert-profile-space-history";
import { listStartProfiles } from "#/lib/profiles/existing-profiles";
import { readStartProfilesResponse } from "#/lib/profiles/profile-list-response";
import { isSessionExpiredError } from "#/lib/session-expired";
import { Route } from "#/routes/v1/client-environment";
import { Route as ProfilesRoute } from "#/routes/v1/profiles";
import { getAccountSpaceActiveWakeSummary } from "./account-space-active-wake";
import { listAccountSpaceIndex } from "./account-space-index";

const profileId = "11111111-1111-4111-8111-111111111111";
const spaceId = "space/one";
const timestamp = "2026-01-01T00:00:00.000Z";
const history: ProfileSpaceHistoryRecord = {
	profileId,
	spaceId,
	gatewayHost: "gateway-b.test:8787",
	spaceName: "Space",
	creatorProfileId: null,
	creatorKind: null,
	spaceCreatedAt: null,
	spaceUpdatedAt: null,
	lastJoinedAt: timestamp,
	lastSeenTs: 100,
	pinnedAt: null,
	status: "active",
	createdAt: timestamp,
	updatedAt: timestamp,
};
const historyResponse: UpsertProfileSpaceHistoryResponse = {
	item: history,
	spaceIndexOverlay: {
		repairAttempted: false,
		status: "applied",
		updated: true,
	},
};

function environmentResponse(): Response {
	const handler = (Route.options.server?.handlers as { GET: () => Response })
		.GET;
	return handler();
}

describe("account Space HTTP consumers", () => {
	beforeEach(() => {
		runtime.server = false;
		runtime.gateway = "https://GATEWAY-B.test:8787";
		vi.stubGlobal("window", { location: { origin: "https://web-b.test" } });
		vi.stubEnv("OPENMELD_GATEWAY_URL", "https://build-a.test");
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>((resource, init) => {
				const url = new URL(String(resource));
				if (url.pathname === "/v1/client-environment") {
					return Promise.resolve(environmentResponse());
				}
				if (url.pathname === "/v1/profiles") {
					return Promise.resolve(Response.json({ ok: true, profiles: [] }));
				}
				if (url.pathname === "/v1/account/spaces") {
					return Promise.resolve(
						Response.json({ pinnedItems: [], spaceItems: [] })
					);
				}
				if (url.pathname === "/v1/account/spaces/active-wake-summary") {
					return Promise.resolve(
						Response.json({ generatedAtMs: 1, items: [] })
					);
				}
				if (url.pathname.endsWith("/status")) {
					return Promise.resolve(
						Response.json({
							profileId,
							spaceId,
							gatewayHost: history.gatewayHost,
							status: "removed",
							updatedAt: timestamp,
						} satisfies PatchProfileSpaceHistoryStatusResponse)
					);
				}
				if (init?.method === "PATCH") {
					return Promise.resolve(Response.json(historyResponse));
				}
				throw new Error(`Unexpected request ${url}`);
			})
		);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it.each([
		false,
		true,
	])("uses the current endpoint host and preserves request options (SSR=%s)", async (server) => {
		runtime.server = server;
		await expect(listStartProfiles()).resolves.toEqual([]);
		await listAccountSpaceIndex({
			data: {
				profileId: ` ${profileId} `,
				scope: "profile",
				limit: 23,
				includeDirectMessageProfileIds: true,
				includePurposes: true,
			},
		});
		await getAccountSpaceActiveWakeSummary({ data: { profileId } });
		const requests = vi
			.mocked(fetch)
			.mock.calls.map(([url, init]) => ({ url: new URL(String(url)), init }));
		const index = requests.find(
			({ url }) => url.pathname === "/v1/account/spaces"
		);
		if (!index) {
			throw new Error("Missing account Space index request");
		}
		expect(Object.fromEntries(index.url.searchParams)).toEqual({
			gatewayHost: "gateway-b.test:8787",
			selectedProfileId: profileId,
			scope: "profile",
			limit: "23",
			includeRecentlyDeletedItems: "true",
			includeDirectMessageProfileIds: "true",
			includePurposes: "true",
			includeMemberPreviews: "true",
			includeMessagePreviews: "true",
		});
		for (const request of requests.filter(({ url }) =>
			url.pathname.startsWith("/v1/account/spaces")
		)) {
			expect(request.url.searchParams.get("gatewayHost")).toBe(
				history.gatewayHost
			);
			expect(
				new Headers(request.init?.headers).get("x-openmeld-profile-id")
			).toBe(profileId);
			expect(new Headers(request.init?.headers).get("cookie")).toBe(
				server ? "session=ssr-owner" : null
			);
			expect(request.url.host).toBe(
				server ? "gateway-b.test:8787" : "web-b.test"
			);
		}
		expect(
			requests.some(({ url }) => url.pathname.startsWith("/_serverFn"))
		).toBe(false);
		expect(
			requests.filter(({ url }) => url.pathname === "/v1/client-environment")
		).toHaveLength(server ? 0 : 2);
	});

	it.each([
		false,
		true,
	])("preserves automatic history, pin clearing and removal writes (SSR=%s)", async (server) => {
		runtime.server = server;
		await expect(
			upsertProfileSpaceHistory({
				data: {
					spaceId: ` ${spaceId} `,
					spaceName: null,
					lastSeenTs: 100,
					pinnedAt: null,
					items: [{ profileId }],
				},
			})
		).resolves.toEqual([historyResponse]);
		await updateProfileSpaceHistoryStatus({
			data: { profileId, spaceId, status: "removed", reason: " left " },
		});
		const writes = vi
			.mocked(fetch)
			.mock.calls.filter(([, init]) => init?.method === "PATCH");
		expect(writes).toHaveLength(2);
		expect(new URL(String(writes[0]?.[0])).pathname).toBe(
			`/v1/profiles/${profileId}/spaces/space%2Fone`
		);
		expect(await new Response(writes[0]?.[1]?.body).json()).toEqual({
			gatewayHost: history.gatewayHost,
			status: "active",
			lastSeenTs: 100,
			pinnedAt: null,
		});
		expect(await new Response(writes[1]?.[1]?.body).json()).toEqual({
			gatewayHost: history.gatewayHost,
			status: "removed",
			reason: "left",
		});
		for (const [, init] of writes) {
			expect(new Headers(init?.headers).get("x-openmeld-profile-id")).toBe(
				profileId
			);
		}
	});

	it.each([
		Response.json({ gatewayHost: "gateway-b.test", token: "forbidden" }),
		new Response("unavailable", { status: 503 }),
	])("rejects missing/invalid metadata before history mutation", async (response) => {
		vi.mocked(fetch).mockResolvedValue(response);
		await expect(
			upsertProfileSpaceHistory({ data: { spaceId, items: [{ profileId }] } })
		).rejects.toThrow();
		expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
		expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain(
			"/v1/client-environment"
		);
	});

	it.each([
		401, 403, 500,
	])("preserves API failure without RPC fallback (%s)", async (status) => {
		vi.mocked(fetch).mockImplementation((url) =>
			Promise.resolve(
				String(url).endsWith("/v1/client-environment")
					? environmentResponse()
					: Response.json(
							{
								ok: false,
								code:
									status === 401
										? "auth.unauthenticated"
										: "gateway.http_error",
								message: "refused",
							},
							{ status }
						)
			)
		);
		await expect(listStartProfiles()).rejects.toSatisfy((error: unknown) =>
			status === 401 ? isSessionExpiredError(error) : error instanceof Error
		);
		await expect(
			upsertProfileSpaceHistory({ data: { spaceId, items: [{ profileId }] } })
		).rejects.toMatchObject({ status });
		expect(
			vi
				.mocked(fetch)
				.mock.calls.every(([url]) => !String(url).includes("_serverFn"))
		).toBe(true);
	});

	it("publishes only current normalized runtime metadata without caching", () => {
		const response = environmentResponse();
		expect(response.headers.get("cache-control")).toBe("no-store");
		return expect(response.json()).resolves.toEqual({
			gatewayHost: "gateway-b.test:8787",
		});
	});

	it("routes the existing profile list to Auth with its session and preserves refusals", async () => {
		const handler = (
			ProfilesRoute.options.server?.handlers as {
				GET: (input: { request: Request }) => Promise<Response>;
			}
		).GET;
		vi.mocked(fetch).mockResolvedValue(
			Response.json(
				{
					ok: false,
					code: "auth.unauthenticated",
					message: "authentication required",
				},
				{ status: 401 }
			)
		);
		const response = await handler({
			request: new Request("https://web-b.test/v1/profiles", {
				headers: { cookie: "session=profile-owner" },
			}),
		});
		// The established browser Auth proxy maps 401 to 400 to avoid browser
		// auth prompts, while preserving the session-expired envelope.
		expect(response.status).toBe(400);
		await expect(readStartProfilesResponse(response)).rejects.toSatisfy(
			isSessionExpiredError
		);
		const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
		expect(url).toBe("https://auth-b.test/v1/profiles");
		expect(new Headers(init?.headers).get("cookie")).toBe(
			"session=profile-owner"
		);
		expect(init?.redirect).toBe("manual");
	});

	it("rejects malformed business responses rather than treating them as success", async () => {
		vi.mocked(fetch).mockImplementation((url) =>
			Promise.resolve(
				String(url).endsWith("/v1/client-environment")
					? environmentResponse()
					: Response.json({})
			)
		);
		await expect(listStartProfiles()).rejects.toThrow(
			"Invalid start profiles response"
		);
		await expect(
			listAccountSpaceIndex({ data: { profileId } })
		).rejects.toMatchObject({
			code: "gateway.invalid_response",
			message: "Invalid account spaces response",
		});
		await expect(
			getAccountSpaceActiveWakeSummary({ data: { profileId } })
		).rejects.toMatchObject({ code: "gateway.invalid_response" });
		await expect(
			upsertProfileSpaceHistory({ data: { spaceId, items: [{ profileId }] } })
		).rejects.toMatchObject({ code: "gateway.invalid_response" });
		await expect(
			updateProfileSpaceHistoryStatus({
				data: { profileId, spaceId, status: "removed" },
			})
		).rejects.toMatchObject({ code: "gateway.invalid_response" });
	});
});
