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

import { Route } from "./display-name";

describe("Account Display Name Web route", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>().mockResolvedValue(
				Response.json({
					defaultHumanProfile: { profileName: "Felix" },
					displayName: "Felix",
					ok: true,
				})
			)
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("forwards the public Web request to Auth instead of Gateway", async () => {
		const handlers = Route.options.server?.handlers as
			| {
					PATCH?: (input: { request: Request }) => Promise<Response>;
			  }
			| undefined;
		const patchHandler = handlers?.PATCH;
		if (typeof patchHandler !== "function") {
			throw new Error("Expected the Account Display Name PATCH handler");
		}

		const request = new Request(
			"http://localhost:3000/v1/account/display-name",
			{
				body: JSON.stringify({ displayName: "Felix" }),
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
			"http://localhost:8788/v1/account/display-name",
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
			JSON.stringify({ displayName: "Felix" })
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
