import { AGENT_REPLY_FINAL_PURPOSE } from "@openmeld/schemas";
import type {
	GetSpaceStatusResponse,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
	createWakeProgressItem,
	OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
	OPENMELD_WELCOMING_SPACE_PURPOSE,
} from "@openmeld/space";
import { describe, expect, it, vi } from "vitest";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import {
	areWakeProgressItemsEqual,
	createStatusAndMembersRefreshDedupe,
	listPendingWakeProgressClientMessageIds,
	mergeActiveWakeProgressPresentation,
	mergeWakeProgressItemState,
	pollWakeProgress,
	reconcileActiveWakeProgressSnapshot,
	reconcilePolledWakeProgressItems,
	resolveComposerWakeProgressTargetProfileIds,
} from "./use-space-landing-controller-helpers";

vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: vi.fn(),
}));

const createWebSpaceApiMock = vi.mocked(createUnscopedWebSpaceApi);

const AGENT_PROFILE_ID = "agent-profile-1";
const HUMAN_PROFILE_ID = "human-profile-1";

describe("areWakeProgressItemsEqual", () => {
	it("observes every Wake field that changes rendered state or actions", () => {
		const item = createWakeProgressItem({
			clientMessageId: "client-message-1",
			dispatchId: "dispatch-1",
			phase: "running",
			runtimeCoordinatorExecutionId: "execution-1",
			sourceSignalId: "signal-1",
			startedAtMs: 50,
			targetLabel: "Runner",
			targetProfileId: AGENT_PROFILE_ID,
			updatedAtMs: 100,
			waitReasonCode: null,
			sourceContext: {
				messagePreview: "Investigate the queue",
				profileId: HUMAN_PROFILE_ID,
				profileKind: "human",
				profileName: "Mira",
				threadId: null,
			},
		});

		expect(
			areWakeProgressItemsEqual(
				[item],
				[{ ...item, runtimeCoordinatorExecutionId: "execution-2" }]
			)
		).toBe(false);
		expect(
			areWakeProgressItemsEqual([item], [{ ...item, startedAtMs: 60 }])
		).toBe(false);
		expect(
			areWakeProgressItemsEqual(
				[item],
				[
					{
						...item,
						waitReasonCode: "runtime.agent_controller_conversation.occupied",
					},
				]
			)
		).toBe(false);
		expect(
			areWakeProgressItemsEqual(
				[item],
				[
					{
						...item,
						sourceContext: {
							messagePreview: "Investigate the queue",
							profileId: HUMAN_PROFILE_ID,
							profileKind: "human",
							profileName: "Mira",
							threadId: "thread-1",
						},
					},
				]
			)
		).toBe(false);
	});
});

describe("listPendingWakeProgressClientMessageIds", () => {
	it("keeps polling fresh Core running evidence until Core sends a terminal outcome", () => {
		const item = createWakeProgressItem({
			clientMessageId: "client-message-1",
			dispatchId: "dispatch-1",
			phase: "running",
			sourceSignalId: "signal-1",
			targetLabel: "Runner",
			targetProfileId: AGENT_PROFILE_ID,
			updatedAtMs: 7_200_000,
		});

		expect(listPendingWakeProgressClientMessageIds([item], 7_200_100)).toEqual([
			"client-message-1",
		]);
	});

	it("keeps polling request admission until Core sends a terminal outcome", () => {
		const item = createWakeProgressItem({
			clientMessageId: "client-message-1",
			dispatchId: "dispatch-1",
			phase: "request_sent",
			sourceSignalId: "signal-1",
			targetLabel: "Runner",
			targetProfileId: AGENT_PROFILE_ID,
			updatedAtMs: 100,
		});

		expect(listPendingWakeProgressClientMessageIds([item], 480_101)).toEqual([
			"client-message-1",
		]);
	});
});

