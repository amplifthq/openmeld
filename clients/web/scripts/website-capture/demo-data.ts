import {
	organizationProfileDirectoryResponseSchema,
	organizationSkillSchema,
	routineManagementSchema,
} from "@openmeld/schemas";
import type { AuthProfileView } from "@openmeld/schemas/types";
import { useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
	fixtureSpace,
	useConversationSidebarFixture,
} from "../../src/test-support/conversation-sidebar-fixture";
import { demoHumanAvatars } from "./demo-avatars";
import { DEMO_PRIMARY_SPACE_NAME } from "./demo-conversation-content";
import { useDemoConversationState } from "./demo-conversation-state";
import {
	buildDemoSpaceMembers,
	DEMO_CLAUDE_PROFILE_ID,
	DEMO_CODEX_PROFILE_ID,
} from "./demo-members";

export const demoAgentProfiles: AuthProfileView[] = [
	"Codex",
	"Claude Code",
].map((name, index) => ({
	openMeldProfileId: index ? DEMO_CLAUDE_PROFILE_ID : DEMO_CODEX_PROFILE_ID,
	profileName: name,
	profileKind: "agent",
	profileHandle: index ? "claude" : "codex",
	ownerName: index ? "Maya Chen" : "James Lee",
	ownerUserId: index ? "preview" : "james",
	createdByUserId: index ? "preview" : "james",
	creatorProfileId: null,
	isDefault: false,
	lastUsedAt: null,
	managedRole: null,
	source: "web_create",
	status: "active",
	createdAt: "2026-10-01T00:00:00.000Z",
	updatedAt: "2026-10-01T00:00:00.000Z",
}));

