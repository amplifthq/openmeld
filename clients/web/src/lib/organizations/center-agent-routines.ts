import {
	createRoutinesApi,
	type ListRoutineRunsInput,
	type RoutineMutationInput,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
	type UpdateRoutineInput,
} from "@openmeld/api-client";
import type {
	CreateCenterAgentRoutineBody,
	CreateCenterAgentRoutineResponse,
	DeleteCenterAgentRoutineResponse,
	ListCenterAgentRoutineRunsResponse,
	ListCenterAgentRoutinesManagementResponse,
	ListCenterAgentRoutineTargetSpacesResponse,
	PauseCenterAgentRoutineResponse,
	ResumeCenterAgentRoutineResponse,
	UpdateCenterAgentRoutineResponse,
} from "@openmeld/schemas/types";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type CenterAgentRoutinesFailure = StructuredApiClientFailure;

function createWebRoutinesApi(organizationId: string) {
	return createRoutinesApi(createWebOpenMeldApiFoundation({ organizationId }));
}

export async function listCurrentCenterAgentRoutines(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<ListCenterAgentRoutinesManagementResponse> {
	try {
		const response = await createWebRoutinesApi(
			input.organizationId
		).listRoutineManagement({
			signal: input.signal,
		});
		assertRoutineListIdentity(response, input.organizationId);
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function listCurrentCenterAgentRoutineTargetSpaces(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<ListCenterAgentRoutineTargetSpacesResponse> {
	try {
		const response = await createWebRoutinesApi(
			input.organizationId
		).listRoutineTargetSpaces({
			signal: input.signal,
		});
		assertRoutineTargetSpaceListIdentity(response, input.organizationId);
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function createCurrentCenterAgentRoutine(
	input: CreateCenterAgentRoutineBody & { organizationId: string }
): Promise<CreateCenterAgentRoutineResponse> {
	try {
		const { organizationId, ...request } = input;
		return await createWebRoutinesApi(organizationId).createRoutine(request);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function updateCurrentCenterAgentRoutine(
	input: UpdateRoutineInput & { organizationId: string }
): Promise<UpdateCenterAgentRoutineResponse> {
	try {
		const { organizationId, ...request } = input;
		return await createWebRoutinesApi(organizationId).updateRoutine(request);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function pauseCurrentCenterAgentRoutine(
	input: RoutineMutationInput & { organizationId: string }
): Promise<PauseCenterAgentRoutineResponse> {
	try {
		const { organizationId, ...request } = input;
		return await createWebRoutinesApi(organizationId).pauseRoutine(request);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function resumeCurrentCenterAgentRoutine(
	input: RoutineMutationInput & { organizationId: string }
): Promise<ResumeCenterAgentRoutineResponse> {
	try {
		const { organizationId, ...request } = input;
		return await createWebRoutinesApi(organizationId).resumeRoutine(request);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function deleteCurrentCenterAgentRoutine(
	input: RoutineMutationInput & { organizationId: string }
): Promise<DeleteCenterAgentRoutineResponse> {
	try {
		const { organizationId, ...request } = input;
		return await createWebRoutinesApi(organizationId).deleteRoutine(request);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function listCurrentCenterAgentRoutineRuns(
	input: ListRoutineRunsInput & { organizationId: string }
): Promise<ListCenterAgentRoutineRunsResponse> {
	try {
		const response = await createWebRoutinesApi(
			input.organizationId
		).listRoutineRuns({
			...(input.beforeScheduledFor === undefined
				? {}
				: { beforeScheduledFor: input.beforeScheduledFor }),
			...(input.limit === undefined ? {} : { limit: input.limit }),
			routineId: input.routineId,
			signal: input.signal,
		});
		assertRoutineRunsIdentity(response, {
			organizationId: input.organizationId,
			routineId: input.routineId,
		});
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function resolveCenterAgentRoutineErrorMessage(
	error: unknown,
	action:
		| "create"
		| "delete"
		| "list"
		| "pause"
		| "resume"
		| "runs"
		| "target_spaces"
		| "update"
): string {
	const failure = toStructuredApiClientFailure(error);
	const code = failure.upstreamCode ?? failure.code;
	let message: string;

	switch (code) {
		case "routine.total_limit_reached":
			message =
				"This organization already has 50 routines. Delete one before creating another.";
			break;
		case "routine.forbidden":
			message =
				"You can view this routine, but only its creator or an organization owner or admin can manage it.";
			break;
		case "routine.not_found":
			message =
				"This routine no longer exists. Refresh the list to see the latest routines.";
			break;
		case "routine.target_space_not_found":
		case "routine.target_space_org_mismatch":
			message = "Choose a Space from the current organization.";
			break;
		case "routine.target_space_publication_unavailable":
			message =
				"The Center Agent cannot publish to that Space. Choose another Space or update its access first.";
			break;
		case "routine.schedule.invalid_cron":
			message = "Enter a valid five-field cron schedule.";
			break;
		case "routine.schedule.invalid_timezone":
			message = "Choose a valid IANA timezone, such as America/Los_Angeles.";
			break;
		case "routine.schedule.too_frequent":
			message = "Routine schedules must be at least five minutes apart.";
			break;
		case "routine.status_conflict":
			message =
				"This routine changed before your update finished. Refresh it and try again.";
			break;
		default:
			message = resolveFallbackMessage(failure, action);
	}

	const diagnostics = [
		code ? `Error code: ${code}.` : null,
		failure.requestId ? `Request ID: ${failure.requestId}.` : null,
		failure.schemaIssueMessage
			? `Context: ${failure.schemaIssueMessage}`
			: null,
	].filter(Boolean);
	return diagnostics.length > 0
		? `${message} ${diagnostics.join(" ")}`
		: message;
}

function assertRoutineTargetSpaceListIdentity(
	response: ListCenterAgentRoutineTargetSpacesResponse,
	expectedOrganizationId: string
): void {
	if (response.organizationId !== expectedOrganizationId) {
		throwIdentityMismatch({
			message: `Routine target Space list identity mismatch: expected organization ${expectedOrganizationId}, received ${response.organizationId}.`,
			path: "organizationId",
		});
	}
}

function assertRoutineListIdentity(
	response: ListCenterAgentRoutinesManagementResponse,
	expectedOrganizationId: string
): void {
	if (response.organizationId !== expectedOrganizationId) {
		throwIdentityMismatch({
			message: `Routine list identity mismatch: expected organization ${expectedOrganizationId}, received ${response.organizationId}.`,
			path: "organizationId",
		});
	}
	for (const [index, routine] of response.routines.entries()) {
		if (routine.organizationId !== expectedOrganizationId) {
			throwIdentityMismatch({
				message: `Routine list item identity mismatch at routines[${index}]: expected organization ${expectedOrganizationId}, received ${routine.organizationId}.`,
				path: `routines[${index}].organizationId`,
			});
		}
	}
}

function assertRoutineRunsIdentity(
	response: ListCenterAgentRoutineRunsResponse,
	expected: { organizationId: string; routineId: string }
): void {
	if (response.organizationId !== expected.organizationId) {
		throwIdentityMismatch({
			message: `Routine runs identity mismatch: expected organization ${expected.organizationId}, received ${response.organizationId}.`,
			path: "organizationId",
		});
	}
	if (response.routineId !== expected.routineId) {
		throwIdentityMismatch({
			message: `Routine runs identity mismatch: expected routine ${expected.routineId}, received ${response.routineId}.`,
			path: "routineId",
		});
	}
	for (const [index, run] of response.runs.entries()) {
		if (run.organizationId !== expected.organizationId) {
			throwIdentityMismatch({
				message: `Routine run identity mismatch at runs[${index}]: expected organization ${expected.organizationId}, received ${run.organizationId}.`,
				path: `runs[${index}].organizationId`,
			});
		}
		if (run.routineId !== expected.routineId) {
			throwIdentityMismatch({
				message: `Routine run identity mismatch at runs[${index}]: expected routine ${expected.routineId}, received ${run.routineId}.`,
				path: `runs[${index}].routineId`,
			});
		}
	}
}

function throwIdentityMismatch(input: {
	message: string;
	path: string;
}): never {
	throw Object.assign(new Error(input.message), {
		code: "gateway.invalid_response" as const,
		requestId: null,
		schemaIssueMessage: input.message,
		schemaIssuePath: input.path,
		status: 200,
		upstreamCode: null,
	});
}

function resolveFallbackMessage(
	failure: CenterAgentRoutinesFailure,
	action:
		| "create"
		| "delete"
		| "list"
		| "pause"
		| "resume"
		| "runs"
		| "target_spaces"
		| "update"
): string {
	if (failure.status === 401) {
		return "Sign in again before managing routines.";
	}
	if (
		failure.code === "network.timeout" ||
		failure.code === "network.request_failed"
	) {
		return "OpenMeld could not reach the routines service. Try again.";
	}
	const messages = {
		create: "OpenMeld could not create this routine.",
		delete: "OpenMeld could not delete this routine.",
		list: "OpenMeld could not load routines.",
		pause: "OpenMeld could not pause this routine.",
		resume: "OpenMeld could not resume this routine.",
		runs: "OpenMeld could not load this routine's run history.",
		target_spaces: "OpenMeld could not prepare eligible target Spaces.",
		update: "OpenMeld could not update this routine.",
	} as const;
	return messages[action];
}
