import { describe, expect, it } from "vitest";
import {
	buildOrganizationAgentActivityChangesPath,
	buildOrganizationAgentActivityPath,
	buildOrganizationAgentActivitySessionsPath,
	buildOrganizationAgentCreationPath,
	buildOrganizationAgentsPath,
	buildOrganizationAppearanceSettingsPath,
	buildOrganizationCenterAgentChatPath,
	buildOrganizationCenterAgentRoutinesPath,
	buildOrganizationCenterAgentSettingsPath,
	buildOrganizationChannelsPath,
	buildOrganizationComputerPath,
	buildOrganizationComputersPath,
	buildOrganizationConnectedPluginsSettingsPath,
	buildOrganizationDefaultPath,
	buildOrganizationDirectMessagePath,
	buildOrganizationDirectMessagesPath,
	buildOrganizationDirectoryAgentsPath,
	buildOrganizationDirectoryDefaultPath,
	buildOrganizationDirectoryLegacyMembersPath,
	buildOrganizationDirectoryPeoplePath,
	buildOrganizationDirectoryRootPath,
	buildOrganizationInboxItemPath,
	buildOrganizationInboxPath,
	buildOrganizationMemoryPath,
	buildOrganizationNotificationsSettingsPath,
	buildOrganizationOrganizationsPath,
	buildOrganizationOrgSettingsPath,
	buildOrganizationPeoplePath,
	buildOrganizationPluginPath,
	buildOrganizationPluginsPath,
	buildOrganizationPrivacySettingsPath,
	buildOrganizationProjectActivityPath,
	buildOrganizationProjectPath,
	buildOrganizationProjectsPath,
	buildOrganizationSkillPath,
	buildOrganizationSkillsPath,
	resolveOrganizationSwitchPath,
} from "./organization-routes";

describe("organization default route", () => {
	it("keeps Home separate from the Center Agent chat destination", () => {
		expect(buildOrganizationDefaultPath("acme")).toBe("/o/acme");
		expect(buildOrganizationCenterAgentChatPath("acme")).toBe(
			"/o/acme/chats/center-agent"
		);
		expect(
			buildOrganizationCenterAgentChatPath("acme", {
				focusSignalId: "signal-123",
				view: "graph",
			})
		).toBe("/o/acme/chats/center-agent?focusSignalId=signal-123&view=graph");
	});

	it("builds an encoded Inbox item deep link", () => {
		expect(
			buildOrganizationInboxItemPath({
				itemId: "item/with spaces",
				orgSlug: "acme",
			})
		).toBe("/o/acme/inbox?item=item%2Fwith+spaces");
	});
});

describe("integration management routes", () => {
	it("keeps Center Agent capabilities inside the Center Agent product", () => {
		expect(buildOrganizationChannelsPath("acme")).toBe(
			"/o/acme/center-agent/channels"
		);
		expect(buildOrganizationPluginsPath("acme")).toBe(
			"/o/acme/center-agent/plugins"
		);
		expect(
			buildOrganizationPluginPath({ orgSlug: "acme", service: "google-drive" })
		).toBe("/o/acme/center-agent/plugins/google-drive");
		expect(buildOrganizationMemoryPath("acme")).toBe(
			"/o/acme/center-agent/memory"
		);
		expect(buildOrganizationCenterAgentSettingsPath("acme")).toBe(
			"/o/acme/center-agent/settings"
		);
	});

	it("keeps global and account preferences under Settings", () => {
		expect(buildOrganizationOrgSettingsPath("acme")).toBe(
			"/o/acme/settings/general"
		);
		expect(buildOrganizationPrivacySettingsPath("acme")).toBe(
			"/o/acme/settings/privacy"
		);
		expect(buildOrganizationAppearanceSettingsPath("acme")).toBe(
			"/o/acme/settings/appearance"
		);
		expect(buildOrganizationNotificationsSettingsPath("acme")).toBe(
			"/o/acme/settings/notifications"
		);
		expect(buildOrganizationConnectedPluginsSettingsPath("acme")).toBe(
			"/o/acme/center-agent/plugins"
		);
	});
});

