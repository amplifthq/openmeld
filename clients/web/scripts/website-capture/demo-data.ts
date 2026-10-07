import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/agent-runtime";
import {
	organizationSkillSchema,
	routineManagementSchema,
} from "@openmeld/schemas";
import { useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
	fixtureSpace,
	useConversationSidebarFixture,
} from "../../src/test-support/conversation-sidebar-fixture";

export const spaceNames = [
	"Launch room",
	"Customer research",
	"Website refresh",
];
const ids = ["release", "research", "website"];
const memberPreviews = [
	{
		profileId: "maya",
		profileName: "Maya Chen",
		profileKind: "human" as const,
		agentControllerRef: null,
	},
	{
		profileId: "james",
		profileName: "James Lee",
		profileKind: "human" as const,
		agentControllerRef: null,
	},
	{
		profileId: "center",
		profileName: "Center Agent",
		profileKind: "agent" as const,
		agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
	},
	{
		profileId: "claude",
		profileName: "Claude Code",
		profileKind: "agent" as const,
		agentControllerRef: "builtin:claude-code",
	},
];
export const demoSpaces = spaceNames.map((name, index) => ({
	...fixtureSpace(ids[index], name, index === 0),
	memberPreviews,
	activeMemberCount: 4,
	activeHumanCount: 2,
	activeAgentCount: 2,
}));
export function useDemoConversations() {
	const fixture = useConversationSidebarFixture();
	const [pinned, setPinned] = useState(new Set(["release"]));
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	return {
		...fixture,
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
const timestamp = Date.UTC(2026, 9, 9, 16);
let routine = routineManagementSchema.parse({
	id: "weekly-review",
	organizationId: "org",
	name: "Weekly project review",
	instructions:
		"Read the launch brief and this week’s updates. Summarize what is ready, flag open decisions, and post the report to Launch room.",
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
export const listCurrentRoutines = async () => ({
	organizationId: "org",
	currentUserId: "preview",
	routines: [routine],
	executors: [
		{ agentProfileId: null, kind: "center_agent", name: "Center Agent" },
	],
});
export const listCurrentRoutineTargetSpaces = async () => ({
	organizationId: "org",
	spaces: [{ kind: "space", name: "Launch room", spaceId: "release" }],
});
export const listCurrentRoutineRuns = async () => ({
	organizationId: "org",
	routineId: routine.id,
	runs: [
		{
			...routine.lastRun,
			organizationId: "org",
			routineId: routine.id,
			destinationKind: "space",
			targetSpaceId: "release",
			nativeDeliveryId: "demo",
			slackChannelId: null,
			slackConversationId: null,
			slackTeamId: null,
			slackThreadLabel: null,
			slackThreadTs: null,
		},
	],
});
export const pauseCurrentRoutine = () => {
	routine = { ...routine, status: "paused" };
	return Promise.resolve({ routine });
};
export const resumeCurrentRoutine = () => {
	routine = { ...routine, status: "enabled" };
	return Promise.resolve({ routine });
};
export const updateCurrentRoutine = (input: Record<string, unknown>) => {
	routine = routineManagementSchema.parse({
		...routine,
		...Object.fromEntries(
			Object.entries(input).filter(
				([key]) => !["routineId", "organizationId"].includes(key)
			)
		),
	});
	return Promise.resolve({ routine });
};
export const createCurrentRoutine = () => {
	return Promise.reject(
		new Error(
			"This demo includes one example routine. You can edit it or inspect its run history."
		)
	);
};
export const deleteCurrentRoutine = () => {
	return Promise.reject(
		new Error("The example routine stays available for this demo.")
	);
};
export const resolveRoutineErrorMessage = (error: Error) => error.message;

const skillInstructions =
	"# Release writing\n\nLead with what changed for the customer.\n\n## Before you write\nRead the launch brief and the changes that shipped. Keep draft work out of published notes.\n\n## Write the release\nUse a short title. Show one useful example. Link to the setup guide.\n\n## Review\nCheck every feature claim against the shipped behavior.";
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
export const demoDirectory = {
	organizationId: "org",
	members: [],
	agentProfiles: [],
};
