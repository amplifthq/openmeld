import {
	buildOrganizationAccountSettingsPath,
	buildOrganizationAppearanceSettingsPath,
	buildOrganizationCenterAgentSettingsPath,
	buildOrganizationComputerPath,
	buildOrganizationConnectedPluginsSettingsPath,
	buildOrganizationNotificationsSettingsPath,
	buildOrganizationOrgSettingsPath,
	buildOrganizationPrivacySettingsPath,
	buildOrganizationServiceSettingsPath,
	buildOrganizationSettingsRootPath,
} from "./organizations/organization-routes";

export function buildSettingsRoutes(orgSlug: string) {
	return {
		account: buildOrganizationAccountSettingsPath(orgSlug),
		appearance: buildOrganizationAppearanceSettingsPath(orgSlug),
		// Key name matches the Settings section id and the `?appSettings=` value.
		"center-agent": buildOrganizationCenterAgentSettingsPath(orgSlug),
		connectedApps: buildOrganizationConnectedPluginsSettingsPath(orgSlug),
		general: buildOrganizationOrgSettingsPath(orgSlug),
		members: `${buildOrganizationSettingsRootPath(orgSlug)}/members`,
		invitations: `${buildOrganizationSettingsRootPath(orgSlug)}/invitations`,
		security: `${buildOrganizationSettingsRootPath(orgSlug)}/security`,
		notifications: buildOrganizationNotificationsSettingsPath(orgSlug),
		privacy: buildOrganizationPrivacySettingsPath(orgSlug),
		root: buildOrganizationSettingsRootPath(orgSlug),
		service: `${buildOrganizationSettingsRootPath(orgSlug)}/service`,
	} as const;
}

export type SettingsRoutePath = ReturnType<
	typeof buildSettingsRoutes
>[keyof ReturnType<typeof buildSettingsRoutes>];

export function buildComputerSettingsPath(input: {
	deviceId: string;
	orgSlug: string;
}): string {
	return buildOrganizationComputerPath(input);
}

export function buildOpenMeldServiceSettingsPath(input?: {
	orgSlug?: string;
	refresh?: "setup-complete";
}): string {
	if (!input?.orgSlug) {
		return "/login";
	}
	return buildOrganizationServiceSettingsPath({
		focus: "service",
		orgSlug: input.orgSlug,
		refresh: input.refresh,
	});
}
