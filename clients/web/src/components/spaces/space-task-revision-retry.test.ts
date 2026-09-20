import { OpenMeldApiClientHttpError } from "@openmeld/api-client";
import {
	SPACE_TASK_REVISION_CONFLICT_ERROR_CODE,
	spaceTaskMutationReceiptSchema,
	spaceTaskSchema,
} from "@openmeld/schemas";
import type { MutateSpaceTaskBody } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
	isSpaceTaskRevisionConflictError,
	mutateSpaceTaskRefreshingOnRevisionConflict,
} from "./space-task-revision-retry";

const TASK_ID = "tsk_55555555-5555-4555-8555-555555555555";
const ACTOR = {
	ownerUserId: "user-avery",
	profileId: "11111111-1111-4111-8111-111111111111",
	profileKind: "human" as const,
	profileName: "Avery",
};

const request: MutateSpaceTaskBody = {
	action: "cancel",
	expectedRevision: 1,
	operationId: "op-1",
	reason: "The request is no longer needed.",
};

const receipt = (revision: number) =>
	spaceTaskMutationReceiptSchema.parse({
		applied: true,
		event: {
			actor: ACTOR,
			createdAt: "2026-09-15T01:00:00.000Z",
			detail: "The request is no longer needed.",
			eventId: "tse_55555555-5555-4555-8555-555555555555",
			fromPhase: "to_do",
			operationId: revision === 2 ? "op-1" : "op-2",
			taskId: TASK_ID,
			taskRevision: revision,
			toPhase: "canceled",
			type: "canceled",
		},
		task: spaceTaskSchema.parse({
			assignee: null,
			automaticReworkRounds: 0,
			completionConditions: [],
			createdAt: "2026-09-15T00:00:00.000Z",
			createdBy: ACTOR,
			description: null,
			needsHumanDecision: false,
			phase: "canceled",
			requestedBy: ACTOR,
			result: null,
			review: null,
			reviewer: null,
			revision,
			sourceSignalId: null,
			spaceId: "space-1",
			taskId: TASK_ID,
			threadId: null,
			title: "Ship Tasks",
			updatedAt: "2026-09-15T01:00:00.000Z",
		}),
	});

describe("Space Task mutation revision retry", () => {
	it("refreshes expectedRevision once after a typed revision conflict", async () => {
		const mutate = vi
			.fn()
			.mockRejectedValueOnce(
				new OpenMeldApiClientHttpError({
					code: SPACE_TASK_REVISION_CONFLICT_ERROR_CODE,
					message:
						"This Task changed from revision 1 to 2. Refresh it and try again.",
					rawBody: "",
					status: 409,
				})
			)
			.mockResolvedValueOnce(receipt(3));
		const readCurrentRevision = vi.fn(async () => 2);

		await expect(
			mutateSpaceTaskRefreshingOnRevisionConflict({
				mutate,
				readCurrentRevision,
				request,
			})
		).resolves.toMatchObject({ task: { revision: 3 } });

		expect(readCurrentRevision).toHaveBeenCalledOnce();
		expect(mutate).toHaveBeenNthCalledWith(1, request);
		expect(mutate).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				action: "cancel",
				expectedRevision: 2,
				reason: "The request is no longer needed.",
			})
		);
		expect(mutate.mock.calls[1]?.[0].operationId).not.toBe("op-1");
	});

	it("retries when an older Gateway wraps the conflict as upstream_error", async () => {
		const mutate = vi
			.fn()
			.mockRejectedValueOnce(
				new OpenMeldApiClientHttpError({
					code: "upstream_error",
					message:
						"This Task changed from revision 1 to 2. Refresh it and try again.",
					rawBody: "",
					status: 409,
					upstreamCode: SPACE_TASK_REVISION_CONFLICT_ERROR_CODE,
				})
			)
			.mockResolvedValueOnce(receipt(3));

		await expect(
			mutateSpaceTaskRefreshingOnRevisionConflict({
				mutate,
				readCurrentRevision: async () => 2,
				request,
			})
		).resolves.toMatchObject({ task: { revision: 3 } });
		expect(mutate).toHaveBeenCalledTimes(2);
	});

	it("does not retry a different Task failure", async () => {
		const error = new OpenMeldApiClientHttpError({
			code: "space.forbidden",
			message: "You cannot change this Task.",
			rawBody: "",
			status: 403,
		});
		const mutate = vi.fn(() => {
			throw error;
		});

		await expect(
			mutateSpaceTaskRefreshingOnRevisionConflict({
				mutate,
				readCurrentRevision: async () => 2,
				request,
			})
		).rejects.toBe(error);
		expect(mutate).toHaveBeenCalledOnce();
	});

	it("recognizes both Gateway passthrough and mixed-version wrapping", () => {
		expect(
			isSpaceTaskRevisionConflictError(
				new OpenMeldApiClientHttpError({
					code: SPACE_TASK_REVISION_CONFLICT_ERROR_CODE,
					message: "Refresh it and try again.",
					rawBody: "",
					status: 409,
				})
			)
		).toBe(true);
		expect(
			isSpaceTaskRevisionConflictError(
				new OpenMeldApiClientHttpError({
					code: "upstream_error",
					message: "Refresh it and try again.",
					rawBody: "",
					status: 409,
					upstreamCode: SPACE_TASK_REVISION_CONFLICT_ERROR_CODE,
				})
			)
		).toBe(true);
	});
});
