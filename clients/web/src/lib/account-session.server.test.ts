import { readAccountSession } from "@openmeld/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "#/routes/v1/account/session";
import { readAccountSessionFromRequest } from "./account-session.server";
import { createUnscopedWebOpenMeldApiFoundation } from "./openmeld-api/client";

const getRequestHeaders = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-start/server", () => ({ getRequestHeaders }));
vi.mock("#/env", () => ({
	getRequiredServerEnv: (name: string) =>
		name === "BETTER_AUTH_URL"
			? "https://auth.openmeld.test"
			: "https://web.openmeld.test",
}));
vi.mock("#/lib/openmeld-api/proxy-cloudflare-runtime.server", () => ({
	readWebProxyCloudflareRuntimeEvidence: () => null,
}));
afterEach(() => vi.unstubAllGlobals());

const projection = {
	session: { id: "session-current" },
	user: {
		id: "account",
		email: "account@example.com",
		name: "Account",
		image: null,
		emailVerified: true,
		createdAt: "2024-01-02T00:00:00.000Z",
	},
};

describe("portable account session Web boundary", () => {
	it.each([
		200, 401, 500, 503,
	])("preserves HTTP %s through the exact credentialed Web GET", async (status) => {
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string, init: RequestInit) => {
				expect(url).toBe("https://auth.openmeld.test/v1/account/session");
				expect(new Headers(init.headers).get("cookie")).toBe("session=current");
				return Promise.resolve(
					Response.json(projection, {
						status,
						headers: { "cache-control": "private, no-store" },
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
				expect(response.headers.get("cache-control")).toBe("private, no-store");
				return response;
			},
		});
		const result = readAccountSession(client);
		if (status === 200) {
			await expect(result).resolves.toEqual(projection);
		} else if (status === 401) {
			await expect(result).resolves.toBeNull();
		} else {
			await expect(result).rejects.toMatchObject({ status });
		}
	});

	it("captures each SSR request cookie without carrying other identity headers or previous accounts", async () => {
		const observed: (string | null)[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn((resource: RequestInfo | URL, init?: RequestInit) => {
				expect(String(resource)).toBe(
					"https://auth.openmeld.test/v1/account/session"
				);
				const headers = new Headers(init?.headers);
				observed.push(headers.get("cookie"));
				expect(headers.has("x-openmeld-profile-id")).toBe(false);
				return Promise.resolve(Response.json(projection));
			})
		);
		const reads = ["account-a", "account-b", null].map((account) => {
			getRequestHeaders.mockReturnValue(
				new Headers({
					...(account ? { cookie: `session=${account}` } : {}),
					"x-openmeld-profile-id": "not-identity",
				})
			);
			return readAccountSessionFromRequest();
		});
		await Promise.all(reads);
		expect(observed).toEqual(["session=account-a", "session=account-b", null]);
	});
});
