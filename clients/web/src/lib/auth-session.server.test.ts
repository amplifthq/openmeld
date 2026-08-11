import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSessionFromGateway } from "./auth-session.server";

describe("auth session server fetch diagnostics", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("classifies runtime fetch throws before an HTTP response arrives", async () => {
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		await expect(
			fetchSessionFromGateway({
				betterAuthUrl: "https://auth.openmeld.test",
				currentUserSessionExpectation: "required",
				fetchImpl: vi
					.fn<typeof fetch>()
					.mockRejectedValue(new TypeError("fetch failed")),
				requestHeaders: new Headers({
					cookie: "session=abc",
				}),
				routeFamily: "/app",
			})
		).rejects.toThrow(
			"OpenMeld couldn't fetch the auth session before receiving an HTTP response."
		);

		expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
		expect(
			JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
		).toMatchObject({
			currentUserSessionExpectation: "required",
			event: "web.dev_ssr_fetch",
			hasCookie: true,
			kind: "auth_session_runtime_fetch_failed",
			operation: "fetch auth session",
			routeFamily: "/app",
			targetOrigin: "https://auth.openmeld.test",
			targetPath: "/api/auth/get-session?disableCookieCache=true",
		});
	});

	it("classifies non-2xx upstream responses without mislabeling them as runtime fetch failures", async () => {
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		await expect(
			fetchSessionFromGateway({
				betterAuthUrl: "https://auth.openmeld.test",
				fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
					new Response("blocked", {
						status: 503,
					})
				),
				requestHeaders: new Headers(),
				routeFamily: "/login",
			})
		).rejects.toThrow("Failed to fetch auth session: 503");

		expect(
			JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
		).toMatchObject({
			kind: "upstream_http_failure",
			routeFamily: "/login",
			status: 503,
		});
	});

	it("classifies invalid auth session payloads without treating them as runtime bridge failures", async () => {
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		await expect(
			fetchSessionFromGateway({
				betterAuthUrl: "https://auth.openmeld.test",
				fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
					new Response(JSON.stringify({ session: "bad", user: null }), {
						status: 200,
						headers: {
							"content-type": "application/json",
						},
					})
				),
				requestHeaders: new Headers({
					cookie: "session=abc",
				}),
				routeFamily: "/app/connect",
			})
		).rejects.toThrow(
			"Invalid auth session response: expected session and user fields."
		);

		expect(
			JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
		).toMatchObject({
			kind: "invalid_response_failure",
			routeFamily: "/app/connect",
			status: 200,
		});
	});

	it("bypasses Better Auth cookie cache for protected app routes", async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
			new Response("null", {
				status: 200,
				headers: {
					"content-type": "application/json",
				},
			})
		);

		await expect(
			fetchSessionFromGateway({
				betterAuthUrl: "https://auth.openmeld.test",
				currentUserSessionExpectation: "required",
				fetchImpl,
				requestHeaders: new Headers({
					cookie: "session=stale-cache",
				}),
				routeFamily: "/app/connect",
			})
		).resolves.toBeNull();

		expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
			"https://auth.openmeld.test/api/auth/get-session?disableCookieCache=true"
		);
	});

	it("can freshly verify an optional session before making a redirect decision", async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
			new Response("null", {
				status: 200,
				headers: {
					"content-type": "application/json",
				},
			})
		);

		await expect(
			fetchSessionFromGateway({
				betterAuthUrl: "https://auth.openmeld.test",
				currentUserSessionExpectation: "optional",
				fetchImpl,
				requestHeaders: new Headers({
					cookie: "session=stale-cache",
				}),
				routeFamily: "/login",
				sessionCacheMode: "bypass",
			})
		).resolves.toBeNull();

		expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
			"https://auth.openmeld.test/api/auth/get-session?disableCookieCache=true"
		);
	});
});
