import type { AnyRouter } from "@tanstack/react-router";
import { afterEach, expect, it, vi } from "vitest";
import {
	installPerformanceReporting,
	summarizePerformanceRequests,
} from "./performance-client";
import { beginSpaceOpen, markSpaceOpen } from "./space-open";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

it("reports slow and unfinished navigation with route templates, without reporting fast navigation", () => {
	vi.useFakeTimers();
	let now = 0;
	vi.spyOn(performance, "now").mockImplementation(() => now);
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
	const fetchMock = vi.fn().mockResolvedValue({ ok: false });
	vi.stubGlobal("fetch", fetchMock);
	const handlers = new Map<
		string,
		(event: { toLocation: { href: string; pathname: string } }) => void
	>();
	const router = {
		state: { matches: [{ routeId: "/o/$orgSlug/spaces/$spaceId" }] },
		matchRoutes: () => [{ routeId: "/o/$orgSlug/spaces/$spaceId" }],
		subscribe: (
			name: string,
			handler: (event: {
				toLocation: { href: string; pathname: string };
			}) => void
		) => {
			handlers.set(name, handler);
			return () => handlers.delete(name);
		},
	};
	const cleanup = installPerformanceReporting(router as unknown as AnyRouter);
	const event = {
		toLocation: {
			href: "/o/private-org/spaces/private-id",
			pathname: "/o/private-org/spaces/private-id",
		},
	};
	const emit = (name: string) => handlers.get(name)?.(event);
	emit("onBeforeNavigate");
	now = 100;
	emit("onResolved");
	expect(
		fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
	).toHaveLength(0);
	emit("onBeforeNavigate");
	now = 1800;
	emit("onLoad");
	now = 2000;
	emit("onResolved");
	let posts = fetchMock.mock.calls.filter(
		([, init]) => init?.method === "POST"
	);
	expect(posts).toHaveLength(1);
	expect(JSON.parse(posts[0]?.[1].body)).toMatchObject({
		kind: "navigation",
		durationMs: 1900,
		loadMs: 1700,
		routeId: "/o/$orgSlug/spaces/$spaceId",
		outcome: "resolved",
	});
	expect(posts[0]?.[1].body).not.toContain("private");
	emit("onBeforeNavigate");
	now = 8000;
	vi.advanceTimersByTime(5000);
	posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
	expect(JSON.parse(posts[1]?.[1].body).outcome).toBe("still_pending");
	// Slow router reports cannot consume the failure-report allowance.
	for (let i = 0; i < 25; i++) {
		emit("onBeforeNavigate");
		now += 2000;
		emit("onResolved");
	}
	beginSpaceOpen("/spaces/failure-example", "navigation");
	markSpaceOpen("failure-example", "failed");
	const spaceFailures = fetchMock.mock.calls
		.filter(([, init]) => init?.method === "POST")
		.map(([, init]) => JSON.parse(init.body))
		.filter(
			(report) => report.kind === "space_open" && report.outcome === "failed"
		);
	expect(spaceFailures).toHaveLength(1);
	cleanup();
	expect(handlers.size).toBe(0);
});

it("summarizes requests without preserving names or collecting its own telemetry", () => {
	const entries = [
		{
			name: "https://openmeld.ai/v1/spaces/private-id?token=secret",
			startTime: 100,
			duration: 500,
		},
		{
			name: "https://openmeld.ai/v1/observability/performance",
			startTime: 101,
			duration: 200,
		},
		{ name: "https://openmeld.ai/assets/old.js", startTime: 1, duration: 90 },
	] as PerformanceResourceTiming[];
	expect(summarizePerformanceRequests(entries, 50)).toEqual({
		requestCount: 1,
		longestRequestMs: 500,
		requestGroups: [{ group: "space", count: 1, maxMs: 500 }],
	});
});