describe("reconcilePolledWakeProgressItems", () => {
	it("clears successful empty snapshots without clearing a failed poll", () => {
		const completedItem = createWakeProgressItem({
			clientMessageId: "client-message-completed",
			dispatchId: "dispatch-completed",
			phase: "running",
			sourceSignalId: "signal-completed",
			targetLabel: "Runner",
			targetProfileId: AGENT_PROFILE_ID,
			updatedAtMs: 100,
		});
		const unknownItem = createWakeProgressItem({
			clientMessageId: "client-message-unknown",
			dispatchId: "dispatch-unknown",
			phase: "running",
			sourceSignalId: "signal-unknown",
			targetLabel: "Runner",
			targetProfileId: AGENT_PROFILE_ID,
			updatedAtMs: 100,
		});

		expect(
			reconcilePolledWakeProgressItems({
				currentItems: [completedItem, unknownItem],
				fulfilledClientMessageIds: ["client-message-completed"],
				incomingItems: [],
				signals: [],
			})
		).toEqual([unknownItem]);
	});
});

describe("mergeWakeProgressItemState", () => {
	it("applies an interaction request when lifecycle fields keep the same revision", () => {
		const item = createWakeProgressItem({
			clientMessageId: "client-message-1",
			dispatchId: "dispatch-1",
			phase: "running",
			sourceSignalId: "signal-1",
			targetLabel: "Runner",
			targetProfileId: AGENT_PROFILE_ID,
			updatedAtMs: 100,
		});
		const pendingInteraction = {
			canRespond: true,
			expiresAtMs: 28_800_100,
			interactionId: "interaction-1",
			kind: "plan_review" as const,
			requestedAtMs: 100,
			request: {
				allowFeedback: true,
				description: null,
				expiresAtMs: 28_800_100,
				interactionId: "interaction-1",
				kind: "plan_review" as const,
				plan: "Review this implementation plan.",
				requestedAtMs: 100,
				title: "Review the plan",
				v: 1 as const,
			},
		};

		expect(
			mergeWakeProgressItemState({
				currentItems: [item],
				incomingItems: [{ ...item, pendingInteraction }],
				signals: [],
			})
		).toEqual([{ ...item, pendingInteraction }]);
	});

	it("clears a resolved interaction when lifecycle fields keep the same revision", () => {
		const item = {
			...createWakeProgressItem({
				clientMessageId: "client-message-1",
				dispatchId: "dispatch-1",
				phase: "running",
				sourceSignalId: "signal-1",
				targetLabel: "Runner",
				targetProfileId: AGENT_PROFILE_ID,
				updatedAtMs: 100,
			}),
			pendingInteraction: {
				canRespond: false,
				expiresAtMs: 28_800_100,
				interactionId: "interaction-1",
				kind: "plan_review" as const,
				requestedAtMs: 100,
				request: null,
			},
		};
		const { pendingInteraction: _, ...resolvedItem } = item;

		expect(
			mergeWakeProgressItemState({
				currentItems: [item],
				incomingItems: [resolvedItem],
				signals: [],
			})
		).toEqual([resolvedItem]);
	});
});

