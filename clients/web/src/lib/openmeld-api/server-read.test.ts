import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { readJsonFromWebOpenMeldBoundary } from "./server-read";

describe("web OpenMeld boundary server read diagnostics", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it.each([
		"192.0.2.1",
		"2001:db8::1",
		undefined,
	])("preserves only the edge IP through the real SSR proxy (%s)", async (clientIp) => {
		const fetchImpl = vi.fn<typeof fetch>(async () =>
			Response.json({ ok: true })
		);
		const result = await readJsonFromWebOpenMeldBoundary({
			path: `/v1/spaces/${"a".repeat(64)}/board`,
			requestHeaders: new Headers({
				cookie: "session=fixture",
				"x-real-ip": "203.0.113.1",
				"x-forwarded-for": "203.0.113.2",
				...(clientIp ? { "cf-connecting-ip": clientIp } : {}),
			}),
			webAppUrl: "https://app.openmeld.test",
			gatewayUrl: "https://gateway.openmeld.test",
			operation: "read board",
			invalidMessage: "Invalid board",
			schema: z.object({ ok: z.boolean() }),
			fetchImpl,
		});
		expect(result).toEqual({ ok: true });
		expect(fetchImpl).toHaveBeenCalledOnce();
		const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
		expect(headers.get("x-real-ip")).toBe(clientIp ?? null);
		expect(headers.get("cf-connecting-ip")).toBeNull();
		expect(headers.get("x-forwarded-for")).toBeNull();
		expect(headers.get("cookie")).toBe("session=fixture");
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

	it("carries only the session cookie and edge client address into the Gateway read", async () => {
		const proxyRequestImpl = vi.fn(async (_input: { request: Request }) =>
			Response.json({ availability: "resolved", deviceId: "device-1" })
		);

		await expect(
			readJsonFromWebOpenMeldBoundary({
				gatewayUrl: "https://gateway.openmeld.test",
				invalidMessage: "Invalid current device target response",
				operation: "resolve current device target",
				path: "/v1/devices/current",
				proxyRequestImpl,
				requestHeaders: new Headers({
					authorization: "Bearer forged",
					"cf-connecting-ip": "203.0.113.7",
					cookie: "session=abc",
				}),
				schema: z.strictObject({
					availability: z.literal("resolved"),
					deviceId: z.string(),
				}),
				webAppUrl: "https://openmeld.test",
			})
		).resolves.toEqual({ availability: "resolved", deviceId: "device-1" });

		const request = proxyRequestImpl.mock.calls[0]?.[0].request;
		expect(request?.headers.get("cookie")).toBe("session=abc");
		expect(request?.headers.get("cf-connecting-ip")).toBe("203.0.113.7");
		expect(request?.headers.get("authorization")).toBeNull();
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
