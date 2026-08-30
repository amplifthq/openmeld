import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/env", () => ({
	getRequiredServerEnv: (name: string) => {
		if (name === "BETTER_AUTH_URL") {
			return "http://localhost:8788";
		}
		if (name === "WEB_APP_URL") {
			return "http://localhost:3000";
		}
		throw new Error(`Unexpected environment variable: ${name}`);
	},
}));

vi.mock("#/lib/openmeld-api/proxy-cloudflare-runtime.server", () => ({
	readWebProxyCloudflareRuntimeEvidence: () => null,
}));

import { Route } from "./$profileId";

describe("Profile Web route", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>().mockResolvedValue(
				Response.json({
					ok: true,
					profile: { openMeldProfileId: "agt_profile_1" },
				})
			)
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("forwards profile edits to Auth instead of Gateway", async () => {
		const handlers = Route.options.server?.handlers as
			| {
					PATCH?: (input: { request: Request }) => Promise<Response>;
			  }
			| undefined;
		const patchHandler = handlers?.PATCH;
		if (typeof patchHandler !== "function") {
			throw new Error("Expected the Profile PATCH handler");
		}

		const request = new Request(
			"http://localhost:3000/v1/profiles/agt_profile_1",
			{
				body: JSON.stringify({ profileName: "Renamed Agent" }),
				headers: {
					"content-type": "application/json",
					cookie: "better-auth.session_token=session-123",
					origin: "http://localhost:3000",
				},
				method: "PATCH",
			}
		);

		const response = await patchHandler({ request } as never);

		expect(fetch).toHaveBeenCalledWith(
			"http://localhost:8788/v1/profiles/agt_profile_1",
			expect.objectContaining({
				method: "PATCH",
				redirect: "manual",
			})
		);
		const forwardedRequest = vi.mocked(fetch).mock.calls[0]?.[1];
		expect(new Headers(forwardedRequest?.headers).get("cookie")).toBe(
			"better-auth.session_token=session-123"
		);
		expect(readForwardedBody(forwardedRequest?.body)).toBe(
			JSON.stringify({ profileName: "Renamed Agent" })
		);
		expect(response.status).toBe(200);
	});
});

function readForwardedBody(body: BodyInit | null | undefined) {
	if (body instanceof ArrayBuffer) {
		return new TextDecoder().decode(body);
	}
	return String(body ?? "");
}