export const spaceNames = [
	DEMO_PRIMARY_SPACE_NAME,
	"Customer research",
	"Website refresh",
];
const ids = ["release", "research", "website"];
const members = buildDemoSpaceMembers("release");
const memberPreviews = [
	...members.humans.map((member) => ({
		profileId: member.profileId,
		profileName: member.profileName,
		profileKind: "human" as const,
		agentControllerRef: null,
	})),
	...members.agents.map((member) => ({
		profileId: member.profileId,
		profileName: member.profileName,
		profileKind: "agent" as const,
		agentControllerRef: member.agentControllerRef,
	})),
];
export const demoSpaces = spaceNames.map((name, index) => ({
	...fixtureSpace(ids[index], name, index === 0),
	memberPreviews,
	activeMemberCount: 5,
	activeHumanCount: 2,
	activeAgentCount: 3,
}));
export function useDemoConversations() {
	const fixture = useConversationSidebarFixture();
	const { activeWakeSummaryBySpaceId } = useDemoConversationState();
	const [pinned, setPinned] = useState(new Set(["release"]));
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	return {
		...fixture,
		directMessages: {
			...fixture.directMessages,
			directory: { ...fixture.directMessages.directory, data: demoDirectory },
			indicators: {
				...fixture.directMessages.indicators,
				activeWakeSummaryBySpaceId,
			},
		},
		owner: (item: { spaceId: string }) =>
			pinned.has(item.spaceId) ? "pinned" : "spaces",
		move: async (section: string, id: string) =>
			setPinned((current) => {
				const next = new Set(current);
				if (section === "pinned") {
					next.add(id);
				} else {
					next.delete(id);
				}
				return next;
			}),
		unpin: async (item: { spaceId: string }) =>
			setPinned((current) => {
				const next = new Set(current);
				next.delete(item.spaceId);
				return next;
			}),
		selected: pathname.split("/").at(-1),
		conversations: demoSpaces.map((item) => ({
			kind: "space" as const,
			item: {
				...item,
				pinnedAt: pinned.has(item.spaceId) ? "2026-10-01" : null,
			},
			spaceId: item.spaceId,
			title: item.spaceName,
			activity: 100,
			profileId: "human",
			url: `/o/test/spaces/${item.spaceId}`,
		})),
	};
}
export function useDemoSidebarPreferences() {
	const [preferences, save] = useState({
		pinned: { sort: "manual", spaceIds: ["release"] },
		spaces: { sort: "priority", spaceIds: [] },
		groups: [],
	});
	return {
		preferences,
		save,
		saveAsync: async (value: typeof preferences) => save(value),
		disabled: false,
		isPending: false,
		isError: false,
		retry: () => undefined,
	};
}
const timestamp = Date.UTC(2026, 9, 2, 16);
const routine = routineManagementSchema.parse({
	id: "weekly-review",
	organizationId: "org",
	name: "Weekly project review",
	instructions: `Review this week’s checkout changes. Summarize the fix, test results, and open decisions. Post the report to ${DEMO_PRIMARY_SPACE_NAME}.`,
	canManage: true,
	createdByUserId: "preview",
	updatedByUserId: "preview",
	createdAtMs: timestamp - 604_800_000,
	updatedAtMs: timestamp - 604_800_000,
	cronExpression: "0 9 * * 5",
	timezone: "America/Los_Angeles",
	targetSpaceId: "release",
	nextDueAt: timestamp + 604_800_000,
	status: "enabled",
	lastRun: {
		id: "run-1",
		status: "completed",
		scheduledFor: timestamp,
		startedAtMs: timestamp,
		finishedAtMs: timestamp + 120_000,
		publishedSignalId: "report",
		failureCode: null,
		failureDetail: null,
	},
	capabilityState: {
		approvedKnowledge: true,
		canRepair: false,
		externalActionPolicy: "read_only",
		slackChannelReport: false,
	},
	creationAttribution: { displayName: "Maya Chen" },
	scope: "team",
	agentProfileId: null,
	executorKind: "center_agent",
	executorName: "Center Agent",
});
let routines = [
	routine,
	routineManagementSchema.parse({
		...routine,
		id: "customer-digest",
		name: "Customer feedback digest",
		instructions:
			"Read the customer interview notes. Group recurring requests and post a short digest to Customer research.",
		cronExpression: "0 8 * * *",
		targetSpaceId: "research",
		nextDueAt: Date.UTC(2026, 9, 8, 15),
		lastRun: {
			...routine.lastRun,
			id: "digest-1",
			scheduledFor: Date.UTC(2026, 9, 7, 15),
			startedAtMs: Date.UTC(2026, 9, 7, 15),
			finishedAtMs: Date.UTC(2026, 9, 7, 15, 2),
		},
	}),
	routineManagementSchema.parse({
		...routine,
		id: "website-check",
		name: "Website launch check",
		instructions:
			"Review the website launch checklist and flag anything that needs a decision. Post the summary to Website refresh.",
		cronExpression: "0 10 * * 3",
		targetSpaceId: "website",
		nextDueAt: Date.UTC(2026, 9, 14, 17),
		lastRun: {
			...routine.lastRun,
			id: "website-1",
			scheduledFor: Date.UTC(2026, 9, 7, 17),
			startedAtMs: Date.UTC(2026, 9, 7, 17),
			finishedAtMs: Date.UTC(2026, 9, 7, 17, 2),
		},
	}),
];
export const listCurrentRoutines = async () => ({
	organizationId: "org",
	currentUserId: "preview",
	routines,
	executors: [
		{ agentProfileId: null, kind: "center_agent", name: "Center Agent" },
	],
});
export const listCurrentRoutineTargetSpaces = async () => ({
	organizationId: "org",
	spaces: spaceNames.map((name, index) => ({
		kind: "space",
		name,
		spaceId: ids[index],
	})),
});
export const listCurrentRoutineRuns = (input: { routineId: string }) => {
	const selected = routines.find((item) => item.id === input.routineId);
	if (!selected?.lastRun) {
		return Promise.reject(new Error("This sample Routine has no run history."));
	}
	const lastRun = selected.lastRun;
	const interval = selected.id === "customer-digest" ? 86_400_000 : 604_800_000;
	return Promise.resolve({
		organizationId: "org",
		routineId: input.routineId,
		runs: [0, 1, 2].map((index) => {
			const scheduledFor = lastRun.scheduledFor - index * interval;
			return {
				...lastRun,
				id: `${selected.id}-run-${index + 1}`,
				scheduledFor,
				startedAtMs: scheduledFor,
				finishedAtMs: scheduledFor + 120_000,
				organizationId: "org",
				routineId: input.routineId,
				destinationKind: "space",
				targetSpaceId: selected.targetSpaceId,
				nativeDeliveryId: "demo",
				slackChannelId: null,
				slackConversationId: null,
				slackTeamId: null,
				slackThreadLabel: null,
				slackThreadTs: null,
			};
		}),
	});
};
export const pauseCurrentRoutine = (input: { routineId: string }) =>
	updateCurrentRoutine({ ...input, status: "paused" });
export const resumeCurrentRoutine = (input: { routineId: string }) =>
	updateCurrentRoutine({ ...input, status: "enabled" });
