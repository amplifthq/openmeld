import type { ListMemberAgentsResponse } from "@openmeld/schemas";
import type { AuthProfileView } from "@openmeld/schemas/types";

export const OWNER_USER_ID = "user-felix";

export function agentProfile(
	profileId: string,
	profileName: string,
	overrides: Partial<AuthProfileView> = {}
): AuthProfileView {
	return {
		avatarUrl: undefined,
		createdAt: "2026-08-01T00:00:00.000Z",
		createdByUserId: OWNER_USER_ID,
		creatorProfileId: null,
		isDefault: false,
		lastUsedAt: null,
		managedRole: null,
		openMeldProfileId: profileId,
		ownerName: "Felix Lu",
		ownerUserId: OWNER_USER_ID,
		profileHandle: profileId,
		profileKind: "agent",
		profileName,
		source: "web_create",
		status: "active",
		updatedAt: "2026-08-01T00:00:00.000Z",
		...overrides,
	};
}

/**
 * A migrated member: Claude Code with a default and a second Profile, Codex
 * with one, one Profile bound to a custom controller (unassigned), and one
 * Profile created after the listing was read.
 */
export const MIGRATED_PROFILES: readonly AuthProfileView[] = [
	agentProfile("agt-claude-default", "Claude Code"),
	agentProfile("agt-claude-reviewer", "PR Reviewer"),
	agentProfile("agt-codex", "Codex helper"),
	agentProfile("agt-custom", "Custom script"),
	agentProfile("agt-new", "Brand new"),
];

export const MIGRATED_LISTING: ListMemberAgentsResponse = {
	ok: true,
	organizationId: "org-test",
	memberAgents: [
		{
			id: "ma-claude",
			organizationId: "org-test",
			ownerUserId: OWNER_USER_ID,
			harnessKind: "claude-code",
			defaultProfileId: "agt-claude-default",
			source: "migrated",
			archivedAt: null,
			profiles: [
				{
					openMeldProfileId: "agt-claude-default",
					profileName: "Claude Code",
					isDefault: true,
				},
				{
					openMeldProfileId: "agt-claude-reviewer",
					profileName: "PR Reviewer",
					isDefault: false,
				},
			],
		},
		{
			id: "ma-codex",
			organizationId: "org-test",
			ownerUserId: OWNER_USER_ID,
			harnessKind: "codex",
			defaultProfileId: "agt-codex",
			source: "migrated",
			archivedAt: null,
			profiles: [
				{
					openMeldProfileId: "agt-codex",
					profileName: "Codex helper",
					isDefault: true,
				},
			],
		},
	],
	unassignedProfiles: [
		{ openMeldProfileId: "agt-custom", profileName: "Custom script" },
	],
};
