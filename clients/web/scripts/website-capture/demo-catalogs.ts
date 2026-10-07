import {
	connectorConnectionListResponseSchema,
	organizationAgentRuntimeOverviewResponseSchema,
} from "@openmeld/schemas";
import { demoDirectory, demoSkill } from "./demo-data";

export function readCurrentOrganizationProfileDirectory() {
	return Promise.resolve(demoDirectory);
}
export const readCurrentOrganizationDirectory =
	readCurrentOrganizationProfileDirectory;
export function readCurrentOrganizationAgentRuntimeOverview() {
	return Promise.resolve(
		organizationAgentRuntimeOverviewResponseSchema.parse({
			organizationId: "org",
			generatedAt: "2026-10-07T10:00:00.000Z",
			agentProfiles: [],
		})
	);
}

export function listCurrentOrganizationSkills() {
	return Promise.resolve({
		organizationId: "org",
		canManage: false,
		skills: [demoSkill],
	});
}
export function getCurrentOrganizationSkill() {
	return Promise.resolve({ skill: demoSkill });
}
export function listCurrentOrganizationConnectorConnections() {
	return Promise.resolve(
		connectorConnectionListResponseSchema.parse({
			organizationId: "org",
			currentUserId: "preview",
			connections: [],
		})
	);
}
export const listCurrentOrganizationAppConnections =
	listCurrentOrganizationConnectorConnections;
export function listCurrentOrganizationConnectorAppCatalog() {
	throw new Error("The demo uses the product's bundled Plugin catalog");
}
export function listCurrentOrganizationConnectorAppRequests() {
	return Promise.resolve({ organizationId: "org", requests: [] });
}
export function listPluginAccess() {
	return Promise.resolve({ policies: [] });
}
