import { peopleComputerContainsDevice } from "@openmeld/agent-runtime";
import {
	createCurrentDeviceApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { desktopLocalComputerSchema } from "@openmeld/schemas";
import type {
	AgentProfileBindingTarget,
	PeopleComputerTarget,
} from "@openmeld/schemas/types";
import { getDesktopPlatform } from "#/desktop/platform";
import { readLocalRuntimes } from "#/lib/connect/local-runtimes";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function updateAgentProfileWorkspace(input: {
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
		throw toStructuredApiClientFailure(error);
	}
}

async function resolveWorkspaceTarget(input: {
	target?: PeopleComputerTarget;
	expectedComputerId?: string | null;
}) {
	const desktop = getDesktopPlatform();
	if (!desktop) {
		return input.target;
	}
	const local = desktopLocalComputerSchema.parse(await desktop.localComputer());
	if (local.status !== "available") {
		throw new Error(local.message);
	}
	if (input.target) {
		if (
			input.target.deviceId !== local.target.deviceId ||
			input.target.runtimeLane !== local.target.runtimeLane
		) {
			throw new Error(
				"This working folder belongs to a different computer or environment. Choose it on the Agent’s computer."
			);
		}
		return input.target;
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
