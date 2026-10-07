import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/agent-runtime";
import {
	createSpaceMemberAgentSnapshot,
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { demoHumanAvatars } from "./demo-avatars";

export const DEMO_HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
export const DEMO_CENTER_PROFILE_ID =
	"agt_33333333-3333-4333-8333-333333333333";
export const DEMO_CLAUDE_PROFILE_ID =
	"agt_44444444-4444-4444-8444-444444444444";
export const DEMO_CODEX_PROFILE_ID = "agt_55555555-5555-4555-8555-555555555555";

export function buildDemoSpaceMembers(spaceId: string) {
	return createSpaceMembersSnapshot({
		spaceId,
		humans: [
			{
				...createSpaceMemberHumanSnapshot({
					profileId: DEMO_HUMAN_PROFILE_ID,
					profileName: "Maya Chen",
					ownerUserId: "preview",
					liveNow: true,
				}),
				avatarUrl: demoHumanAvatars["Maya Chen"],
			},
			{
				...createSpaceMemberHumanSnapshot({
					profileId: "22222222-2222-4222-8222-222222222222",
					profileName: "James Lee",
					ownerUserId: "james",
					liveNow: true,
				}),
				avatarUrl: demoHumanAvatars["James Lee"],
			},
		],
		agents: [
			createSpaceMemberAgentSnapshot({
				profileId: DEMO_CENTER_PROFILE_ID,
				profileName: "Center Agent",
				ownerName: "Amplift",
				ownerUserId: null,
				agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
				avatarStyle: "star",
				addedByDisplayName: "Maya Chen",
			}),
			createSpaceMemberAgentSnapshot({
				profileId: DEMO_CLAUDE_PROFILE_ID,
				profileName: "Claude Code",
				ownerName: "Maya Chen",
				ownerUserId: "preview",
				agentControllerRef: "builtin:claude-code",
				addedByDisplayName: "Maya Chen",
			}),
			createSpaceMemberAgentSnapshot({
				profileId: DEMO_CODEX_PROFILE_ID,
				profileName: "Codex",
				ownerName: "James Lee",
				ownerUserId: "james",
				agentControllerRef: "builtin:codex",
				addedByDisplayName: "Maya Chen",
			}),
		],
	});
}
