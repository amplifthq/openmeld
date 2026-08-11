import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { readJsonFromWebOpenMeldBoundary } from "./server-read";

describe("web OpenMeld boundary server read diagnostics", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("classifies runtime fetch throws before an upstream response exists", async () => {
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		await expect(
			readJsonFromWebOpenMeldBoundary({
				currentUserSessionExpectation: "required",
				gatewayUrl: "https://gateway.openmeld.test",
				invalidMessage: "Invalid current device target response",
				operation: "resolve current device target",
				path: "/v1/devices/current",
				proxyRequestImpl: vi
					.fn()
					.mockRejectedValue(new TypeError("fetch failed")),
				requestHeaders: new Headers({
					cookie: "session=abc",
				}),
				routeFamily: "/app/connect",
				schema: z.strictObject({
					availability: z.literal("resolved"),
					deviceId: z.string(),
				}),
				webAppUrl: "https://openmeld.test",
			})
		).rejects.toThrow(
			"OpenMeld couldn't resolve current device target before receiving an HTTP response."
		);

		expect(
			JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
		).toMatchObject({
			currentUserSessionExpectation: "required",
			event: "web.dev_ssr_fetch",
			hasCookie: true,
			kind: "openmeld_boundary_runtime_fetch_failed",
			operation: "resolve current device target",
			routeFamily: "/app/connect",
			targetOrigin: "https://openmeld.test",
			targetPath: "/v1/devices/current",
		});
	});

	it("classifies non-2xx boundary responses as upstream HTTP failures", async () => {
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		await expect(
			readJsonFromWebOpenMeldBoundary({
				gatewayUrl: "https://gateway.openmeld.test",
				invalidMessage: "Invalid current device target response",
				operation: "resolve current device target",
				path: "/v1/devices/current",
				proxyRequestImpl: vi.fn().mockResolvedValue(
					new Response("missing", {
						status: 503,
					})
				),
				requestHeaders: new Headers(),
				routeFamily: "/app/connect",
				schema: z.strictObject({
					availability: z.literal("resolved"),
					deviceId: z.string(),
				}),
				webAppUrl: "https://openmeld.test",
			})
		).rejects.toThrow("Failed to resolve current device target: 503");

		expect(
			JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
		).toMatchObject({
			kind: "upstream_http_failure",
			routeFamily: "/app/connect",
			status: 503,
		});
	});

	it("classifies schema-invalid payloads as invalid responses", async () => {
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		await expect(
			readJsonFromWebOpenMeldBoundary({
				gatewayUrl: "https://gateway.openmeld.test",
				invalidMessage: "Invalid current device target response",
				operation: "resolve current device target",
				path: "/v1/devices/current",
				proxyRequestImpl: vi.fn().mockResolvedValue(
					new Response(JSON.stringify({ availability: "wrong-shape" }), {
						status: 200,
						headers: {
							"content-type": "application/json",
						},
					})
				),
				requestHeaders: new Headers(),
				routeFamily: "/app/connect",
				schema: z.strictObject({
					availability: z.literal("resolved"),
					deviceId: z.string(),
				}),
				webAppUrl: "https://openmeld.test",
			})
		).rejects.toThrow("Invalid current device target response:");

		expect(
			JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
		).toMatchObject({
			kind: "invalid_response_failure",
			routeFamily: "/app/connect",
			status: 200,
		});
	});
});
