import { peopleComputerContainsDevice } from "@openmeld/agent-runtime";
import {
	createCurrentDeviceApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { desktopLocalComputerSchema } from "@openmeld/schemas";
import type {
	AgentProfileBindingTarget,
	GetCurrentAgentProfileWorkspaceResponse,
	PeopleComputerTarget,
	ProfileWorkspaceReadResult,
} from "@openmeld/schemas/types";
import { getDesktopPlatform } from "#/desktop/platform";
import { readLocalRuntimes } from "#/lib/connect/local-runtimes";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function readAgentProfileWorkspace(input: {
	actorProfileId?: string | null;
	organizationId: string;
	profileId: string;
	target?: PeopleComputerTarget;
	expectedBindingTarget?: AgentProfileBindingTarget;
}): Promise<GetCurrentAgentProfileWorkspaceResponse> {
	try {
		const target = await resolveWorkspaceTarget(input);
		return await createCurrentDeviceApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				...(input.actorProfileId
					? { openMeldProfileId: input.actorProfileId }
					: {}),
				organizationId: input.organizationId,
			})
		).getCurrentAgentProfileWorkspace({
			agentProfileId: input.profileId,
			...(target ? { target } : {}),
			...(input.expectedBindingTarget
				? { expectedBindingTarget: input.expectedBindingTarget }
				: {}),
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function updateAgentProfileWorkspace(input: {
	previousWorkspace?: ProfileWorkspaceReadResult;
	actorProfileId?: string | null;
	organizationId: string;
	profileId: string;
	workspaceMode: "custom" | "openmeld_managed";
	workspacePath?: string;
	target?: PeopleComputerTarget;
	expectedComputerId?: string | null;
	expectedBindingTarget?: AgentProfileBindingTarget;
}): Promise<void> {
	try {
		const target = await resolveWorkspaceTarget(input);
		await createCurrentDeviceApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				...(input.actorProfileId
					? { openMeldProfileId: input.actorProfileId }
					: {}),
				organizationId: input.organizationId,
			})
		).setCurrentAgentProfileWorkspace({
			...(input.expectedBindingTarget
				? { expectedBindingTarget: input.expectedBindingTarget }
				: {}),
			...(target ? { target } : {}),
			agentProfileId: input.profileId,
			workspaceMode: input.workspaceMode,
			...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
		});
	} catch (error) {
		if (input.previousWorkspace && (await confirmWorkspaceSave(input, error))) {
			return;
		}
		throw toStructuredApiClientFailure(error);
	}
}

async function confirmWorkspaceSave(
	input: Parameters<typeof updateAgentProfileWorkspace>[0],
	error: unknown
): Promise<boolean> {
	const failure = toStructuredApiClientFailure(error);
	if (failure.status !== null && failure.status < 500) {
		return false;
	}
	try {
		const current = (await readAgentProfileWorkspace(input)).workspace;
		const previous = input.previousWorkspace;
		return (
			current.status === "configured" &&
			current.workspaceMode === input.workspaceMode &&
			(input.workspaceMode === "openmeld_managed" ||
				current.workspacePath === input.workspacePath) &&
			(previous?.status !== "configured" ||
				current.updatedAt !== previous.updatedAt)
		);
	} catch {
		// The original failure remains actionable. A lost response is not a failed
		// write, and an unconfirmed read is not permission to claim success.
		return false;
	}
}

async function resolveWorkspaceTarget(input: {
	target?: PeopleComputerTarget;
	expectedComputerId?: string | null;
}) {
	// Explicit targets are already bound by the owning API. Desktop Main checks
	// its live account/device/lane before every mutation. Do not repeat the
	// native process check in the renderer or block private saved-state reads.
	if (input.target) {
		return input.target;
	}
	const desktop = getDesktopPlatform();
	if (!desktop) {
		return input.target;
	}
	const local = desktopLocalComputerSchema.parse(await desktop.localComputer());
	if (local.status !== "available") {
		throw new Error(local.message);
	}
	// Creation recovery retains the user's selected Computer identity. Resolve
	// that identity against the native Service, never the account's current target.
	if (input.expectedComputerId) {
		const inventory = await readLocalRuntimes();
		const selected = inventory.peopleComputers.computers.find(
			(computer) =>
				computer.connectedComputerId === input.expectedComputerId ||
				peopleComputerContainsDevice(
					computer,
					input.expectedComputerId as string
				)
		);
		if (
			selected &&
			peopleComputerContainsDevice(selected, local.target.deviceId)
		) {
			return local.target;
		}
	}
	throw new Error(
		"Couldn’t confirm the computer for this working folder. Reopen Agent settings and choose the folder again."
	);
}
