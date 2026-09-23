import { toStructuredApiClientFailure } from "@openmeld/api-client";
import {
	SPACE_TASK_RESULT_REVISION_CONFLICT_ERROR_CODE,
	SPACE_TASK_REVISION_CONFLICT_ERROR_CODE,
	spaceTaskMutationReceiptSchema,
} from "@openmeld/schemas";
import type {
	MutateSpaceTaskBody,
	SpaceTaskMutationReceipt,
} from "@openmeld/schemas/types";

export function isSpaceTaskRevisionConflictError(error: unknown): boolean {
	const failure = toStructuredApiClientFailure(error);
	return (
		failure.code === SPACE_TASK_REVISION_CONFLICT_ERROR_CODE ||
		failure.upstreamCode === SPACE_TASK_REVISION_CONFLICT_ERROR_CODE ||
		failure.code === SPACE_TASK_RESULT_REVISION_CONFLICT_ERROR_CODE ||
		failure.upstreamCode === SPACE_TASK_RESULT_REVISION_CONFLICT_ERROR_CODE
	);
}

export async function mutateSpaceTaskWithConflictRefresh(input: {
	mutate: (body: MutateSpaceTaskBody) => Promise<unknown>;
	refresh: () => Promise<unknown>;
	request: MutateSpaceTaskBody;
}): Promise<SpaceTaskMutationReceipt> {
	try {
		return spaceTaskMutationReceiptSchema.parse(
			await input.mutate(input.request)
		);
	} catch (error) {
		if (!isSpaceTaskRevisionConflictError(error)) {
			throw error;
		}
		await input.refresh();
		throw new Error(
			"This Task changed. Review the refreshed details before trying again.",
			{ cause: error }
		);
	}
}