describe("primary organization routes", () => {
	it("keeps Inbox at the top level of the organization workspace", () => {
		expect(buildOrganizationInboxPath("acme")).toBe("/o/acme/inbox");
	});

	it("keeps People, Agents, and legacy Directory routes explicit", () => {
		expect(buildOrganizationPeoplePath("acme")).toBe("/o/acme/people");
		expect(buildOrganizationAgentsPath("acme")).toBe("/o/acme/agents");
		expect(buildOrganizationAgentCreationPath("acme")).toBe(
			"/o/acme/new-agent"
		);
		expect(buildOrganizationComputersPath("acme")).toBe("/o/acme/computers");
		expect(
			buildOrganizationComputerPath({
				deviceId: "device/with spaces",
				orgSlug: "acme",
			})
		).toBe("/o/acme/computers/device%2Fwith%20spaces");
		expect(buildOrganizationDirectoryRootPath("acme")).toBe(
			"/o/acme/directory"
		);
		expect(buildOrganizationDirectoryAgentsPath("acme")).toBe(
			"/o/acme/directory/agents"
		);
		expect(buildOrganizationDirectoryPeoplePath("acme")).toBe(
			"/o/acme/directory/people"
		);
		expect(buildOrganizationDirectoryLegacyMembersPath("acme")).toBe(
			"/o/acme/directory/members"
		);
		expect(buildOrganizationDirectoryDefaultPath("acme")).toBe(
			"/o/acme/directory/people"
		);
		expect(buildOrganizationOrganizationsPath("acme")).toBe(
			"/o/acme/organizations"
		);
	});

	it("keeps Direct Messages explicit and readable", () => {
		expect(buildOrganizationDirectMessagesPath("acme")).toBe("/o/acme/chats");
		expect(
			buildOrganizationDirectMessagePath({
				orgSlug: "acme",
				search: { profileId: "human/one" },
				spaceId: "space/one",
			})
		).toBe("/o/acme/chats/space%2Fone?profileId=human%2Fone");
	});

	it("keeps Agent Activity outside the Organization section", () => {
		expect(buildOrganizationAgentActivityPath("acme")).toBe(
			"/o/acme/agent-activity"
		);
		expect(buildOrganizationAgentActivitySessionsPath("acme")).toBe(
			"/o/acme/agent-activity/sessions"
		);
		expect(buildOrganizationAgentActivityChangesPath("acme")).toBe(
			"/o/acme/agent-activity/changes"
		);
	});

	it("keeps Routines inside the Center Agent product", () => {
		expect(buildOrganizationCenterAgentRoutinesPath("acme")).toBe(
			"/o/acme/center-agent/routines"
		);
	});

	it("keeps Organization Skills inside the Center Agent route family", () => {
		expect(buildOrganizationSkillsPath("acme")).toBe(
			"/o/acme/center-agent/skills"
		);
		expect(
			buildOrganizationSkillPath({
				orgSlug: "acme",
				skillId: "skill/one",
			})
		).toBe("/o/acme/center-agent/skills/skill%2Fone");
	});

	it("uses immutable Project ids for the Projects route family", () => {
		expect(buildOrganizationProjectsPath("acme")).toBe("/o/acme/projects");
		expect(
			buildOrganizationProjectPath({ orgSlug: "acme", projectId: "project-1" })
		).toBe("/o/acme/projects/project-1");
	});

	it("links Activity with an immutable Project filter", () => {
		expect(
			buildOrganizationProjectActivityPath({
				orgSlug: "acme",
				projectId: "project/one",
			})
		).toBe("/o/acme/agent-activity/sessions?project=project%2Fone");
	});
});

