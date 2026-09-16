import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { createUnscopedWebOpenMeldApiFoundation } from "../openmeld-api/client";
import {
	beginSpaceOpen,
	browserDiagnosticContext,
	installSpaceOpenReporting,
	markSpaceOpen,
	observeSpaceOpen,
} from "./space-open";

let cleanup: (() => void) | undefined;
beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(Math, "random").mockReturnValue(0);
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
	cleanup?.();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

it.each([
	"messages",
	"empty",
] as const)("waits for access and rendered %s plus the composer, retaining the pending attempt ID", (content) => {
	const report = vi.fn();
	cleanup = installSpaceOpenReporting(report);
	beginSpaceOpen("/o/private-org/spaces/private-space", "navigation");
	const id = browserDiagnosticContext().spaceOpenAttemptId;
	observeSpaceOpen("private-space", {
		queryStatus: "pending",
		fetchStatus: "paused",
		failureCount: 1,
		cache: "restored",
	});
	markSpaceOpen("private-space", content);
	markSpaceOpen("private-space", "editable");
	expect(report).not.toHaveBeenCalled();
	vi.advanceTimersByTime(5000);
	expect(report).toHaveBeenLastCalledWith(
		expect.objectContaining({
			outcome: "still_pending",
			spaceOpen: expect.objectContaining({
				attemptId: id,
				stage: "access",
				queryStatus: "pending",
				fetchStatus: "paused",
				cache: "restored",
			}),
		})
	);
	markSpaceOpen("private-space", "access");
	expect(report).toHaveBeenLastCalledWith(
		expect.objectContaining({
			outcome: "resolved",
			spaceOpen: expect.objectContaining({
				attemptId: id,
				stage: "ready",
				content,
				composer: "editable",
				sampling: "normal",
			}),
		})
	);
	const count = report.mock.calls.length;
	vi.advanceTimersByTime(5000);
	markSpaceOpen("private-space", "access");
	expect(report).toHaveBeenCalledTimes(count);
	expect(JSON.stringify(report.mock.calls)).not.toContain("private");
});

it.each([
	"failed",
	"denied",
	"superseded",
] as const)("preserves %s instead of reporting a ready Space", (outcome) => {
	const report = vi.fn();
	cleanup = installSpaceOpenReporting(report);
	beginSpaceOpen("/spaces/example", "navigation");
	if (outcome === "superseded") {
		beginSpaceOpen("/inbox", "navigation");
	} else {
		markSpaceOpen("example", outcome);
	}
	markSpaceOpen("example", "access");
	markSpaceOpen("example", "empty");
	markSpaceOpen("example", "read_only");
	expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ outcome }));
});

it("observes a pending response body and its request ID without consuming or replacing the response", async () => {
	const report = vi.fn();
	cleanup = installSpaceOpenReporting(report);
	beginSpaceOpen("/spaces/example", "navigation");
	let body: ReadableStreamDefaultController<Uint8Array> | undefined;
	const response = new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				body = controller;
			},
		}),
		{
			headers: {
				"x-openmeld-request-id": "request-123",
				"content-type": "application/json",
			},
		}
	);
	// A test-owned HTTP JSON contract exercises the real transport/body/validation boundary.
	const foundation = createUnscopedWebOpenMeldApiFoundation({
		fetchImpl: async () => response,
	});
	const result = foundation.requestJson({
		url: "/v1/spaces/example/status",
		operation: "test JSON",
		schema: z.object({ ok: z.boolean() }),
		invalidMessage: "Invalid test response",
	});
	await vi.advanceTimersByTimeAsync(5000);
	expect(report).toHaveBeenLastCalledWith(
		expect.objectContaining({
			spaceOpen: expect.objectContaining({
				requests: [
					expect.objectContaining({
						phase: "headers",
						requestId: "request-123",
						status: 200,
					}),
				],
			}),
		})
	);
	body?.enqueue(new TextEncoder().encode('{"ok":true}'));
	body?.close();
	await expect(result).resolves.toEqual({ ok: true });
	markSpaceOpen("example", "access");
	markSpaceOpen("example", "empty");
	markSpaceOpen("example", "read_only");
	expect(report).toHaveBeenLastCalledWith(
		expect.objectContaining({
			spaceOpen: expect.objectContaining({
				requests: [
					expect.objectContaining({
						phase: "complete",
						requestId: "request-123",
					}),
				],
			}),
		})
	);
});
