import { readAccountOrganizationContext } from "@openmeld/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { Route } from "./organization-context";

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

describe("Web account Organization context boundary", () => {
	it.each([
		200, 401, 503,
	])("routes the shared credentialed client to Auth and preserves HTTP %s", async (status) => {
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
					"https://auth.openmeld.test/v1/account/organization-context"
				);
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
				if (status === 200) {
					expect(response.headers.get("cache-control")).toBe(
						"private, no-store"
					);
				}
				return response;
			},
		});
		const result = readAccountOrganizationContext(client);
		if (status === 200) {
			await expect(result).resolves.toEqual(projection);
		} else if (status === 401) {
			await expect(result).resolves.toBeNull();
		} else {
			await expect(result).rejects.toMatchObject({ status });
		}
	});
});