describe("resolveOrganizationSwitchPath", () => {
	it.each([
		["Inbox", "/o/acme/inbox", "/o/beta/inbox"],
		["Home", "/o/acme", "/o/beta"],
		[
			"Legacy Center Agent Chat",
			"/o/acme/center-agent/chat",
			"/o/beta/chats/center-agent",
		],
		[
			"Center Agent Routines",
			"/o/acme/center-agent/routines",
			"/o/beta/center-agent/routines",
		],
		[
			"Center Agent Skills",
			"/o/acme/center-agent/skills",
			"/o/beta/center-agent/skills",
		],
		[
			"Center Agent Skill detail",
			"/o/acme/center-agent/skills/skill-acme",
			"/o/beta/center-agent/skills",
		],
		["Spaces", "/o/acme/spaces", "/o/beta/spaces"],
		["Space detail", "/o/acme/spaces/space-acme", "/o/beta/spaces"],
		["Direct Messages", "/o/acme/chats", "/o/beta/chats"],
		["Direct Message detail", "/o/acme/chats/space-acme", "/o/beta/chats"],
		["People", "/o/acme/people", "/o/beta/people"],
		["Agents", "/o/acme/agents", "/o/beta/agents"],
		["Computers", "/o/acme/computers", "/o/beta/computers"],
		["Directory root", "/o/acme/directory", "/o/beta/people"],
		["Directory Agents", "/o/acme/directory/agents", "/o/beta/agents"],
		["Directory People", "/o/acme/directory/people", "/o/beta/people"],
		["Legacy Directory Members", "/o/acme/directory/members", "/o/beta/people"],
		[
			"Center Agent Channels",
			"/o/acme/center-agent/channels",
			"/o/beta/center-agent/channels",
		],
		[
			"Center Agent Plugins",
			"/o/acme/center-agent/plugins",
			"/o/beta/center-agent/plugins",
		],
		[
			"Center Agent Plugin detail",
			"/o/acme/center-agent/plugins/github",
			"/o/beta/center-agent/plugins",
		],
		[
			"Center Agent Memory",
			"/o/acme/center-agent/memory",
			"/o/beta/center-agent/memory",
		],
		[
			"Center Agent settings",
			"/o/acme/center-agent/settings",
			"/o/beta/center-agent/settings",
		],
		["Projects", "/o/acme/projects", "/o/beta/projects"],
		["Project detail", "/o/acme/projects/project-acme", "/o/beta/projects"],
		["Agent Activity", "/o/acme/agent-activity", "/o/beta/agent-activity"],
		[
			"Agent Activity Sessions",
			"/o/acme/agent-activity/sessions",
			"/o/beta/agent-activity/sessions",
		],
		[
			"Agent Activity Changes",
			"/o/acme/agent-activity/changes",
			"/o/beta/agent-activity/changes",
		],
		["Organizations", "/o/acme/organizations", "/o/beta/organizations"],
		["Settings root", "/o/acme/settings", "/o/beta/settings/account"],
		["Account", "/o/acme/settings/account", "/o/beta/settings/account"],
		[
			"Legacy Settings Computers",
			"/o/acme/settings/computers",
			"/o/beta/computers",
		],
		[
			"Computer detail",
			"/o/acme/settings/computers/device-acme",
			"/o/beta/computers",
		],
		[
			"Appearance",
			"/o/acme/settings/appearance",
			"/o/beta/settings/appearance",
		],
		[
			"Notifications",
			"/o/acme/settings/notifications",
			"/o/beta/settings/notifications",
		],
		[
			"Connected Plugins",
			"/o/acme/settings/connected-apps",
			"/o/beta/center-agent/plugins",
		],
		["Privacy", "/o/acme/settings/privacy", "/o/beta/settings/privacy"],
		["General", "/o/acme/settings/general", "/o/beta/settings/general"],
	])("keeps %s on its canonical destination", (_label, currentPathname, expectedPath) => {
		expect(
			resolveOrganizationSwitchPath({
				currentPathname,
				nextOrgSlug: "beta",
			})
		).toBe(expectedPath);
	});

	it.each([
		"/o/acme/profiles",
		"/o/acme/organization/memory",
		"/o/acme/settings/removed",
		"/outside-the-workspace",
	])("falls back to Home from an obsolete or invalid path %s", (currentPathname) => {
		expect(
			resolveOrganizationSwitchPath({
				currentPathname,
				nextOrgSlug: "beta",
			})
		).toBe("/o/beta");
	});
});