describe("mergeActiveWakeProgressPresentation", () => {
	it("keeps the authoritative source context when detailed polling advances an item's phase", () => {
		const summary = createWakeProgressItem({
			clientMessageId: "message-qa",
			dispatchId: "dispatch-qa",
			sourceSignalId: "signal-qa",
			targetProfileId: AGENT_PROFILE_ID,
			targetLabel: "Runner",
			phase: "request_sent",
			updatedAtMs: Date.now(),
			sourceContext: {
				profileId: HUMAN_PROFILE_ID,
				profileKind: "human",
				profileName: "Mira",
				messagePreview: "Review this",
				threadId: "thread-qa",
			},
		});
		const detailed = {
			...summary,
			sourceContext: undefined,
			phase: "running" as const,
			updatedAtMs: summary.updatedAtMs + 1,
		};
		expect(
			mergeActiveWakeProgressPresentation({
				summaryItems: [summary],
				detailedItems: [detailed],
				signals: [],
			})
		).toEqual([{ ...detailed, sourceContext: summary.sourceContext }]);
	});
	it("keeps equal-revision Stop enrichment when the summary is merged", () => {
		const nowMs = Date.now();
		const summary = createWakeProgressItem({
			clientMessageId: "client-message-1",
			dispatchId: "dispatch-1",
			phase: "running",
			sourceSignalId: "signal-1",
			targetLabel: "Runner",
			targetProfileId: AGENT_PROFILE_ID,
			updatedAtMs: nowMs,
		});
		const detailed = {
			...summary,
			wakeStopEligibility: {
				controlMode: "cancel" as const,
				reasonCode: null,
				reliability: "native_cancel" as const,
				status: "eligible" as const,
			},
		};

		expect(
			mergeActiveWakeProgressPresentation({
				detailedItems: [detailed],
				signals: [],
				summaryItems: [summary],
			})
		).toEqual([detailed]);
	});

	it("keeps detailed Stop enrichment when a newer summary advances lifecycle fields", () => {
		const nowMs = Date.now();
		const detailed = {
			...createWakeProgressItem({
				clientMessageId: "client-message-1",
				dispatchId: "dispatch-1",
				phase: "running",
				sourceSignalId: "signal-1",
				targetLabel: "Runner",
				targetProfileId: AGENT_PROFILE_ID,
				updatedAtMs: nowMs,
			}),
			wakeStopEligibility: {
				controlMode: "cancel" as const,
				reasonCode: null,
				reliability: "native_cancel" as const,
				status: "eligible" as const,
			},
		};
		const newerSummary = createWakeProgressItem({
			clientMessageId: "client-message-1",
			dispatchId: "dispatch-1",
			phase: "writing",
			sourceSignalId: "signal-1",
			targetLabel: "Runner",
			targetProfileId: AGENT_PROFILE_ID,
			updatedAtMs: nowMs + 1,
		});

		expect(
			mergeActiveWakeProgressPresentation({
				detailedItems: [detailed],
				signals: [],
				summaryItems: [newerSummary],
			})
		).toEqual([
			{
				...newerSummary,
				wakeStopEligibility: detailed.wakeStopEligibility,
			},
		]);
	});

	it("does not inherit Stop enrichment across different dispatches for the same message", () => {
		const nowMs = Date.now();
		const detailed = {
			...createWakeProgressItem({
				clientMessageId: "client-message-1",
				dispatchId: "dispatch-old",
				phase: "running",
				sourceSignalId: "signal-1",
				targetLabel: "Runner",
				targetProfileId: AGENT_PROFILE_ID,
				updatedAtMs: nowMs,
			}),
			wakeStopEligibility: {
				controlMode: "cancel" as const,
				reasonCode: null,
				reliability: "native_cancel" as const,
				status: "eligible" as const,
			},
		};
		const newerSummary = createWakeProgressItem({
			clientMessageId: "client-message-1",
			dispatchId: "dispatch-new",
			phase: "running",
			sourceSignalId: "signal-1",
			targetLabel: "Runner",
			targetProfileId: AGENT_PROFILE_ID,
			updatedAtMs: nowMs + 1,
		});

		expect(
			mergeActiveWakeProgressPresentation({
				detailedItems: [detailed],
				signals: [],
				summaryItems: [newerSummary],
			})
		).toEqual([newerSummary]);
	});

	it("clears a cached summary after its durable final reply arrives", () => {
		const nowMs = Date.now();
		const summary = createWakeProgressItem({
			clientMessageId: "client-message-1",
			dispatchId: "dispatch-1",
			phase: "running",
			sourceSignalId: "signal-1",
			targetLabel: "Runner",
			targetProfileId: AGENT_PROFILE_ID,
			updatedAtMs: nowMs,
		});

		expect(
			mergeActiveWakeProgressPresentation({
				detailedItems: [],
				signals: [
					{
						v: 1,
						id: "signal-final-1",
						spaceId: "space-123",
						ts: nowMs + 100,
						profile: {
							kind: "agent",
							profileId: AGENT_PROFILE_ID,
							profileName: "Runner",
						},
						type: "signal.text",
						data: {
							text: "Done.",
							meta: {
								dispatchId: "dispatch-1",
								purpose: AGENT_REPLY_FINAL_PURPOSE,
								targetProfileId: AGENT_PROFILE_ID,
							},
						},
					},
				],
				summaryItems: [summary],
			})
		).toEqual([]);
	});
});

