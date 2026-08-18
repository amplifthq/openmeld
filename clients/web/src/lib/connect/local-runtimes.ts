import {
	createCurrentDeviceApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	CurrentLocalAgentInstallationsResponse,
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalRuntimesResponse,
	RefreshCurrentLocalAgentCatalogResponse,
	SelectCurrentLocalAgentInstallationResponse,
	SetCurrentLocalAgentEnabledResponse,
} from "@openmeld/schemas";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function readLocalRuntimes(): Promise<LocalRuntimesResponse> {
	try {
		return await createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		).listLocalRuntimes({
			connectionIdentityAdoption: "safe_legacy_current",
		});
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

export async function refreshCurrentLocalAgentCatalog(): Promise<RefreshCurrentLocalAgentCatalogResponse> {
	try {
		return await createCurrentDeviceApi(
			createUnscopedWebOpenMeldApiFoundation()
		).refreshCurrentLocalAgentCatalog();
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
