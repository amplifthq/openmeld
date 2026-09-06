import {
	buildOrganizationPluginPath as buildSharedOrganizationAppPath,
	buildOrganizationPluginsPath as buildSharedOrganizationPluginsPath,
	buildOrganizationRootPath as buildSharedOrganizationRootPath,
	buildOrganizationSpacePath as buildSharedOrganizationSpacePath,
} from "@openmeld/schemas";

export const buildOrganizationPluginPath = buildSharedOrganizationAppPath;
export const buildOrganizationPluginsPath = buildSharedOrganizationPluginsPath;
export const buildOrganizationRootPath = buildSharedOrganizationRootPath;
export const buildOrganizationSpacePath = buildSharedOrganizationSpacePath;

const ORGANIZATION_SCOPED_PATH_PATTERN = /^\/o\/[^/]+(?:\/|$)/;

function encodePathSegment(value: string): string {
	return encodeURIComponent(value);
}

export function buildOrganizationDefaultPath(orgSlug: string): string {
	return buildOrganizationRootPath(orgSlug);
}

export function buildOrganizationInboxPath(orgSlug: string): string {
	return `${buildOrganizationRootPath(orgSlug)}/inbox`;
}

export function buildOrganizationInboxItemPath(input: {
	itemId: string;
	orgSlug: string;
}): string {
	const url = new URL(
		buildOrganizationInboxPath(input.orgSlug),
		"http://localhost"
	);
	url.searchParams.set("item", input.itemId);
	return `${url.pathname}${url.search}`;
}

export function buildOrganizationSpacesPath(orgSlug: string): string {
	return `${buildOrganizationRootPath(orgSlug)}/spaces`;
}

export function buildOrganizationDirectMessagesPath(orgSlug: string): string {
	return `${buildOrganizationRootPath(orgSlug)}/direct-messages`;
}

export function buildOrganizationDirectMessagePath(input: {
	orgSlug: string;
	search?: Record<string, string | null | undefined>;
	spaceId: string;
}): string {
	const url = new URL(
		`${buildOrganizationDirectMessagesPath(input.orgSlug)}/${encodePathSegment(
			input.spaceId
		)}`,
		"http://localhost"
	);
	for (const [key, value] of Object.entries(input.search ?? {})) {
		if (typeof value === "string" && value.trim().length > 0) {
			url.searchParams.set(key, value);
		}
	}
	return `${url.pathname}${url.search}`;
}

export function buildOrganizationNewSpacePath(orgSlug: string): string {
	return `${buildOrganizationRootPath(orgSlug)}/new-space`;
}

export function buildOrganizationNewOrganizationPath(orgSlug: string): string {
	return `${buildOrganizationRootPath(orgSlug)}/new-organization`;
}

export function buildOrganizationDirectoryRootPath(orgSlug: string): string {
	return `${buildOrganizationRootPath(orgSlug)}/directory`;
}

export function buildOrganizationDirectoryAgentsPath(orgSlug: string): string {
	return `${buildOrganizationDirectoryRootPath(orgSlug)}/agents`;
}

export function buildOrganizationDirectoryPeoplePath(orgSlug: string): string {
	return `${buildOrganizationDirectoryRootPath(orgSlug)}/people`;
}

export function buildOrganizationDirectoryLegacyMembersPath(
	orgSlug: string
): string {
	return `${buildOrganizationDirectoryRootPath(orgSlug)}/members`;
}

export function buildOrganizationDirectoryDefaultPath(orgSlug: string): string {
	return buildOrganizationDirectoryPeoplePath(orgSlug);
}

export function buildOrganizationPeoplePath(orgSlug: string): string {
	return `${buildOrganizationRootPath(orgSlug)}/people`;
}

export function buildOrganizationAgentsPath(orgSlug: string): string {
	return `${buildOrganizationRootPath(orgSlug)}/agents`;
}

export function buildOrganizationAgentCreationPath(orgSlug: string): string {
	return `${buildOrganizationAgentsPath(orgSlug)}/new`;
}

export function buildOrganizationAgentCreationRequestsPath(input: {
	orgSlug: string;
	requestId?: string | null;
}): string {
	const url = new URL(
		buildOrganizationAgentsPath(input.orgSlug),
		"http://localhost"
	);
	url.searchParams.set("view", "requests");
	if (input.requestId) {
		url.searchParams.set("requestId", input.requestId);
	}
	return `${url.pathname}${url.search}`;
}

