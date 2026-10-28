import {
	agentWakeAvailabilityPhaseSchema,
	getAgentExecutionReadinessResponseSchema,
} from "@openmeld/schemas";
import type { ComponentProps } from "react";
import type { AgentProfileSidebarItemComponent } from "../../src/components/agents/agent-profile-sidebar-item";
import type { HumanProfileItem } from "../../src/components/directory/human-profile-item";
import type { SpaceSidebarActiveWakeSummary } from "../../src/components/spaces/space-active-wake-presentation";
import type { AccountSpaceItem } from "../../src/lib/spaces/account-spaces";
import {
	WAKE_PROGRESS_STATUS_PRIORITY,
	type WakeProgressStatusKind,
} from "../../src/lib/spaces/wake-progress-status";
import capturedReadiness from "./readiness.local.json";

// Captured from the fictional local seed, never a production account. Only the
// presentation props below are varied; no API or readiness owner is overridden.
const readiness =
	getAgentExecutionReadinessResponseSchema.parse(capturedReadiness);
const now = Date.parse("2026-09-06T00:00:00Z");
type SpaceScenario = {
	item: AccountSpaceItem;
	routePath: string;
	unreadCount: number;
	isPinPending: boolean;
	activeWakeSummary?: SpaceSidebarActiveWakeSummary;
};
const statusLabels: Record<WakeProgressStatusKind, string> = {
	sending: "Sending request…",
	request_sent: "Waiting to start…",
	connecting: "Connecting…",
	retrying: "Retrying delivery…",
	queued: "Queued",
	working: "Agent is working",
	needs_input: "Agent needs your input",
	confirmation_pending: "Result awaiting confirmation",
	waiting_for_owner: "Waiting for owner",
	waiting_for_controller: "Waiting for current task",
	waiting_for_device: "Waiting for computer",
};
function space(
	name: string,
	pinned: boolean,
	unread: number,
	kind?: WakeProgressStatusKind
): SpaceScenario {
	const id = name.toLowerCase().replaceAll(" ", "-");
	return {
		item: {
			spaceId: id,
			spaceName: name,
			spacePurpose: null,
			organizationId: "preview",
			pinnedAt: pinned ? "2026-09-01T00:00:00Z" : null,
			pinnedProfileIds: pinned ? ["viewer"] : [],
			openProfileId: "viewer",
			openProfileName: "Maya",
			joinedProfiles: [],
			lastJoinedAt: "2026-09-01T00:00:00Z",
			lastSeenTs: now,
			activeAgentCount: null,
			activeHumanCount: null,
			activeMemberCount: null,
			visibility: "private",
		},
		routePath: "/",
		unreadCount: unread,
		isPinPending: false,
		activeWakeSummary: kind
			? {
					spaceId: id,
					activeWakeCount: 1,
					activeTargets: [
						{
							profileId: "preview-agent",
							profileName: "Reviewer",
							activeWakeCount: 1,
						},
					],
					statuses: [
						{
							kind,
							label: statusLabels[kind],
							description: statusLabels[kind],
							status: "active",
						},
					],
				}
			: undefined,
	};
}
export const spaceScenarios: SpaceScenario[] = [
	space("Product planning", false, 0),
	space("Pinned design review", true, 0),
	space("Unread research", false, 3),
	space("Pinned unread feedback", true, 7),
	...Object.keys(WAKE_PROGRESS_STATUS_PRIORITY).flatMap((kind) => [
		space(
			`Pinned · ${statusLabels[kind as WakeProgressStatusKind]}`,
			true,
			0,
			kind as WakeProgressStatusKind
		),
		space(
			statusLabels[kind as WakeProgressStatusKind],
			false,
			0,
			kind as WakeProgressStatusKind
		),
		space(
			`Pinned + unread · ${statusLabels[kind as WakeProgressStatusKind]}`,
			true,
			2,
			kind as WakeProgressStatusKind
		),
	]),
	{
		...space("Newly joined workspace", false, 0),
		item: {
			...space("Newly joined workspace", false, 0).item,
			lastSeenTs: null,
		},
	},
	{ ...space("Saving pin", false, 0), isPinPending: true },
];

spaceScenarios.push({
	...space("Multiple Agents · more tasks", true, 0),
	activeWakeSummary: {
		spaceId: "multiple-agents",
		activeWakeCount: 4,
		hasMore: true,
		activeTargets: [
			{ profileId: "reviewer", profileName: "Reviewer", activeWakeCount: 2 },
			{ profileId: "planner", profileName: "Planner", activeWakeCount: 2 },
		],
		statuses: [
			{
				kind: "working",
				label: "Reviewer is working",
				description: "Working",
				status: "active",
			},
			{
				kind: "needs_input",
				label: "Planner needs your input",
				description: "Input requested",
				status: "pending",
			},
		],
	},
});
spaceScenarios.push({
	...space("Active tasks · names not loaded", false, 0),
	activeWakeSummary: {
		spaceId: "unnamed",
		activeWakeCount: 3,
		activeTargets: [],
	},
});
type PersonScenario = Omit<
	ComponentProps<typeof HumanProfileItem>,
	"index" | "isActive" | "onSelect"