describe("reconcileActiveWakeProgressSnapshot", () => {
	it("clears cached presentation items absent from an authoritative active snapshot", () => {
		const cached = createWakeProgressItem({
			clientMessageId: "client-message-stale",
			dispatchId: "dispatch-stale",
			phase: "sending",
			sourceSignalId: "signal-stale",
			targetLabel: "Runner",
			targetProfileId: AGENT_PROFILE_ID,
			updatedAtMs: 100,
		});

		expect(
			reconcileActiveWakeProgressSnapshot({
				currentItems: [cached],
				incomingItems: [],
				signals: [],
				snapshotItemsAtRequestStart: [cached],
			})
		).toEqual([]);
	});

	it("retains a live item that arrived after the active snapshot started", () => {
		const requestStartItem = createWakeProgressItem({
			clientMessageId: "client-message-live",
			dispatchId: "dispatch-live",
			phase: "request_sent",
			sourceSignalId: "signal-live",
			targetLabel: "Runner",
			targetProfileId: AGENT_PROFILE_ID,
			updatedAtMs: 100,
		});
		const live = createWakeProgressItem({
			clientMessageId: "client-message-live",
			dispatchId: "dispatch-live",
			phase: "running",
			sourceSignalId: "signal-live",
			targetLabel: "Runner",
			targetProfileId: AGENT_PROFILE_ID,
			updatedAtMs: 201,
		});

		expect(
			reconcileActiveWakeProgressSnapshot({
				currentItems: [live],
				incomingItems: [],
				signals: [],
				snapshotItemsAtRequestStart: [requestStartItem],
			})
		).toEqual([live]);
	});
});

function createStatus(
	overrides: Partial<GetSpaceStatusResponse> = {}
): GetSpaceStatusResponse {
	return {
		spaceId: "space-123",
		generatedAt: "2026-07-06T00:00:00.000Z",
		name: "Direct Message",
		accessMode: "protected",
		passwordProtected: false,
		dispatchPolicy: {
			mode: "mention_only",
		},
		publicationMode: "collaboration",
		allowedActions: ["post_message", "post_status", "stay_silent"],
		resultArchivePolicy: {
			mode: "all_final_results",
		},
		entryBrief: "default",
		dispatchBrief: "default",
		members: {
			totalCount: 2,
			humanCount: 1,
			agentCount: 1,
			liveNowCount: 1,
			liveHumanCount: 1,
			liveAgentCount: 0,
		},
		...overrides,
	};
}

function createMembersSnapshot(input?: {
	agentProfileIds?: string[];
	humanProfileId?: string;
}): SpaceMembersSnapshot {
	return {
		humans: [
			{
				profileId: input?.humanProfileId ?? HUMAN_PROFILE_ID,
				status: "active",
			},
		],
		agents: (input?.agentProfileIds ?? [AGENT_PROFILE_ID]).map((profileId) => ({
			profileId,
			status: "active",
		})),
	} as SpaceMembersSnapshot;
}

describe("pollWakeProgress", () => {
	it("opts Web wake progress polling into Wake Stop eligibility", async () => {
		const getWakeProgress = vi.fn().mockResolvedValue({ items: [] });
		const onItems = vi.fn();
		createWebSpaceApiMock.mockReturnValue({
			getWakeProgress,
		} as unknown as ReturnType<typeof createUnscopedWebSpaceApi>);

		await pollWakeProgress({
			openMeldProfileId: "human-profile-1",
			clientMessageIds: ["client-message-1"],
			onItems,
			onSettled: vi.fn(),
			spaceId: "space-123",
		});

		expect(getWakeProgress).toHaveBeenCalledWith({
			clientMessageId: "client-message-1",
			includePreviewText: true,
			includeTiming: true,
			includeSourceContext: true,
			includeWaitReason: true,
			includeDeviceWait: true,
			includeWakeStopEligibility: true,
			spaceId: "space-123",
			timeoutMs: 15_000,
		});
		expect(onItems).toHaveBeenCalledWith([], ["client-message-1"]);
	});

	it("reports only successful snapshots when one progress request fails", async () => {
		const getWakeProgress = vi
			.fn()
			.mockResolvedValueOnce({ items: [] })
			.mockRejectedValueOnce(new Error("network unavailable"));
		const onItems = vi.fn();
		createWebSpaceApiMock.mockReturnValue({
			getWakeProgress,
		} as unknown as ReturnType<typeof createUnscopedWebSpaceApi>);

		await pollWakeProgress({
			openMeldProfileId: "human-profile-1",
			clientMessageIds: ["client-message-completed", "client-message-unknown"],
			onItems,
			onSettled: vi.fn(),
			spaceId: "space-123",
		});

		expect(onItems).toHaveBeenCalledWith([], ["client-message-completed"]);
	});
});