export const updateCurrentRoutine = (input: Record<string, unknown>) => {
	const current = routines.find((item) => item.id === input.routineId);
	if (!current) {
		return Promise.reject(new Error("Routine not found in this demo."));
	}
	const updated = routineManagementSchema.parse({
		...current,
		...Object.fromEntries(
			Object.entries(input).filter(
				([key]) => !["routineId", "organizationId"].includes(key)
			)
		),
	});
	routines = routines.map((item) => (item.id === updated.id ? updated : item));
	return Promise.resolve({ routine: updated });
};
export const createCurrentRoutine = () => {
	return Promise.reject(
		new Error("You can explore the example routines and their run history.")
	);
};
export const deleteCurrentRoutine = () => {
	return Promise.reject(
		new Error("The example routine stays available for this demo.")
	);
};
export const resolveRoutineErrorMessage = (error: Error) => error.message;

const skillInstructions =
	"Lead with what changed for the customer.\n\n## Write\nRead the launch brief. Use a short title, one useful example, and a link to the setup guide.\n\n## Review\nCheck each claim against the shipped behavior. Leave draft work out of published notes.";
const example =
	"## Faster setup\nCreate a project and invite your team from one place.\n";
const release = {
	id: "release-v1",
	createdAt: "2026-10-01T09:00:00.000Z",
	createdByUserId: "preview",
	digest: "a".repeat(64),
	source: { kind: "created" },
};
export const demoSkill = organizationSkillSchema.parse({
	id: "release-writing",
	organizationId: "org",
	name: "release-writing",
	description: "Write release notes from the changes that actually shipped.",
	enabled: true,
	version: 1,
	createdAt: release.createdAt,
	updatedAt: release.createdAt,
	source: { kind: "created" },
	permissions: { canEdit: false, canManage: false },
	activeRelease: release,
	releases: [release],
	maintainerUserIds: ["preview"],
	bundle: {
		portable: {
			name: "release-writing",
			description:
				"Write release notes from the changes that actually shipped.",
			allowedTools: null,
			compatibility: null,
			license: null,
			metadata: {},
		},
		instructions: skillInstructions,
		files: [
			{
				path: "examples/release.md",
				content: example,
				encoding: "utf8",
				mediaType: "text/markdown",
				size: new TextEncoder().encode(example).byteLength,
			},
		],
	},
});
export const demoSkills = [
	demoSkill,
	organizationSkillSchema.parse({
		...demoSkill,
		id: "customer-research",
		name: "customer-research",
		description: "Turn interview notes into findings your team can act on.",
		bundle: {
			...demoSkill.bundle,
			portable: {
				...demoSkill.bundle.portable,
				name: "customer-research",
				description: "Turn interview notes into findings your team can act on.",
			},
			instructions:
				"# Customer research\n\nRead every interview before grouping findings.\n\n## Find the pattern\nGroup repeated requests. Include direct evidence and count the interviews behind each theme.\n\n## Share the result\nSeparate observations from suggestions. List open questions for the next interview.",
		},
	}),
	organizationSkillSchema.parse({
		...demoSkill,
		id: "launch-review",
		name: "launch-review",
		description:
			"Check the launch brief, setup guide, and final release notes.",
		bundle: {
			...demoSkill.bundle,
			portable: {
				...demoSkill.bundle.portable,
				name: "launch-review",
				description:
					"Check the launch brief, setup guide, and final release notes.",
			},
			instructions:
				"# Launch review\n\nRead the launch checklist and verify each customer claim.\n\n## Check the work\nOpen the setup guide. Check its commands against the shipped behavior.\n\n## Report\nList what is ready, what is blocked, and who needs to decide.",
		},
	}),
];
export const demoDirectory = organizationProfileDirectoryResponseSchema.parse({
	organizationId: "org",
	generatedAt: "2026-10-07T10:00:00.000Z",
	members: [
		["Maya Chen", "11111111-1111-4111-8111-111111111111", "preview"],
		["James Lee", "22222222-2222-4222-8222-222222222222", "james"],
		["Alex Kim", "66666666-6666-4666-8666-666666666666", "alex"],
	].map(([name, profileId, userId]) => ({
		userId,
		memberId: `${userId}-member`,
		organizationId: "org",
		joinedAt: "2026-10-01T10:00:00.000Z",
		role: "member",
		user: {
			id: userId,
			name,
			image: demoHumanAvatars[name],
			email: `${userId}@example.com`,
		},
		humanProfile: {
			profileId,
			profileName: name,
			profileHandle: userId,
			status: "active",
		},
	})),
	agentProfiles: [],
});
