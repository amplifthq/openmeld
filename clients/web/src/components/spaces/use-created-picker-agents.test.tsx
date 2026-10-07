import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import type { OrganizationSpaceProfileCandidates } from "#/query/organizations/organization-directory";
import {
	buildOrganizationDirectoryAddCandidates,
	type SpaceAddMembersCandidateSummary,
} from "./people-agent-picker-model";
import { useCreatedPickerAgents } from "./use-created-picker-agents";

it("keeps a confirmed Agent selectable before directory refresh, then retires the receipt and isolates organizations", () => {
	const directory: OrganizationSpaceProfileCandidates = {
		organizationId: "org",
		agentProfiles: [],
		members: [
			{
				userId: "owner",
				memberName: "Mira",
				avatarImageUrl: null,
				lastActiveAt: null,
				humanProfile: {
					profileId: "human",
					profileName: "Mira",
					profileHandle: "mira",
					status: "active",
				},
			},
		],
	};
	const agent: SpaceAddMembersCandidateSummary = {
		profileId: "agent",
		profileName: "New helper",
		profileKind: "agent",
		ownerUserId: "owner",
		searchText: "new helper",
	};
	const groups = buildOrganizationDirectoryAddCandidates({
		directory,
		organizationName: "Team",
		snapshot: null,
	});
	const { result, rerender } = renderHook(
		(props) => useCreatedPickerAgents(props),
		{ initialProps: { organizationId: "org", directory, groups } }
	);
	act(() => result.current.onCreated(agent));
	expect(result.current.groups.personGroups[0]?.agentCandidates).toEqual([
		expect.objectContaining({
			profileId: "agent",
			profileName: "New helper",
			ownerHumanProfileId: "human",
			alreadyMember: false,
		}),
	]);
	const refreshed = {
		...groups,
		personGroups: groups.personGroups.map((group) => ({
			...group,
			agentCandidates: [{ ...agent, profileName: "Confirmed directory name" }],
		})),
	};
	rerender({ organizationId: "org", directory, groups: refreshed });
	expect(result.current.groups.personGroups[0]?.agentCandidates).toHaveLength(
		1
	);
	expect(
		result.current.groups.personGroups[0]?.agentCandidates[0]?.profileName
	).toBe("Confirmed directory name");
	rerender({ organizationId: "org", directory, groups });
	expect(result.current.groups.personGroups[0]?.agentCandidates).toEqual([]);
	act(() => result.current.onCreated(agent));
	rerender({ organizationId: "other", directory, groups });
	expect(result.current.groups.personGroups[0]?.agentCandidates).toEqual([]);
});
