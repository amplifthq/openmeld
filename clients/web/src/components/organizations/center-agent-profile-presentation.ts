import type {
	CenterAgentDesignation,
	OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";

export type DirectoryAgentProfile =
	OrganizationDirectoryResponse["agentProfiles"][number];
export type CenterAgentConnectionStatus =
	| "Available"
	| "Disconnected"
	| "Paused"
	| "Unavailable";

export function resolveDesignatedCenterAgentProfile<
	Profile extends { profileId: string },
>(input: {
	agentProfiles: readonly Profile[];
	designation: CenterAgentDesignation | null;
}): Profile | null {
	if (!input.designation) {
		return null;
	}
	return (
		input.agentProfiles.find(
			(profile) => profile.profileId === input.designation?.agentProfileId
		) ?? null
	);
}

export function resolveCenterAgentConnectionStatus(
	profile: DirectoryAgentProfile
): CenterAgentConnectionStatus {
	const badgeLabel = profile.readiness?.agentWakeAvailability?.badgeLabel;
	if (badgeLabel === "Available") {
		return "Available";
	}
	if (badgeLabel === "Disconnected") {
		return "Disconnected";
	}
	return "Unavailable";
}