export function buildOrganizationComputersPath(orgSlug: string): string {
	return `${buildOrganizationRootPath(orgSlug)}/computers`;
}

export function buildOrganizationComputerPath(input: {
	deviceId: string;
	orgSlug: string;
}): string {
	return `${buildOrganizationComputersPath(input.orgSlug)}/${encodePathSegment(
		input.deviceId
	)}`;
}

export function buildOrganizationOrganizationsPath(orgSlug: string): string {
	return `${buildOrganizationRootPath(orgSlug)}/organizations`;
}

export function buildOrganizationOnboardingPath(orgSlug: string): string {
	return `${buildOrganizationRootPath(orgSlug)}/onboarding`;
}

export function buildOrganizationMemoryPath(orgSlug: string): string {
	return `${buildOrganizationCenterAgentRootPath(orgSlug)}/memory`;
}

export function buildOrganizationChannelsPath(orgSlug: string): string {
	return `${buildOrganizationCenterAgentRootPath(orgSlug)}/channels`;
}

export function buildOrganizationAgentActivityPath(orgSlug: string): string {
	return `${buildOrganizationRootPath(orgSlug)}/agent-activity`;
}

export function buildOrganizationAgentActivitySessionsPath(
	orgSlug: string
): string {
	return `${buildOrganizationAgentActivityPath(orgSlug)}/sessions`;
}

export function buildOrganizationAgentActivityChangesPath(
	orgSlug: string
): string {
	return `${buildOrganizationAgentActivityPath(orgSlug)}/changes`;
}

export function buildOrganizationProjectActivityPath(input: {
	orgSlug: string;
	projectId: string;
}): string {
	const url = new URL(
		buildOrganizationAgentActivitySessionsPath(input.orgSlug),
		"http://localhost"
	);
	url.searchParams.set("project", input.projectId);
	return `${url.pathname}${url.search}`;
}

export function buildOrganizationCenterAgentRoutinesPath(
	orgSlug: string
): string {
	return `${buildOrganizationCenterAgentRootPath(orgSlug)}/routines`;
}

export function buildOrganizationCenterAgentTasksPath(orgSlug: string): string {
	return `${buildOrganizationCenterAgentRootPath(orgSlug)}/tasks`;
}

export function buildOrganizationCenterAgentTaskPath(input: {
	orgSlug: string;
	taskId: string;
}): string {
	return `${buildOrganizationCenterAgentTasksPath(input.orgSlug)}/${encodePathSegment(
		input.taskId
	)}`;
}

export function buildOrganizationDocumentsPath(orgSlug: string): string {
	return `${buildOrganizationRootPath(orgSlug)}/documents`;
}

export function buildOrganizationDocumentPath(input: {
	documentId: string;
	orgSlug: string;
}): string {
	return `${buildOrganizationDocumentsPath(input.orgSlug)}/${encodePathSegment(
		input.documentId
	)}`;
}

export function buildOrganizationNewDocumentPath(input: {
	kind?: "brief" | "knowledge" | "member_profile";
	orgSlug: string;
	subjectUserId?: string;
}): string {
	const url = new URL(
		`${buildOrganizationDocumentsPath(input.orgSlug)}/new`,
		"http://localhost"
	);
	if (input.kind) {
		url.searchParams.set("kind", input.kind);
	}
	if (input.subjectUserId) {
		url.searchParams.set("subjectUserId", input.subjectUserId);
	}
	return `${url.pathname}${url.search}`;
}

export function buildOrganizationProjectsPath(orgSlug: string): string {
	return `${buildOrganizationRootPath(orgSlug)}/projects`;
}

export function buildOrganizationProjectPath(input: {
	orgSlug: string;
	projectId: string;
}): string {
	return `${buildOrganizationProjectsPath(input.orgSlug)}/${encodePathSegment(
		input.projectId
	)}`;
}

export function buildOrganizationCenterAgentRootPath(orgSlug: string): string {
	return `${buildOrganizationRootPath(orgSlug)}/center-agent`;
}

