import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { readCurrentDeviceTarget } from "./current-device-target.server";

const SERVER_RESOLVER_SOURCE = fs.readFileSync(
	path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"./current-device-target.ts"
	),
	"utf8"
);

describe("current device target resolver", () => {
	it("returns the resolved current device target", async () => {
		const proxyRequestMock = vi.fn((input: { request: Request }) => {
			expect(input.request.url).toBe(
				"https://openmeld.test/v1/devices/current"
			);
			expect(input.request.headers.get("accept")).toBe("application/json");
			expect(input.request.headers.get("cookie")).toBe("session=abc");

			return Promise.resolve(
				new Response(
					JSON.stringify({
						availability: "resolved",
						deviceId: "device-123",
						runtimeLane: "dev-local",
					}),
					{
						status: 200,
						headers: {
							"content-type": "application/json",
						},
					}
				)
			);
		});

		await expect(
			readCurrentDeviceTarget({
				requestHeaders: new Headers({
					cookie: "session=abc",
				}),
				webAppUrl: "https://openmeld.test",
				gatewayUrl: "https://gateway.openmeld.test",
				proxyRequestImpl: proxyRequestMock,
			})
		).resolves.toEqual({
			availability: "resolved",
			deviceId: "device-123",
			runtimeLane: "dev-local",
		});
		expect(proxyRequestMock).toHaveBeenCalledTimes(1);
	});

	it("returns missing without inventing a fallback device target", async () => {
		const proxyRequestMock = vi.fn(() => {
			return Promise.resolve(
				new Response(JSON.stringify({ availability: "missing" }), {
					status: 200,
					headers: {
						"content-type": "application/json",
					},
				})
			);
		});

		await expect(
			readCurrentDeviceTarget({
				requestHeaders: new Headers(),
				webAppUrl: "https://openmeld.test",
				gatewayUrl: "https://gateway.openmeld.test",
				proxyRequestImpl: proxyRequestMock,
			})
		).resolves.toEqual({
			availability: "missing",
		});
	});

	it("throws when the upstream request fails", async () => {
		const proxyRequestMock = vi.fn(() => {
			return Promise.resolve(
				new Response("upstream down", {
					status: 503,
				})
			);
		});

		await expect(
			readCurrentDeviceTarget({
				requestHeaders: new Headers(),
				webAppUrl: "https://openmeld.test",
				gatewayUrl: "https://gateway.openmeld.test",
				proxyRequestImpl: proxyRequestMock,
			})
		).rejects.toThrow("Failed to resolve current device target: 503");
	});

	it("keeps the server-side resolver on WEB_APP_URL instead of OPENMELD_GATEWAY_URL", () => {
		expect(SERVER_RESOLVER_SOURCE).toContain(
			'getRequiredServerEnv("WEB_APP_URL")'
		);
		expect(SERVER_RESOLVER_SOURCE).not.toContain(
			'getRequiredServerEnv("OPENMELD_GATEWAY_URL")'
		);
	});
});