>;
export const peopleScenarios: PersonScenario[] = [
	"connected",
	"needs_attention",
	"checking",
	"unknown",
	"not_connected",
].flatMap((state, index) =>
	[0, 1, 6].map(
		(count): PersonScenario => ({
			activityNowMs: now,
			computerGroup: count
				? {
						isCurrentUser: false,
						ownerLabel: "Preview member",
						ownerUserId: "preview",
						computers: [
							{
								agents: [],
								deviceDisplayName: "Development computer",
								deviceId: "preview",
								deviceType: "laptop",
								isOwnedByCurrentUser: false,
								lastSeenAtMs: now,
								openMeldTools: null,
								osVersion: null,
								ownedComputer: null,
								ownerLabel: "Preview member",
								ownerUserId: "preview",
								platformFamily: "macOS",
								routeId: "preview",
								serviceState: null,
								localAgents: [
									"codex",
									"claude-code",
									"cursor",
									"opencode",
									"grok-build",
									"openclaw",
								]
									.slice(0, count)
									.map((id) => ({
										agentControllerRef: `builtin:${id}`,
										enabled: true,
										status: "ready",
									})),
							},
						],
					}
				: null,
			member: {
				id: `person-${state}-${count}`,
				userId: "preview",
				name: `${["Maya Chen", "Jordan Rivera", "Avery Park", "Sofia Martínez", "Alex Morgan — international research team"][index]} · ${count}`,
				avatarImageUrl: null,
				agentProfiles: [],
				agentProfilesPath: "/",
				canEdit: false,
				details: null,
				email: "preview@example.invalid",
				isCurrentUser: index === 0 && count === 0,
				isDefault: true,
				joinedAt: "2026-09-01T00:00:00Z",
				lastActiveAt:
					count === 0
						? null
						: new Date(now - 3_600_000 * (index + 1)).toISOString(),
				notice: null,
				profileReport: { state: "missing" },
				profileStatus: count === 6 ? "disabled" : "active",
				role: "member",
				computer: {
					count,
					label: state.replaceAll("_", " "),
					path: null,
					state: state as PersonScenario["member"]["computer"]["state"],
				},
				identityAccounts: count
					? [
							{
								accountEmail: "maya@example.invalid",
								accountName: "Maya",
								action: null,
								canDisconnect: false,
								channelsPath: null,
								id: "preview-slack",
								provider: "slack",
								providerLabel: "Slack",
								state: "connected",
							},
						]
					: [],
			},
		})
	)
);

type AgentScenario = Omit<
	ComponentProps<typeof AgentProfileSidebarItemComponent>,
	"index" | "isActive" | "onSelectProfile"
>;
function agent(name: string, index: number): AgentScenario {
	return {
		modelCatalog: null,
		readiness,
		readinessErrorMessage: null,
		readinessIsPending: false,
		operationalContext: null,
		agentControllerRef: [
			"builtin:codex",
			"builtin:claude-code",
			"builtin:cursor",
			"builtin:opencode",
			"custom:gemini",
		][index % 5],
		profile: {
			openMeldProfileId: `agent-${index}`,
			profileName: name,
			ownerUserId: index % 2 ? "teammate" : "viewer",
			ownerName: "Maya",
			profileHandle: `agent-${index}`,
			profileKind: "agent",
			status: "active",
			source: "web_create",
			isDefault: false,
			managedRole: null,
			createdByUserId: "viewer",
			creatorProfileId: null,
			createdAt: "2026-09-01T00:00:00Z",
			updatedAt: "2026-09-01T00:00:00Z",
			lastUsedAt: null,
		},
	};
}
export const agentScenarios: AgentScenario[] =
	agentWakeAvailabilityPhaseSchema.options.map((phase, index) => {
		const item = agent(phase.replaceAll("_", " "), index);
		let category: "available" | "checking" | "offline" | "unavailable" =
			"unavailable";
		if (phase === "available") {
			category = "available";
		} else if (phase.startsWith("checking")) {
			category = "checking";
		} else if (["offline", "service_not_connected"].includes(phase)) {
			category = "offline";
		}
		const availability = {
			...readiness.agentWakeAvailability,
			phase,
			category,
			status: (
				{
					available: "available_for_wake",
					checking: "checking_connection",
					offline: "offline_for_wake",
					unavailable: "unavailable_for_wake",
				} as const
			)[category],
			badgeLabel: phase.replaceAll("_", " "),
			tooltip: `Preview: ${phase.replaceAll("_", " ")}`,
		};
		return {
			...item,
			readiness: {
				...readiness,
				primaryBinding: null,
				agentControllerRef: item.agentControllerRef,
				publicProfileConfiguration: undefined,
				agentWakeAvailability: availability,
			},
		};
	});
for (const [index, status] of [
	"idle",
	"checking",
	"working",
	"paused",
	"attention",
].entries()) {
	const item = agent(`Operational · ${status}`, 30 + index);
	agentScenarios.push({
		...item,
		readiness: agentScenarios[0]?.readiness ?? item.readiness,
		operationalContext: {
			status:
				status === "attention"
					? "paused"
					: (status as "idle" | "checking" | "working" | "paused"),
			currentWorkLocation: "Product planning",
			queuedWorkLocations: ["Design review"],
			waitingCount: 3,
			recoveryAction:
				status === "attention" ? { kind: "continue_interrupted_work" } : null,
		},
	});
}
agentScenarios.push(
	{
		...agent("Checking initial availability", 40),
		readiness: null,
		readinessIsPending: true,
	},
	{
		...agent("Availability request failed", 41),
		readiness: null,
		readinessErrorMessage: "Preview connection failure",
	},
	{ ...agent("Not checked yet", 42), readiness: null },
	{
		...agent("Refresh delayed with previous result", 43),
		readinessErrorMessage: "Preview refresh failed",
	}
);