export function buildOrganizationCenterAgentChatPath(
	orgSlug: string,
	search?: {
		session?: string;
		focusSignalId?: string;
		view?: "files" | "graph" | "messages";
	}
): string {
	const path = buildOrganizationDefaultPath(orgSlug);
	if (!(search?.focusSignalId || search?.view || search?.session)) {
		return path;
	}
	const params = new URLSearchParams();
	if (search.session) {
		params.set("session", search.session);
	}
	if (search.focusSignalId) {
		params.set("focusSignalId", search.focusSignalId);
	}
	if (search.view) {
		params.set("view", search.view);
	}
	return `${path}?${params.toString()}`;
}

export function buildOrganizationSkillsPath(orgSlug: string): string {
	return `${buildOrganizationCenterAgentRootPath(orgSlug)}/skills`;
}

export function buildOrganizationSkillPath(input: {
	orgSlug: string;
	skillId: string;
}): string {
	return `${buildOrganizationSkillsPath(input.orgSlug)}/${encodePathSegment(
		input.skillId
	)}`;
}

export function buildOrganizationCenterAgentSettingsPath(
	orgSlug: string
): string {
	return `${buildOrganizationCenterAgentRootPath(orgSlug)}/settings`;
}

export function buildOrganizationPrivacySettingsPath(orgSlug: string): string {
	return `${buildOrganizationSettingsRootPath(orgSlug)}/privacy`;
}

export function buildOrganizationOrgSettingsPath(orgSlug: string): string {
	return `${buildOrganizationSettingsRootPath(orgSlug)}/general`;
}

export function buildOrganizationSettingsRootPath(orgSlug: string): string {
	return `${buildOrganizationRootPath(orgSlug)}/settings`;
}

export function buildOrganizationAccountSettingsPath(orgSlug: string): string {
	return `${buildOrganizationSettingsRootPath(orgSlug)}/account`;
}

export function buildOrganizationAppearanceSettingsPath(
	orgSlug: string
): string {
	return `${buildOrganizationSettingsRootPath(orgSlug)}/appearance`;
}

export function buildOrganizationNotificationsSettingsPath(
	orgSlug: string
): string {
	return `${buildOrganizationSettingsRootPath(orgSlug)}/notifications`;
}

export function buildOrganizationConnectedPluginsSettingsPath(
	orgSlug: string
): string {
	return buildOrganizationPluginsPath(orgSlug);
}

export function buildOrganizationComputersSettingsPath(
	orgSlug: string
): string {
	return `${buildOrganizationSettingsRootPath(orgSlug)}/computers`;
}

export function buildOrganizationComputerSettingsPath(input: {
	deviceId: string;
	orgSlug: string;
}): string {
	return `${buildOrganizationComputersSettingsPath(
		input.orgSlug
	)}/${encodePathSegment(input.deviceId)}`;
}

export function buildOrganizationServiceSettingsPath(input: {
	orgSlug: string;
	focus?: "service";
	refresh?: "setup-complete";
}): string {
	const url = new URL(
		buildOrganizationComputersPath(input.orgSlug),
		"http://localhost"
	);
	if (input.focus) {
		url.searchParams.set("focus", input.focus);
	}
	if (input.refresh) {
		url.searchParams.set("refresh", input.refresh);
	}
	return `${url.pathname}${url.search}`;
}

export function buildOrganizationConnectPath(input: {
	orgSlug: string;
	search?: Record<string, string | null | undefined>;
}): string {
	const url = new URL(
		`${buildOrganizationRootPath(input.orgSlug)}/connect`,
		"http://localhost"
	);
	for (const [key, value] of Object.entries(input.search ?? {})) {
		if (typeof value === "string" && value.trim().length > 0) {
			url.searchParams.set(key, value);
		}
	}
	return `${url.pathname}${url.search}`;
}

export function isOrganizationScopedPath(pathname: string): boolean {
	return ORGANIZATION_SCOPED_PATH_PATTERN.test(pathname);
}

