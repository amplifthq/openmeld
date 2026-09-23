import { OpenMeldApiClientHttpError } from "@openmeld/api-client";
import {
	SPACE_TASK_RESULT_REVISION_CONFLICT_ERROR_CODE,
	SPACE_TASK_REVISION_CONFLICT_ERROR_CODE,
} from "@openmeld/schemas";
import type { MutateSpaceTaskBody } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { mutateSpaceTaskWithConflictRefresh } from "./space-task-mutation";

const request: MutateSpaceTaskBody = {
	action: "review",
	decision: "accepted",
	expectedRevision: 4,
	expectedResultRevision: 1,
	operationId: "accept-result-1",
	feedback: null,
};

describe("Space Task mutation conflicts", () => {
	it.each([
		{ code: SPACE_TASK_REVISION_CONFLICT_ERROR_CODE },
		{
			code: "upstream_error" as const,
			upstreamCode: SPACE_TASK_REVISION_CONFLICT_ERROR_CODE,
		},
		{ code: SPACE_TASK_RESULT_REVISION_CONFLICT_ERROR_CODE },
	])("refreshes $code without approving a result the person did not review", async (failure) => {
		const mutate = vi.fn().mockRejectedValue(
			new OpenMeldApiClientHttpError({
				...failure,
				message: "The Task changed",
				rawBody: "",
				status: 409,
			})
		);
		const refresh = vi.fn(async () => undefined);
		await expect(
			mutateSpaceTaskWithConflictRefresh({ mutate, refresh, request })
		).rejects.toThrow("Review the refreshed details");
		expect(refresh).toHaveBeenCalledOnce();
		expect(mutate).toHaveBeenCalledExactlyOnceWith(request);
	});

	it("preserves a non-conflict failure without retrying or refreshing", async () => {
		const error = new OpenMeldApiClientHttpError({
			code: "space.forbidden",
			message: "You cannot change this Task.",
			rawBody: "",
			status: 403,
		});
		const mutate = vi.fn().mockRejectedValue(error);
		const refresh = vi.fn();
		await expect(
			mutateSpaceTaskWithConflictRefresh({ mutate, refresh, request })
		).rejects.toBe(error);
		expect(mutate).toHaveBeenCalledOnce();
		expect(refresh).not.toHaveBeenCalled();
	});
});
