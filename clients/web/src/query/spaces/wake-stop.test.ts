import type { PostSpaceWakeStopResponse } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import {
	invalidateSpaceWakeStopQueries,
	postWebSpaceWakeStop,
} from "./wake-stop";

vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: vi.fn(),
}));

const createWebSpaceApiMock = vi.mocked(createUnscopedWebSpaceApi);

describe("postWebSpaceWakeStop", () => {
	it("posts only the shared Wake Stop selector body through the Space API", async () => {
		const response = createWakeStopResponse();
		const postWakeStop = vi.fn().mockResolvedValue(response);
		createWebSpaceApiMock.mockReturnValue({
			postWakeStop,
		} as unknown as ReturnType<typeof createUnscopedWebSpaceApi>);

		const body = {
			reason: "User requested Stop from Web.",
			target: {
				by: "source_signal" as const,
				sourceSignalId: "sig-source",
				targetProfileId: "agt-runner",
			},
		};

		await expect(
			postWebSpaceWakeStop({
				openMeldProfileId: "human-profile-1",
				body,
				spaceId: "space-123",
			})
		).resolves.toBe(response);

		expect(createWebSpaceApiMock).toHaveBeenCalledWith({
			openMeldProfileId: "human-profile-1",
		});
		expect(postWakeStop).toHaveBeenCalledWith({
			body,
			spaceId: "space-123",
			timeoutMs: 15_000,
		});
		expect(JSON.stringify(postWakeStop.mock.calls[0]?.[0])).not.toContain(
			"dispatchId"
		);
		expect(JSON.stringify(postWakeStop.mock.calls[0]?.[0])).not.toContain(
			"taskId"
		);
	});
});

describe("invalidateSpaceWakeStopQueries", () => {
	it("refreshes Space history, status, thread, and selected message details", async () => {
		const invalidateQueries = vi.fn().mockResolvedValue(undefined);

		await invalidateSpaceWakeStopQueries({
			openMeldProfileId: "human-profile-1",
			queryClient: { invalidateQueries },
			sourceSignalId: "sig-source",
			spaceId: "space-123",
			threadId: "thread-1",
		});

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["spaces", "history", "space-123", "human-profile-1"],
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["spaces", "status", "space-123", "human-profile-1"],
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["spaces", "threads", "space-123", "human-profile-1"],
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: [
				"spaces",
				"message-details",
				"space-123",
				"sig-source",
				"human-profile-1",
			],
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: [
				"spaces",
				"thread-signals",
				"space-123",
				"thread-1",
				"human-profile-1",
			],
		});
	});
});

function createWakeStopResponse(): PostSpaceWakeStopResponse {
	return {
		cancellationState: {
			observedAtMs: 1,
			reasonCode: null,
			status: "requested",
		},
		ok: true,
		runtimeCoordinatorExecutionId: "rce_123",
		status: "cancellation_requested",
		targetProfileId: "agt-runner",
	};
}
