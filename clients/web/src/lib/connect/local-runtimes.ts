import { projectPeopleComputersToLegacyLocalRuntimes } from "@openmeld/agent-runtime";
import {
	createCurrentDeviceApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	CurrentLocalAgentInstallationsResponse,
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalRuntimesResponse,
	PeopleComputersResponse,
	PeopleComputerTarget,
	RefreshCurrentLocalAgentCatalogResponse,
	RequestCurrentOpenMeldToolsUpdateResponse,
	SelectCurrentLocalAgentInstallationResponse,
	SetCurrentLocalAgentEnabledResponse,
	SetCurrentOpenMeldToolsMaintenanceResponse,
} from "@openmeld/schemas";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type PeopleComputerInventory = LocalRuntimesResponse & {
	peopleComputers: PeopleComputersResponse;
};

export async function readLocalRuntimes(): Promise<PeopleComputerInventory> {
	try {
		const api = createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		);
		const [peopleComputers, routingPreference] = await Promise.all([
			api.listPeopleComputers({ includeUsageLimits: "true" }),
			api.getCurrentTarget(),
		]);
		const target =
			routingPreference.availability === "resolved" ? routingPreference : null;
		// Rendering adapter for the existing local-agent controls. isCurrent here
		// means only the account's routing preference, never this browser's machine.
		// All live connection facts remain in the Core PeopleComputers snapshot.
		return {
			peopleComputers,
			...projectPeopleComputersToLegacyLocalRuntimes(peopleComputers, target),
		};
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function readPeopleComputerReplyReadiness(
	target: PeopleComputerTarget
): Promise<CurrentLocalRuntimeReplyReadinessResponse> {
	try {
		return await createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		).getPeopleComputerReplyReadiness(target);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function readCurrentLocalRuntimeReplyReadiness(): Promise<CurrentLocalRuntimeReplyReadinessResponse> {
	try {
		return await createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		).getCurrentLocalRuntimeReplyReadiness();
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function setLocalRuntimeDisplayName(input: {
	deviceId: string;
	displayName: string | null;
}): Promise<LocalRuntimesResponse> {
	try {
		return await createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		).setDisplayName(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function setPeopleComputerLocalAgentEnabled(
	input: PeopleComputerTarget & {
		agentId: string;
		enabled: boolean;
	}
): Promise<SetCurrentLocalAgentEnabledResponse> {
	try {
		return await createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		).setPeopleComputerLocalAgentEnabled(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function readPeopleComputerLocalAgentInstallations(
	input: PeopleComputerTarget & {
		agentId: string;
	}
): Promise<CurrentLocalAgentInstallationsResponse> {
	try {
		return await createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		).getPeopleComputerLocalAgentInstallations(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function selectPeopleComputerLocalAgentInstallation(
	input: PeopleComputerTarget & {
		agentId: string;
		installationId: string;
	}
): Promise<SelectCurrentLocalAgentInstallationResponse> {
	try {
		return await createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		).selectPeopleComputerLocalAgentInstallation(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function requestPeopleComputerOpenMeldToolsUpdate(
	target: PeopleComputerTarget
): Promise<RequestCurrentOpenMeldToolsUpdateResponse> {
	try {
		return await createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		).requestPeopleComputerOpenMeldToolsUpdate(target);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function setPeopleComputerOpenMeldToolsMaintenance(
	input: PeopleComputerTarget & {
		automaticUpdatesEnabled: boolean;
	}
): Promise<SetCurrentOpenMeldToolsMaintenanceResponse> {
	try {
		return await createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		).setPeopleComputerOpenMeldToolsMaintenance(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function refreshPeopleComputerLocalAgentCatalog(
	target: PeopleComputerTarget
): Promise<RefreshCurrentLocalAgentCatalogResponse> {
	try {
		return await createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		).refreshPeopleComputerLocalAgentCatalog(target);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