describe("createStatusAndMembersRefreshDedupe", () => {
	it("shares one status and members refresh while a refresh is already in flight", async () => {
		const statusRefreshResolvers: Array<() => void> = [];
		const statusRefetch = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					statusRefreshResolvers.push(resolve);
				})
		);
		const membersRefetch = vi.fn().mockResolvedValue(undefined);
		const refresh = createStatusAndMembersRefreshDedupe();

		const firstRefresh = refresh({ membersRefetch, statusRefetch });
		const secondRefresh = refresh({ membersRefetch, statusRefetch });

		expect(statusRefetch).toHaveBeenCalledTimes(1);
		expect(membersRefetch).toHaveBeenCalledTimes(1);
		statusRefreshResolvers.shift()?.();
		await Promise.all([firstRefresh, secondRefresh]);

		const thirdRefresh = refresh({ membersRefetch, statusRefetch });
		expect(statusRefetch).toHaveBeenCalledTimes(2);
		expect(membersRefetch).toHaveBeenCalledTimes(2);
		statusRefreshResolvers.shift()?.();
		await thirdRefresh;
	});
});

describe("resolveComposerWakeProgressTargetProfileIds", () => {
	it("uses explicit wake targets before deriving a Direct Message target", () => {
		expect(
			resolveComposerWakeProgressTargetProfileIds({
				explicitActivationTargets: [" agent-a ", "agent-a", "agent-b"],
				membersSnapshot: createMembersSnapshot(),
				senderProfileId: HUMAN_PROFILE_ID,
				status: createStatus(),
			})
		).toEqual(["agent-a", "agent-b"]);
	});

	it("derives the agent target for a one-human one-agent Direct Message", () => {
		expect(
			resolveComposerWakeProgressTargetProfileIds({
				explicitActivationTargets: [],
				membersSnapshot: createMembersSnapshot(),
				senderProfileId: HUMAN_PROFILE_ID,
				status: createStatus({
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
			})
		).toEqual([AGENT_PROFILE_ID]);
	});

	it("does not derive the agent target for a legacy Welcoming Space", () => {
		expect(
			resolveComposerWakeProgressTargetProfileIds({
				explicitActivationTargets: [],
				membersSnapshot: createMembersSnapshot(),
				senderProfileId: HUMAN_PROFILE_ID,
				status: createStatus({
					spacePurpose: OPENMELD_WELCOMING_SPACE_PURPOSE,
				}),
			})
		).toEqual([]);
	});

	it("does not derive a target for ordinary two-member spaces", () => {
		expect(
			resolveComposerWakeProgressTargetProfileIds({
				explicitActivationTargets: [],
				membersSnapshot: createMembersSnapshot(),
				senderProfileId: HUMAN_PROFILE_ID,
				status: createStatus(),
			})
		).toEqual([]);
	});

	it("does not derive a target after the Direct Message has degraded", () => {
		expect(
			resolveComposerWakeProgressTargetProfileIds({
				explicitActivationTargets: [],
				membersSnapshot: createMembersSnapshot({
					agentProfileIds: [AGENT_PROFILE_ID, "agent-profile-2"],
				}),
				senderProfileId: HUMAN_PROFILE_ID,
				status: createStatus({
					members: {
						totalCount: 3,
						humanCount: 1,
						agentCount: 2,
						liveNowCount: 1,
						liveHumanCount: 1,
						liveAgentCount: 0,
					},
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
			})
		).toEqual([]);
	});

	it("does not derive a target when the sender is not the active human", () => {
		expect(
			resolveComposerWakeProgressTargetProfileIds({
				explicitActivationTargets: [],
				membersSnapshot: createMembersSnapshot(),
				senderProfileId: AGENT_PROFILE_ID,
				status: createStatus({
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
			})
		).toEqual([]);
	});
});
