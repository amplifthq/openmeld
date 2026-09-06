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
			currentDeviceId: target?.deviceId ?? null,
			currentRuntimeLane: target?.runtimeLane ?? null,
			localRuntimes: peopleComputers.computers.map((computer) => ({
				...computer,
				isCurrent:
					target !== null &&
					(computer.deviceId === target.deviceId ||
						computer.legacyDeviceIds?.includes(target.deviceId) === true),
				executionTargets: computer.executionTargets.map((entry) => ({
					...entry,
					isCurrent:
						entry.deviceId === target?.deviceId &&
						entry.runtimeLane === target?.runtimeLane,
				})),
			})),
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

export async function setCurrentLocalAgentEnabled(input: {
	agentId: string;
	enabled: boolean;
}): Promise<SetCurrentLocalAgentEnabledResponse> {
	try {
		return await createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		).setCurrentLocalAgentEnabled(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function readCurrentLocalAgentInstallations(input: {
	agentId: string;
}): Promise<CurrentLocalAgentInstallationsResponse> {
	try {
		return await createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		).getCurrentLocalAgentInstallations(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function selectCurrentLocalAgentInstallation(input: {
	agentId: string;
	installationId: string;
}): Promise<SelectCurrentLocalAgentInstallationResponse> {
	try {
		return await createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		).selectCurrentLocalAgentInstallation(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function requestCurrentOpenMeldToolsUpdate(): Promise<RequestCurrentOpenMeldToolsUpdateResponse> {
	try {
		return await createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		).requestCurrentOpenMeldToolsUpdate();
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function setCurrentOpenMeldToolsMaintenance(input: {
	automaticUpdatesEnabled: boolean;
}): Promise<SetCurrentOpenMeldToolsMaintenanceResponse> {
	try {
		return await createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		).setCurrentOpenMeldToolsMaintenance(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function refreshCurrentLocalAgentCatalog(): Promise<RefreshCurrentLocalAgentCatalogResponse> {
	try {
		return await createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		).refreshCurrentLocalAgentCatalog();
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
