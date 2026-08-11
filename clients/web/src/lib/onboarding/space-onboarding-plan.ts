import type {
	OnboardingAccountProfile,
	OnboardingFacts,
	OnboardingPlan,
} from "@openmeld/schemas/types";
import { buildOnboardingPlan } from "@openmeld/start";
import { resolveOnboardingFacts } from "./onboarding-facts";

// Structural inputs — only the fields the mapping reads. Keeps this layer
// decoupled from the full SpaceMembersSnapshot / AuthProfileView schema types
// (the real arrays are assignable here) and trivially testable.
type SpaceMemberLike = {
	profileId: string;
	status: string;
	removedAt: string | null;
};

type SpaceMembersSnapshotLike = {
	humans: readonly SpaceMemberLike[];
	agents: readonly SpaceMemberLike[];
};

type AccountProfileLike = {
	openMeldProfileId: string;
	profileName: string;
	profileKind: "human" | "agent";
	status: string;
};

type AuthSessionLike = { user?: { id?: string | null; name?: string | null } };

function isActiveMember(member: SpaceMemberLike): boolean {
	return member.status === "active" && member.removedAt === null;
}

export function mapAccountProfiles(
	profiles: readonly AccountProfileLike[]
): OnboardingAccountProfile[] {
	return profiles.map((profile) => ({
		profileId: profile.openMeldProfileId,
		kind: profile.profileKind,
		name: profile.profileName,
		active: profile.status === "active",
	}));
}

/**
 * Space membership facts for the acting account. `actingProfileIsMember` is the
 * acting profile; `memberAgentProfileIds` is every active Agent Profile in the
 * Space. The checklist asks whether this Space already has an agent, regardless
 * of whether that agent is owned by the current account or managed by the
 * Organization.
 */
export function resolveSpaceMembershipFacts(
	snapshot: SpaceMembersSnapshotLike | null,
	input: {
		spaceId: string;
		actingProfileId: string;
	}
): OnboardingFacts["space"] {
	if (snapshot === null) {
		return null;
	}

	const isActingMember = (members: readonly SpaceMemberLike[]): boolean =>
		members.some(
			(member) =>
				member.profileId === input.actingProfileId && isActiveMember(member)
		);
	// The Space route can act as any selected profile (human or agent), so check
	// both rosters — an agent-acting member is still a member.
	const actingProfileIsMember =
		isActingMember(snapshot.humans) || isActingMember(snapshot.agents);

	const memberAgentProfileIds: string[] = [];
	for (const agent of snapshot.agents) {
		if (isActiveMember(agent)) {
			memberAgentProfileIds.push(agent.profileId);
		}
	}

	return {
		spaceId: input.spaceId,
		actingProfileIsMember,
		memberAgentProfileIds,
	};
}

/**
 * Build the onboarding plan for the in-Space banner from the read models the
 * Space view already has in scope. Pure: no fetching — the caller passes the
 * already-loaded session, profiles, members snapshot, and device status.
 */
export function deriveSpaceOnboardingPlan(input: {
	authSession: AuthSessionLike | null;
	actingProfileId: string;
	accountProfiles: readonly AccountProfileLike[];
	membersSnapshot: SpaceMembersSnapshotLike | null;
	spaceId: string;
	deviceStatus: OnboardingFacts["device"]["status"];
}): OnboardingPlan {
	const actingDisplayName =
		input.accountProfiles.find(
			(profile) => profile.openMeldProfileId === input.actingProfileId
		)?.profileName ??
		input.authSession?.user?.name ??
		null;

	const facts = resolveOnboardingFacts({
		session: {
			signedIn: input.authSession !== null,
			userId: input.authSession?.user?.id ?? null,
			actingProfileId: input.actingProfileId,
			actingDisplayName,
		},
		accountProfiles: mapAccountProfiles(input.accountProfiles),
		space: resolveSpaceMembershipFacts(input.membersSnapshot, {
			spaceId: input.spaceId,
			actingProfileId: input.actingProfileId,
		}),
		deviceStatus: input.deviceStatus,
	});

	return buildOnboardingPlan(facts);
}
