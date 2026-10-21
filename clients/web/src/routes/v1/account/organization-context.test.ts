import { readAccountOrganizationContext } from "@openmeld/api-client";
import {
	OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS,
	observabilityCloudflareAnalyticsDataPointSchema,
} from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { Route } from "./organization-context";

const analytics = vi.hoisted(() => ({ writeDataPoint: vi.fn() }));

vi.mock("#/env", () => ({
	getRequiredServerEnv: (name: string) =>
		name === "BETTER_AUTH_URL"
			? "https://auth.openmeld.test"
			: "https://web.openmeld.test",
}));
vi.mock("#/lib/openmeld-api/proxy-cloudflare-runtime.server", () => ({
	readWebProxyCloudflareRuntimeEvidence: () => ({
		analytics,
		workerEnvironment: "test",
	}),
}));
afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

function readStageRecords() {
	return analytics.writeDataPoint.mock.calls.map(([point]) => {
		const parsed = observabilityCloudflareAnalyticsDataPointSchema.parse(point);
		return Object.fromEntries(
			OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS.map((key, index) => [
				key,
				parsed.blobs[index],
			])
		);
	});
}

describe("Web account Organization context boundary", () => {
	it("records dispatch before an upstream response exists", async () => {
		let markDispatched: () => void = () => undefined;
		const dispatched = new Promise<void>((resolve) => {
			markDispatched = resolve;
		});
		let finishUpstream: (response: Response) => void = () => undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(
				() =>
					new Promise<Response>((resolve) => {
						finishUpstream = resolve;
						markDispatched();
					})
			)
		);
		const handlers = Route.options.server?.handlers as {
			GET: (input: { request: Request }) => Promise<Response>;
		};
		const pending = handlers.GET({
			request: new Request(
				"https://web.openmeld.test/v1/account/organization-context",
				{ headers: { "x-request-id": "req-account-context-pending" } }
			),
		});
		await dispatched;
		expect(readStageRecords()).toEqual([
			expect.objectContaining({
				event: "web.openmeld.proxy_stage",
				reasonCode: "request_received",
				requestId: "req-account-context-pending",
				status: "started",
			}),
			expect.objectContaining({ reasonCode: "build_upstream_url" }),
			expect.objectContaining({ reasonCode: "forward_upstream" }),
		]);
		finishUpstream(
			new Response(null, {
				status: 401,
				headers: { "x-request-id": "req-account-context-pending" },
			})
		);
		expect((await pending).status).toBe(401);
		expect(readStageRecords().at(-1)).toMatchObject({
			event: "web.openmeld.proxy_request",
			requestId: "req-account-context-pending",
			reasonCode: "http_401",
		});
	});

	it.each([
		200, 401, 503,
	])("routes the shared credentialed client to Auth and preserves HTTP %s", async (status) => {
		let requestId: string | null = null;
		const projection = {
			account: { email: null, image: null, name: null },
			currentUserId: "account",
			organizations: [],
			defaultOrganizationId: null,
		};
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string, init: RequestInit) => {
				expect(url).toBe(
					"https://auth.openmeld.test/v1/account/organization-context?deferSessionRefresh=true"
				);
				expect(new Headers(init.headers).get("cookie")).toBe("session=current");
				requestId = new Headers(init.headers).get("x-request-id");
				return Promise.resolve(
					Response.json(projection, {
						status,
						headers: {
							"cache-control": "private, no-store",
							"x-request-id": requestId ?? "",
						},
					})
				);
			})
		);
		const handlers = Route.options.server?.handlers as {
			GET: (input: { request: Request }) => Promise<Response>;
		};
		const client = createUnscopedWebOpenMeldApiFoundation({
			baseUrl: "https://web.openmeld.test",
			fetchImpl: async (resource, init) => {
				expect(init?.credentials).toBe("include");
				const headers = new Headers(init?.headers);
				headers.set("cookie", "session=current");
				const response = await handlers.GET({
					request: new Request(String(resource), { ...init, headers }),
				});
				if (status === 200) {
					expect(response.headers.get("cache-control")).toBe(
						"private, no-store"
					);
				}
				return response;
			},
		});
		const result = readAccountOrganizationContext(client, {
			deferSessionRefresh: true,
		});
		if (status === 200) {
			await expect(result).resolves.toEqual(projection);
		} else if (status === 401) {
			await expect(result).resolves.toBeNull();
		} else {
			await expect(result).rejects.toMatchObject({ status });
		}
		const records = readStageRecords();
		expect(records.map((record) => record.reasonCode)).toEqual([
			"request_received",
			"build_upstream_url",
			"forward_upstream",
			"process_upstream_response",
			status >= 400 ? `http_${status}` : "",
		]);
		expect(requestId).toBeTruthy();
		expect(records.every((record) => record.requestId === requestId)).toBe(
			true
		);
		expect(JSON.stringify(analytics.writeDataPoint.mock.calls)).not.toContain(
			"session=current"
		);
	});
});
