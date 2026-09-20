import { afterEach, describe, expect, it, vi } from "vitest";
import { readAccountOrganizationContextFromRequest } from "./account-organization-context.server";

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () =>
		new Headers({
			cookie: "session=current-account",
			"x-openmeld-profile-id": "not-an-authority",
		}),
}));
vi.mock("#/env", () => ({
	getRequiredServerEnv: () => "https://auth.openmeld.test",
}));
vi.mock("./organization-scope-observability.server", () => ({
	scheduleOrganizationScopeTimingEvidence: () => undefined,
}));

afterEach(() => vi.unstubAllGlobals());

describe("SSR account Organization context", () => {
	it.each([
		200, 401, 503,
	])("forwards request credentials and preserves status %s", async (status) => {
		const payload = {
			currentUserId: "current-account",
			account: { email: null, name: null, image: null },
			organizations: [],
			defaultOrganizationId: null,
		};
		vi.stubGlobal(
			"fetch",
			vi.fn((resource: RequestInfo | URL, init?: RequestInit) => {
				expect(String(resource)).toBe(
					"https://auth.openmeld.test/v1/account/organization-context"
				);
				expect(new Headers(init?.headers).get("cookie")).toBe(
					"session=current-account"
				);
				expect(new Headers(init?.headers).has("x-openmeld-profile-id")).toBe(
					false
				);
				return Promise.resolve(Response.json(payload, { status }));
			})
		);
		const result = readAccountOrganizationContextFromRequest("/o/acme");
		if (status === 200) {
			await expect(result).resolves.toEqual(payload);
		} else if (status === 401) {
			await expect(result).resolves.toBeNull();
		} else {
			await expect(result).rejects.toMatchObject({ status: 503 });
		}
	});
});
