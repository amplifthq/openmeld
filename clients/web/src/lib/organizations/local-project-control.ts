import {
	type ConnectLocalProjectCandidateInput,
	type ConnectLocalProjectDeclaredPathInput,
	createLocalProjectControlApi,
	type DiscoverLocalProjectsInput,
	type RemoveLocalProjectConnectionInput,
	type RemoveMissingLocalProjectConnectionsInput,
	type SetDefaultLocalProjectConnectionInput,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	LocalProjectControlConnectOutcome,
	LocalProjectControlDiscoverProjectsResponse,
	LocalProjectControlErrorCode,
	LocalProjectControlRemoveConnectionResponse,
	LocalProjectControlRemoveMissingConnectionsResponse,
	LocalProjectControlSetDefaultConnectionResponse,
} from "@openmeld/schemas/types";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type LocalProjectControlFailure = StructuredApiClientFailure;

export const LOCAL_PROJECT_CONTROL_UNREACHABLE_MESSAGE =
	"This computer isn't reachable for OpenMeld right now. Make sure OpenMeld Service is running, then try again.";

const LOCAL_PROJECT_CONTROL_ERROR_CODES = new Set<string>([
	"binding_generation_stale",
	"binding_not_found",
	"candidate_unavailable",
	"command_line_tools_missing",
	"default_missing_requires_replacement",
	"fingerprint_mismatch",
	"git_repository_required",
	"git_unavailable",
	"internal_error",
	"invalid_request",
	"invalid_response",
	"needs_confirmation",
	"path_conflict",
	"path_not_directory",
	"path_not_found",
	"path_unreadable",
	"replacement_invalid",
	"replacement_required",
	"service_offline",
	"service_update_required",
	"timeout",
	"unsupported",
]);

function createWebLocalProjectControlApi(organizationId: string) {
	return createLocalProjectControlApi(
		createWebOpenMeldApiFoundation({ organizationId })
	);
}

export async function discoverCurrentComputerProjects(
	input: DiscoverLocalProjectsInput
): Promise<LocalProjectControlDiscoverProjectsResponse> {
	try {
		return await createWebLocalProjectControlApi(
			input.expectedOrganizationId
		).discoverProjects(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function connectCurrentComputerProjectCandidate(
	input: ConnectLocalProjectCandidateInput
): Promise<LocalProjectControlConnectOutcome> {
	try {
		return await createWebLocalProjectControlApi(
			input.expectedOrganizationId
		).connectCandidate(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function connectCurrentComputerProjectPath(
	input: ConnectLocalProjectDeclaredPathInput
): Promise<LocalProjectControlConnectOutcome> {
	try {
		return await createWebLocalProjectControlApi(
			input.expectedOrganizationId
		).connectDeclaredPath(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function setCurrentComputerProjectDefaultConnection(
	input: SetDefaultLocalProjectConnectionInput
): Promise<LocalProjectControlSetDefaultConnectionResponse> {
	try {
		return await createWebLocalProjectControlApi(
			input.expectedOrganizationId
		).setDefaultConnection(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function removeCurrentComputerProjectConnection(
	input: RemoveLocalProjectConnectionInput
): Promise<LocalProjectControlRemoveConnectionResponse> {
	try {
		return await createWebLocalProjectControlApi(
			input.expectedOrganizationId
		).removeConnection(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function removeCurrentComputerMissingProjectConnections(
	input: RemoveMissingLocalProjectConnectionsInput
): Promise<LocalProjectControlRemoveMissingConnectionsResponse> {
	try {
		return await createWebLocalProjectControlApi(
			input.expectedOrganizationId
		).removeMissingConnections(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function isLocalProjectControlFailureCode(
	error: unknown,
	code: LocalProjectControlErrorCode
): boolean {
	return resolveLocalProjectControlFailureCode(error) === code;
}

export function resolveLocalProjectControlFailureCode(
	error: unknown
): LocalProjectControlErrorCode | null {
	const failure = toStructuredApiClientFailure(error);
	const code = failure.upstreamCode ?? failure.code;
	return isLocalProjectControlErrorCode(code) ? code : null;
}

export function resolveLocalProjectControlErrorMessage(error: unknown): string {
	const failure = toStructuredApiClientFailure(error);
	const code = resolveLocalProjectControlFailureCode(failure);
	switch (code) {
		case "path_not_found":
			return "OpenMeld couldn’t find that folder on this computer. Check the path and try again.";
		case "path_not_directory":
			return "That path is not a folder. Enter the Project’s folder path.";
		case "path_unreadable":
			return "OpenMeld can’t read that folder. Check its permissions and try again.";
		case "path_conflict":
			return "This folder is already connected to another Project on this computer. Update OpenMeld Service, then try again to review the impact and move it here.";
		case "fingerprint_mismatch":
			return "This folder belongs to a different Git repository. Choose the folder that matches this Project.";
		case "git_repository_required":
			return "This Project has a saved repository identity, but this folder is not a Git repository.";
		case "git_unavailable":
		case "command_line_tools_missing":
			return "OpenMeld can’t verify this repository because Git tools aren’t available on this computer. Install Git tools, then try again.";
		case "service_offline":
			return LOCAL_PROJECT_CONTROL_UNREACHABLE_MESSAGE;
		case "service_update_required":
		case "unsupported":
			return "Update OpenMeld Service on this computer before connecting Project folders from the Web.";
		case "timeout":
			return "This computer didn’t finish checking the folder. Try again.";
		case "candidate_unavailable":
			return "That folder is no longer available. Check this computer again or connect the folder manually.";
		case "binding_generation_stale":
		case "binding_not_found":
			return "The connected folders changed on this computer. Check again and retry.";
		case "replacement_required":
		case "replacement_invalid":
		case "default_missing_requires_replacement":
			return "Choose another connected folder as the default before removing this one.";
		case "needs_confirmation":
			return "OpenMeld couldn’t verify this folder with Git. You can still connect it, but automatic matching and worktree discovery won’t be available.";
		default:
			return "OpenMeld couldn’t update this Project on this computer. Try again.";
	}
}

function isLocalProjectControlErrorCode(
	value: string | null
): value is LocalProjectControlErrorCode {
	return LOCAL_PROJECT_CONTROL_ERROR_CODES.has(value ?? "");
}
