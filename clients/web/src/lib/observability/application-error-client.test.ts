import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PRIVATE_CONTENT = /token|private|https/;

describe("browser application error reporting", () => {
	let dispose: (() => void) | undefined;
	beforeEach(() => {
		vi.resetModules();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
		);
	});
	afterEach(() => {
		dispose?.();
		dispose = undefined;
		vi.unstubAllGlobals();
	});

	it("captures resource and route failures without suppressing the original error", async () => {
		const {
			installApplicationErrorReporting,
			reportClientApplicationError,
			setApplicationErrorRouteReader,
		} = await import("./application-error-client");
		setApplicationErrorRouteReader(() => "/spaces/$spaceId");
		dispose = installApplicationErrorReporting();
		const error = new TypeError(
			"Failed to fetch dynamically imported module: https://openmeld.ai/assets/space-ab12.js?token=private"
		);
		const event = Object.assign(
			new Event("vite:preloadError", { cancelable: true }),
			{ payload: error }
		);
		window.dispatchEvent(event);
		reportClientApplicationError(error, "route");
		expect(event.defaultPrevented).toBe(false);
		expect(fetch).toHaveBeenCalledOnce();
		const [url, options] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe("/v1/observability/application-errors");
		expect(options).toMatchObject({
			credentials: "omit",
			keepalive: true,
			method: "POST",
		});
		const body = JSON.parse(String(options?.body));
		expect(body).toMatchObject({
			source: "preload",
			routeId: "/spaces/$spaceId",
			error: { code: "module_load_failed", frames: ["assets/space-ab12.js"] },
		});
		expect(String(options?.body)).not.toMatch(PRIVATE_CONTENT);
	});

	it("captures global errors, stops after a bounded number, and never retries failed delivery", async () => {
		vi.mocked(fetch).mockRejectedValue(new TypeError("network unavailable"));
		const { installApplicationErrorReporting } = await import(
			"./application-error-client"
		);
		dispose = installApplicationErrorReporting();
		for (let i = 0; i < 30; i++) {
			window.dispatchEvent(
				new ErrorEvent("error", {
					error: new Error(`Failure in assets/page-${i}.js:1:2`),
				})
			);
		}
		await Promise.resolve();
		expect(fetch).toHaveBeenCalledTimes(20);
	});
});
