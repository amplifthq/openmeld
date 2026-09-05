import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const report = {
	version: 1,
	id: "6b004ec7-12d8-4a27-a51f-f506c7ba30fa",
	source: "route",
	buildId: null,
	sourceSha: null,
	routeId: "/o/$orgSlug/spaces/$spaceId",
	error: {
		name: "TypeError",
		code: "undefined_property",
		frames: ["assets/page-a1b2.js:12:34"],
	},
};
function request(body: unknown = report, headers: Record<string, string> = {}) {
	return new Request(
		"https://openmeld.ai/v1/observability/application-errors",
		{
			method: "POST",
			headers: {
				origin: "https://openmeld.ai",
				"content-type": "application/json",
				...headers,
			},
			body: JSON.stringify(body),
		}
	);
}

describe("application error intake", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
	});
	afterEach(() => vi.restoreAllMocks());

	it("records only the parsed contract and trusted server envelope", async () => {
		const { receiveApplicationError } = await import(
			"./application-error-server"
		);
		const result = await receiveApplicationError(
			request({
				...report,
				cookie: "private",
				event: "fake",
				error: { ...report.error, message: "private customer message" },
			})
		);
		expect(result.status).toBe(204);
		expect(result.headers.get("cache-control")).toBe("no-store");
		expect(console.error).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "web.openmeld.application_error",
				report,
			})
		);
		expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
			"private"
		);
	});

	it("rejects cross-origin, malformed, oversized and forged server reports without logging", async () => {
		const { receiveApplicationError } = await import(
			"./application-error-server"
		);
		expect(
			(
				await receiveApplicationError(
					request(report, { origin: "https://elsewhere.example" })
				)
			).status
		).toBe(403);
		expect(
			(
				await receiveApplicationError(
					request({}, { "content-type": "text/plain" })
				)
			).status
		).toBe(415);
		expect(
			(
				await receiveApplicationError(
					request({ ...report, source: "server_request" })
				)
			).status
		).toBe(400);
		expect(
			(
				await receiveApplicationError(
					request({
						...report,
						error: {
							...report.error,
							frames: ["https://openmeld.ai/?token=private"],
						},
					})
				)
			).status
		).toBe(400);
		// No content-length header: the streaming limit must still enforce the cap.
		expect(
			(await receiveApplicationError(request({ text: "x".repeat(9000) })))
				.status
		).toBe(413);
		expect(console.error).not.toHaveBeenCalled();
	});

	it("bounds log volume without allocating per-client state", async () => {
		const { receiveApplicationError } = await import(
			"./application-error-server"
		);
		for (let i = 0; i < 120; i++) {
			expect((await receiveApplicationError(request())).status).toBe(204);
		}
		expect((await receiveApplicationError(request())).status).toBe(429);
		expect(console.error).toHaveBeenCalledTimes(120);
	});
});
