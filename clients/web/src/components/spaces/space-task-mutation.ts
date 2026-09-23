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

type SpaceTaskConflictCode =
	| typeof SPACE_TASK_REVISION_CONFLICT_ERROR_CODE
	| typeof SPACE_TASK_RESULT_REVISION_CONFLICT_ERROR_CODE;

function readSpaceTaskConflictCode(
	error: unknown
): SpaceTaskConflictCode | null {
	const failure = toStructuredApiClientFailure(error);
	for (const code of [failure.code, failure.upstreamCode]) {
		if (
			code === SPACE_TASK_REVISION_CONFLICT_ERROR_CODE ||
			code === SPACE_TASK_RESULT_REVISION_CONFLICT_ERROR_CODE
		) {
			return code;
		}
	}
	return null;
}

export function isSpaceTaskRevisionConflictError(error: unknown): boolean {
	return readSpaceTaskConflictCode(error) !== null;
}

export class SpaceTaskRefreshConflictError extends Error {
	readonly code: SpaceTaskConflictCode;
	constructor(code: SpaceTaskConflictCode, cause: unknown) {
		super(
			"This Task changed. Review the refreshed details before trying again.",
			{
				cause,
			}
		);
		this.code = code;
	}
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
		const conflictCode = readSpaceTaskConflictCode(error);
		if (!conflictCode) {
			throw error;
		}
		await input.refresh();
		throw new SpaceTaskRefreshConflictError(conflictCode, error);
	}
}
