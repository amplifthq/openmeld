import { afterEach, beforeEach, expect, it, vi } from "vitest";

const report = {
	version: 1,
	id: "6b004ec7-12d8-4a27-a51f-f506c7ba30fa",
	pageSessionId: "6b004ec7-12d8-4a27-a51f-f506c7ba30fb",
	buildId: null,
	sourceSha: null,
	policyVersion: 1,
	kind: "navigation",
	routeId: "/o/$orgSlug/spaces/$spaceId",
	durationMs: 1800,
	thresholdMs: 1500,
	outcome: "resolved",
	loadMs: 1700,
	longTaskCount: 1,
	longTaskTotalMs: 70,
	longestTaskMs: 70,
	requestCount: 2,
	longestRequestMs: 1600,
	requestGroups: [{ group: "space", count: 2, maxMs: 1600 }],
};
function request(body: unknown, origin = "https://openmeld.ai") {
	return new Request("https://openmeld.ai/v1/observability/performance", {
		method: "POST",
		headers: { origin, "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}
beforeEach(() => {
	vi.resetModules();
	vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());
it("logs slow experiences but rejects unbounded or private payloads", async () => {
	const { receivePerformanceReport } = await import("./performance-server");
	expect((await receivePerformanceReport(request(report))).status).toBe(204);
	expect(console.warn).toHaveBeenCalledWith(
		expect.objectContaining({ event: "web.openmeld.slow_experience", report })
	);
	vi.mocked(console.warn).mockClear();
	expect(
		(await receivePerformanceReport(request({ ...report, durationMs: 100 })))
			.status
	).toBe(204);
	expect(
		(await receivePerformanceReport(request({ ...report, message: "private" })))
			.status
	).toBe(400);
	expect(
		(await receivePerformanceReport(request(report, "https://other.example")))
			.status
	).toBe(403);
	expect(
		(await receivePerformanceReport(request("x".repeat(5000)))).status
	).toBe(413);
	expect(console.warn).not.toHaveBeenCalled();
});

it("accepts the browser's fast Space sample and nullable uncollected metrics while preserving payload privacy", async () => {
	const { receivePerformanceReport } = await import("./performance-server");
	const { installSpaceOpenReporting, beginSpaceOpen, markSpaceOpen } =
		await import("./space-open");
	vi.spyOn(Math, "random").mockReturnValue(0);
	const captured = vi.fn();
	const cleanup = installSpaceOpenReporting(captured);
	try {
		beginSpaceOpen("/spaces/private-space", "navigation");
		markSpaceOpen("private-space", "access");
		markSpaceOpen("private-space", "empty");
		markSpaceOpen("private-space", "read_only");
		const sample = {
			...report,
			...captured.mock.calls.at(-1)?.[0],
			kind: "space_open",
			requestCount: null,
			longestRequestMs: null,
			requestGroups: [],
		};
		expect((await receivePerformanceReport(request(sample))).status).toBe(204);
		expect(console.warn).toHaveBeenLastCalledWith(
			expect.objectContaining({
				event: "web.openmeld.space_open",
				report: expect.objectContaining({
					spaceOpen: expect.objectContaining({
						sampling: "normal",
						content: "empty",
						composer: "read_only",
					}),
				}),
			})
		);
		expect(
			(
				await receivePerformanceReport(
					request({
						...sample,
						spaceOpen: { ...sample.spaceOpen, url: "https://private.example" },
					})
				)
			).status
		).toBe(400);
		expect(
			(
				await receivePerformanceReport(
					request({ ...sample, spaceOpen: undefined })
				)
			).status
		).toBe(400);
	} finally {
		cleanup();
	}
});
