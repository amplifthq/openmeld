import {
	buildOrganizationAgentActivityPath,
	buildOrganizationDirectMessagesPath,
	buildOrganizationDocumentsPath,
	buildOrganizationInboxPath,
	buildOrganizationPeoplePath,
	buildOrganizationProjectsPath,
	buildOrganizationRootPath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";
import type { AppShellSection } from "./shell-layout";

export type AppNavigationItem = {
	label: string;
	section: AppShellSection;
	to: string;
};

export function resolveAppNavigationItems(input: {
	includeSpaces: boolean;
	orgSlug: string;
}): AppNavigationItem[] {
	const items = [
		{
			label: "Center Agent",
			section: "home",
			to: buildOrganizationRootPath(input.orgSlug),
		},
		{
			label: "Inbox",
			section: "inbox",
			to: buildOrganizationInboxPath(input.orgSlug),
		},
		{
			label: "Browse spaces",
			section: "space",
			to: buildOrganizationSpacesPath(input.orgSlug),
		},
		{
			label: "Spaces",
			section: "directMessages",
			to: buildOrganizationDirectMessagesPath(input.orgSlug),
		},
		{
			label: "Team",
			section: "people",
			to: buildOrganizationPeoplePath(input.orgSlug),
		},
		{
			label: "Agent Activity",
			section: "agentActivity",
			to: buildOrganizationAgentActivityPath(input.orgSlug),
		},
		{
			label: "Documents",
			section: "documents",
			to: buildOrganizationDocumentsPath(input.orgSlug),
		},
		{
			label: "Projects",
			section: "projects",
			to: buildOrganizationProjectsPath(input.orgSlug),
		},
	] as const satisfies readonly AppNavigationItem[];

	return items.filter(
		(item) => input.includeSpaces || item.section !== "space"
	);
}