export function resolveOrganizationSwitchPath(input: {
	currentPathname: string;
	nextOrgSlug: string;
}): string {
	const suffix = input.currentPathname.replace(
		ORGANIZATION_SCOPED_PATH_PATTERN,
		"/"
	);
	const normalizedSuffix = suffix === input.currentPathname ? "" : suffix;
	const pathSegments = normalizedSuffix.split("/").filter(Boolean);
	const [section, subsection] = pathSegments;
	if (!section) {
		return buildOrganizationRootPath(input.nextOrgSlug);
	}

	if (section === "center-agent") {
		switch (subsection) {
			case "routines":
				return buildOrganizationCenterAgentRoutinesPath(input.nextOrgSlug);
			case "tasks":
				return buildOrganizationCenterAgentTasksPath(input.nextOrgSlug);
			case "skills":
				return buildOrganizationSkillsPath(input.nextOrgSlug);
			case "channels":
				return buildOrganizationChannelsPath(input.nextOrgSlug);
			case "plugins":
				return buildOrganizationPluginsPath(input.nextOrgSlug);
			case "memory":
				return buildOrganizationMemoryPath(input.nextOrgSlug);
			case "settings":
				return buildOrganizationCenterAgentSettingsPath(input.nextOrgSlug);
			default:
				return buildOrganizationCenterAgentChatPath(input.nextOrgSlug);
		}
	}

	if (section === "spaces") {
		return buildOrganizationSpacesPath(input.nextOrgSlug);
	}

	if (section === "direct-messages") {
		return buildOrganizationDirectMessagesPath(input.nextOrgSlug);
	}

	if (section === "inbox") {
		return buildOrganizationInboxPath(input.nextOrgSlug);
	}

	const productHomeSwitchPath = resolveProductHomeSwitchPath({
		nextOrgSlug: input.nextOrgSlug,
		pathSegments,
	});
	if (productHomeSwitchPath) {
		return productHomeSwitchPath;
	}

	if (section === "organizations") {
		return buildOrganizationOrganizationsPath(input.nextOrgSlug);
	}

	if (section === "agent-activity") {
		switch (subsection) {
			case "sessions":
				return buildOrganizationAgentActivitySessionsPath(input.nextOrgSlug);
			case "changes":
				return buildOrganizationAgentActivityChangesPath(input.nextOrgSlug);
			default:
				return buildOrganizationAgentActivityPath(input.nextOrgSlug);
		}
	}

	if (section === "projects") {
		return buildOrganizationProjectsPath(input.nextOrgSlug);
	}

	if (section === "documents") {
		return buildOrganizationDocumentsPath(input.nextOrgSlug);
	}

	const settingsSwitchPath = resolveSettingsSwitchPath({
		nextOrgSlug: input.nextOrgSlug,
		pathSegments,
	});
	if (settingsSwitchPath) {
		return settingsSwitchPath;
	}

	return buildOrganizationRootPath(input.nextOrgSlug);
}

function resolveProductHomeSwitchPath(input: {
	nextOrgSlug: string;
	pathSegments: string[];
}): string | null {
	const [section, subsection] = input.pathSegments;
	switch (section) {
		case "people":
			return buildOrganizationPeoplePath(input.nextOrgSlug);
		case "agents":
			return subsection === "new"
				? buildOrganizationAgentCreationPath(input.nextOrgSlug)
				: buildOrganizationAgentsPath(input.nextOrgSlug);
		case "computers":
			return buildOrganizationComputersPath(input.nextOrgSlug);
		case "directory":
			return subsection === "agents"
				? buildOrganizationAgentsPath(input.nextOrgSlug)
				: buildOrganizationPeoplePath(input.nextOrgSlug);
		default:
			return null;
	}
}

function resolveSettingsSwitchPath(input: {
	nextOrgSlug: string;
	pathSegments: string[];
}): string | null {
	const [section, subsection] = input.pathSegments;
	if (section !== "settings") {
		return null;
	}
	if (subsection === "computers") {
		return buildOrganizationComputersPath(input.nextOrgSlug);
	}
	switch (subsection) {
		case undefined:
		case "account":
			return buildOrganizationAccountSettingsPath(input.nextOrgSlug);
		case "appearance":
			return buildOrganizationAppearanceSettingsPath(input.nextOrgSlug);
		case "notifications":
			return buildOrganizationNotificationsSettingsPath(input.nextOrgSlug);
		case "connected-apps":
			return buildOrganizationConnectedPluginsSettingsPath(input.nextOrgSlug);
		case "general":
			return buildOrganizationOrgSettingsPath(input.nextOrgSlug);
		case "privacy":
			return buildOrganizationPrivacySettingsPath(input.nextOrgSlug);
		default:
			return null;
	}
}
