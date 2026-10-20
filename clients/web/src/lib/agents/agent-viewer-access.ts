import type { PublicWakeabilityReason } from "@openmeld/schemas";
import { useQuery } from "@tanstack/react-query";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { useViewerAgentAccessGrants } from "#/query/agent-access";
import { organizationAgentRuntimeOverviewQueryOptions } from "#/query/organizations/organization-directory";

/** Whether the viewer may start work with a colleague's Agent. */
export type AgentViewerAccess = {
	kind: "can_use" | "asks_owner";
	ownerName: string;
};

/**
 * Null for the viewer's own Agents, Agents without a person owner, and
 * while the viewer's grants load, so nothing claims access it has not read.
 */
export function useAgentViewerAccess(input: {
	profileId: string;
	ownerUserId: string | null | undefined;
	ownerName: string | null | undefined;
}): AgentViewerAccess | null {
	const organization = useOptionalAppOrganization();
	const grants = useViewerAgentAccessGrants();
	if (
		!(organization && input.ownerUserId && grants.data) ||
		input.ownerUserId === organization.currentUserId
	) {
		return null;
	}
	return {
		kind: grants.data.includes(input.profileId) ? "can_use" : "asks_owner",
		ownerName: input.ownerName?.trim() || "its owner",
	};
}

/** The public reason a colleague's Agent can't work, from the shared overview. */
export function usePublicWakeabilityReason(input: {
	profileId: string;
	enabled: boolean;
}): PublicWakeabilityReason | null {
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	const overview = useQuery(
		organizationAgentRuntimeOverviewQueryOptions({
			enabled: input.enabled && Boolean(organizationId),
			organizationId,
		})
	);
	if (!input.enabled) {
		return null;
	}
	return (
		overview.data?.agentProfiles.find(
			(profile) => profile.profileId === input.profileId
		)?.readiness.publicWakeabilityReason ?? null
	);
}

/**
 * A short, neutral reason for people who don't own the Agent. It names what
 * is wrong, never how to fix it; the owner's own views carry the fix.
 */
export function formatPublicWakeabilityReason(
	reason: PublicWakeabilityReason
): string {
	switch (reason.code) {
		case "computer_offline":
			return "Computer offline";
		case "harness_turned_off":
			return "Turned off on its computer";
		case "no_working_folder":
			return "No working folder";
		case "not_signed_in":
			return "Not signed in on its computer";
		case "no_subscription":
			return "No active plan";
		case "org_disabled":
			return "Turned off for its account";
		case "version_too_old":
			return "Harness update needed";
		case "usage_exhausted":
			return "Usage limit reached";
		default:
			return "Can’t start work right now";
	}
}
