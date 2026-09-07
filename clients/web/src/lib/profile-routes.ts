import {
	buildOrganizationAgentsPath,
	buildOrganizationPeoplePath,
	buildOrganizationPersonPath,
} from "./organizations/organization-routes";

export function buildProfileHomeRoutes(orgSlug: string) {
	return {
		agents: buildOrganizationAgentsPath(orgSlug),
		people: buildOrganizationPeoplePath(orgSlug),
	} as const;
}

/** ID-only entry for callers without an owner profile; resolves to the canonical person route. */
export function buildAgentProfilePath(input: {
	orgSlug: string;
	profileId: string;
}): string {
	const params = new URLSearchParams({ profileId: input.profileId });
	return `${buildOrganizationAgentsPath(input.orgSlug)}?${params.toString()}`;
}

export function buildHumanProfilePath(input: {
	orgSlug: string;
	profileId: string;
}): string {
	return buildOrganizationPersonPath({
		orgSlug: input.orgSlug,
		personId: input.profileId,
	});
}

export function buildProfilePath(input: {
	orgSlug: string;
	profileId: string;
	profileKind: "agent" | "human";
}): string {
	return input.profileKind === "agent"
		? buildAgentProfilePath(input)
		: buildHumanProfilePath(input);
}
