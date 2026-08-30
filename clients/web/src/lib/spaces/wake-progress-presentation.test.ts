import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import type { WakeProgressItem } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import type { SpaceTimelineItem } from "./timeline";
import type { WakeFailureTargetContext } from "./wake-failure-display";
import {
	buildWakeProblemSourceSignalIds,
	resolveSpaceMessageWakeProgressFallbackEntries,
	resolveSpaceMessageWakeProgressState,
} from "./wake-progress-presentation";
import {
	buildSpaceWakeOutcomeIndex,
	type SpaceWakeStopTargetResolution,
} from "./wake-stop-target";

const TARGET_PROFILE_ID = "agt_22222222-2222-2222-2222-222222222222";
const SECOND_TARGET_PROFILE_ID = "agt_33333333-3333-3333-3333-333333333333";

describe("resolveSpaceMessageWakeProgressState", () => {
	it("shows queued work plainly under the source message", () => {
		const state = resolveSpaceMessageWakeProgressState({
			item: createTimelineItem(),
			items: [
				createWakeProgressItem({
					message: "Wake for @runner is queued.",
					phase: "queued",
					updatedAtMs: 1,
				}),
			],
		});

		expect(state.thinkingEntries).toEqual([
			expect.objectContaining({ text: "Wake is queued" }),
		]);
	});

	it("uses Wake detail steps for non-terminal source message thinking copy", () => {
		const state = resolveSpaceMessageWakeProgressState({
			item: createTimelineItem(),
			items: [
				createWakeProgressItem({
					message: "@runner is working on this computer...",
					phase: "running",
					startedAtMs: 1,
					updatedAtMs: 60_001,
				}),
			],
		});

		expect(state.hasProblem).toBe(false);
		expect(state.thinkingEntries).toEqual([
			expect.objectContaining({
				elapsedStartedAtMs: 1,
				text: "Agent is working",
			}),
		]);
		expect(state.issueEntries).toEqual([]);
	});

	it("uses finalizing copy when a Wake is publishing a completed reply", () => {
		const state = resolveSpaceMessageWakeProgressState({
			item: createTimelineItem(),
			items: [
				createWakeProgressItem({
					message: "Posting final message for @runner...",
					phase: "publishing",
					updatedAtMs: 1,
				}),
			],
		});

		expect(state.thinkingEntries).toEqual([
			expect.objectContaining({
				elapsedStartedAtMs: null,
				text: "Finalizing reply",
			}),
		]);
		expect(state.thinkingEntries[0]?.text).not.toBe("Agent is working");
	});

	it("shows an outcome-unknown publication as a problem without a retry spinner", () => {
		const state = resolveSpaceMessageWakeProgressState({
			item: createTimelineItem(),
			items: [
				createWakeProgressItem({
					failureReasonCode:
						"remote_agent.callback_publication_outcome_unknown",
					message:
						"OpenMeld could not confirm whether the final reply was posted for @runner.",
					phase: "publication_unknown",
					updatedAtMs: 1,
				}),
			],
		});

		expect(state.hasProblem).toBe(true);
		expect(state.thinkingEntries).toEqual([]);
		expect(state.issueEntries).toEqual([
			expect.objectContaining({
				body: expect.stringContaining(
					"could not confirm whether the final reply was posted"
				),
			}),
		]);
	});

	it("presents transient output preview text as preview activity", () => {
		const state = resolveSpaceMessageWakeProgressState({
			item: createTimelineItem(),
			items: [
				createWakeProgressItem({
					message: "I’m checking the release configuration now.",
					phase: "writing",
					updatedAtMs: 1,
				}),
			],
		});

		expect(state.thinkingEntries).toEqual([
			expect.objectContaining({
				elapsedStartedAtMs: null,
				kind: "preview",
				text: "I’m checking the release configuration now.",
			}),
		]);
	});

	it("shows a fallback progress entry when only the Stop control is available", () => {
		const entries = resolveSpaceMessageWakeProgressFallbackEntries({
			item: createTimelineItem({
				wakeClientMessageId: null,
			}),
			wakeStopTargets: [
				createWakeStopTarget({
					clientMessageId: null,
					sourceSignalId: "sig-source",
					status: "active",
				}),
			],
		});

		expect(entries).toEqual([
			expect.objectContaining({
				elapsedStartedAtMs: null,
				targetProfileId: TARGET_PROFILE_ID,
				text: "Starting Wake",
			}),
		]);
	});

	it("does not attach elapsed working time when the source Wake targets multiple agents", () => {
		const state = resolveSpaceMessageWakeProgressState({
			item: createTimelineItem({
				wakeTargetProfileIds: [TARGET_PROFILE_ID, SECOND_TARGET_PROFILE_ID],
			}),
			items: [
				createWakeProgressItem({
					message: "@runner is working on this computer...",
					phase: "running",
					targetProfileId: TARGET_PROFILE_ID,
					updatedAtMs: 1,
				}),
				createWakeProgressItem({
					message: "@codex is working on this computer...",
					phase: "running",
					targetLabel: "@codex",
					targetProfileId: SECOND_TARGET_PROFILE_ID,
					updatedAtMs: 2,
				}),
			],
		});

		expect(state.thinkingEntries).toEqual([
			expect.objectContaining({
				elapsedStartedAtMs: null,
				targetProfileId: TARGET_PROFILE_ID,
				text: "Agent is working",
			}),
			expect.objectContaining({
				elapsedStartedAtMs: null,
				targetProfileId: SECOND_TARGET_PROFILE_ID,
				text: "Agent is working",
			}),
		]);
	});

	it("matches active Wake progress by source signal when the source message has no client message id", () => {
		const state = resolveSpaceMessageWakeProgressState({
			item: createTimelineItem({
				wakeClientMessageId: null,
			}),
			items: [
				createWakeProgressItem({
					clientMessageId: "active-client-message-1",
					message: "@runner is working on this computer...",
					phase: "running",
					sourceSignalId: "sig-source",
					updatedAtMs: 1,
				}),
			],
		});

		expect(state.hasProblem).toBe(false);
		expect(state.thinkingEntries).toEqual([
			expect.objectContaining({
				text: "Agent is working",
			}),
		]);
		expect(state.issueEntries).toEqual([]);
	});

	it("derives a Direct Message automatic Wake target from matching active progress", () => {
		const state = resolveSpaceMessageWakeProgressState({
			item: createTimelineItem({
				text: "hi",
				wakeClientMessageId: null,
				wakeSourceSignalId: null,
				wakeTargetProfileIds: [],
			}),
			items: [
				createWakeProgressItem({
					clientMessageId: "dm-auto-client-message-1",
					message: "Mimo is working on this computer...",
					phase: "running",
					sourceSignalId: "sig-source",
					updatedAtMs: 1,
				}),
			],
		});

		expect(state.hasProblem).toBe(false);
		expect(state.thinkingEntries).toEqual([
			expect.objectContaining({
				elapsedStartedAtMs: 1,
				targetProfileId: TARGET_PROFILE_ID,
				text: "Agent is working",
			}),
		]);
		expect(state.issueEntries).toEqual([]);
	});

	it("does not match a different Wake by client message id when the source message has no client message id", () => {
		const state = resolveSpaceMessageWakeProgressState({
			item: createTimelineItem({
				wakeClientMessageId: null,
				wakeSourceSignalId: null,
				wakeTargetProfileIds: [],
			}),
			items: [
				createWakeProgressItem({
					clientMessageId: "client-message-1",
					message: "@runner is working on this computer...",
					phase: "running",
					sourceSignalId: "sig-other",
					updatedAtMs: 1,
				}),
			],
		});

		expect(state.hasProblem).toBe(false);
		expect(state.thinkingEntries).toEqual([]);
		expect(state.issueEntries).toEqual([]);
	});

	it("does not render a replied Wake outcome after progress becomes terminal", () => {
		const state = resolveSpaceMessageWakeProgressState({
			item: createTimelineItem(),
			items: [
				createWakeProgressItem({
					message: "@runner replied.",
					phase: "replied",
					updatedAtMs: 2,
				}),
			],
		});

		expect(state.hasProblem).toBe(false);
		expect(state.thinkingEntries).toEqual([]);
		expect(state.issueEntries).toEqual([]);
	});

	it("uses loaded final replies to suppress stale progress without rendering an outcome", () => {
		const sourceItem = createTimelineItem();
		const timelineItems = [
			sourceItem,
			createTimelineItem({
				actorName: "Runner",
				actorProfileId: TARGET_PROFILE_ID,
				actorProfileKind: "agent",
				actorProfileName: "Runner",
				id: "sig-final-reply",
				replyToSignalId: "sig-source",
				text: "Done.",
				wakeClientMessageId: null,
				wakeTargetProfileIds: [],
			}),
		];
		const state = resolveSpaceMessageWakeProgressState({
			item: sourceItem,
			items: [
				createWakeProgressItem({
					message: "@runner is working on this computer...",
					phase: "running",
					updatedAtMs: 2,
				}),
			],
			timelineItems,
			wakeOutcomeIndex: buildSpaceWakeOutcomeIndex(timelineItems),
		});

		expect(state.hasProblem).toBe(false);
		expect(state.thinkingEntries).toEqual([]);
		expect(state.issueEntries).toEqual([]);
	});

	it("uses stopped system notices to suppress stale progress for that target", () => {
		const sourceItem = createTimelineItem({
			wakeTargetProfileIds: [TARGET_PROFILE_ID, SECOND_TARGET_PROFILE_ID],
		});
		const state = resolveSpaceMessageWakeProgressState({
			item: sourceItem,
			items: [
				createWakeProgressItem({
					message: "@runner is working on this computer...",
					phase: "running",
					targetLabel: "@runner",
					targetProfileId: TARGET_PROFILE_ID,
					updatedAtMs: 1,
				}),
				createWakeProgressItem({
					message: "@codex is being sent to the agent...",
					phase: "sending",
					targetLabel: "@codex",
					targetProfileId: SECOND_TARGET_PROFILE_ID,
					updatedAtMs: 2,
				}),
			],
			timelineItems: [
				sourceItem,
				createTimelineItem({
					actorProfileKind: "system",
					id: "sig-wake-stopped",
					replyToSignalId: "sig-source",
					signalType: "signal.system_notice",
					systemNoticeTargetProfileId: SECOND_TARGET_PROFILE_ID,
					systemNoticeType: "wake_stopped",
					text: "Wake was stopped for Codex before it reached the agent.",
					wakeClientMessageId: null,
					wakeSourceSignalId: null,
					wakeTargetProfileIds: [],
				}),
			],
		});

		expect(state.hasProblem).toBe(false);
		expect(state.thinkingEntries).toHaveLength(1);
		expect(state.thinkingEntries[0]).toEqual(
			expect.objectContaining({
				targetProfileId: TARGET_PROFILE_ID,
				text: "Agent is working",
			})
		);
		expect(state.issueEntries).toEqual([]);
	});

	it("resolves current-user per-Wake service failures to the local repair action", () => {
		const copy =
			"Runner is connected, but OpenMeld Service is not running on this computer. Start OpenMeld Service so this computer can receive local Wake work.";
		const state = resolveSpaceMessageWakeProgressState({
			item: createTimelineItem(),
			items: [
				createWakeProgressItem({
					failureReasonCode: "service.not_running",
					message: "@runner couldn't reply.",
					phase: "failed",
					updatedAtMs: 2,
				}),
			],
			wakeFailureTargetContextsByProfileId: new Map([
				[
					TARGET_PROFILE_ID,
					createWakeFailureTargetContext({
						isCurrentUserManageable: true,
						ownerDisplayName: "Mira",
					}),
				],
			]),
		});

		expect(state.hasProblem).toBe(true);
		expect(state.thinkingEntries).toEqual([]);
		expect(state.issueEntries).toEqual([
			expect.objectContaining({
				body: copy,
				message: "@runner couldn't reply.",
				targetLabel: "@runner",
			}),
		]);
		expect(state.issueEntries[0]?.action).toMatchObject({
			display: {
				actionTarget: "prepare_setup",
				body: copy,
				primaryActionLabel: "Reconnect OpenMeld Service",
			},
			kind: "wake_failure",
		});
	});

	it("keeps another user's local-service Wake failure informative without local repair", () => {
		const state = resolveSpaceMessageWakeProgressState({
			item: createTimelineItem(),
			items: [
				createWakeProgressItem({
					failureReasonCode: "daemon.delivery.execution_stalled",
					message: "@runner couldn't reply.",
					phase: "failed",
					updatedAtMs: 3,
				}),
			],
			wakeFailureTargetContextsByProfileId: new Map([
				[
					TARGET_PROFILE_ID,
					createWakeFailureTargetContext({
						controllerDisplayName: "Ming's MacBook Pro",
						isCurrentUserManageable: false,
						ownerDisplayName: "Ming Yoo",
					}),
				],
			]),
		});

		expect(state.issueEntries).toEqual([
			expect.objectContaining({
				body: "Runner could not complete this Wake on Ming's MacBook Pro. Ask Ming Yoo to check OpenMeld Service and the local agent, then wake the agent again.",
			}),
		]);
		expect(state.issueEntries[0]?.action).toMatchObject({
			display: { actionTarget: null },
			kind: "wake_failure",
		});
	});

	it("uses the current recovery plan only when a failed Wake has no per-Wake reason", () => {
		const state = resolveSpaceMessageWakeProgressState({
			agentRecoveryPlansByProfileId: new Map([
				[TARGET_PROFILE_ID, createConnectControllerPlan()],
			]),
			item: createTimelineItem(),
			items: [
				createWakeProgressItem({
					failureReasonCode: null,
					message: "@runner couldn't reply.",
					phase: "failed",
					updatedAtMs: 4,
				}),
			],
		});

		expect(state.issueEntries).toEqual([
			expect.objectContaining({
				body: "Runner is in this space, and Codex is available on this computer.",
			}),
		]);
		expect(state.issueEntries[0]?.action).toMatchObject({
			kind: "agent_recovery",
			plan: {
				kind: "connect_controller",
				primaryActionLabel: "Connect local agent",
			},
		});
	});

	it("points users to People when no specific recovery action is available", () => {
		const state = resolveSpaceMessageWakeProgressState({
			agentRecoveryPlansByProfileId: new Map([
				[TARGET_PROFILE_ID, { kind: "none" }],
			]),
			item: createTimelineItem(),
			items: [
				createWakeProgressItem({
					failureReasonCode: null,
					message: "@runner couldn't reply.",
					phase: "failed",
					updatedAtMs: 4,
				}),
			],
		});

		expect(state.issueEntries).toEqual([
			expect.objectContaining({
				action: null,
				body: "OpenMeld could not route this agent. Open People to see the agent setup status.",
			}),
		]);
	});

	it("keeps source Wake problem markers after transient failed progress expires", () => {
		const sourceSignalIds = buildWakeProblemSourceSignalIds({
			items: [
				createTimelineItem({
					id: "sig-terminal-failure",
					replyToSignalId: "sig-source",
					signalType: "signal.system_notice",
					systemNoticeType: "terminal_failure",
					wakeClientMessageId: null,
					wakeTargetProfileIds: [],
				}),
			],
			wakeProgressItems: [],
		});

		expect(sourceSignalIds.has("sig-source")).toBe(true);
	});
});

function createTimelineItem(
	overrides: Partial<SpaceTimelineItem> = {}
): SpaceTimelineItem {
	return {
		attachments: [],
		actorAvatarImageUrl: null,
		actorControllerDisplay: null,
		actorAgentControllerRef: null,
		actorName: "Taylor",
		actorOwnerDisplay: null,
		actorOwnerName: null,
		actorOwnerUserId: null,
		actorProfileId: "usr_taylor",
		actorProfileKind: "human",
		actorProfileName: "Taylor",
		actorRuntimeDeviceDisplayName: null,
		agentControllerConversationId: null,
		agentWorkspace: null,
		clientMessageId: null,
		createdAtMs: Date.UTC(2026, 4, 24, 12, 0, 0),
		deliveryState: "sent",
		id: "sig-source",
		newMessagesDuringComposition: null,
		spaceId: "space-1",
		replyPreviewText: null,
		replyToProfileName: null,
		replyToSignalId: null,
		systemNoticeType: null,
		signalType: "signal.text",
		text: "@runner(wake) status check",
		transientActivityPurpose: null,
		wakeClientMessageId: "client-message-1",
		wakeSourceSignalId: "sig-source",
		wakeTargetProfileIds: [TARGET_PROFILE_ID],
		...overrides,
	};
}

function createWakeProgressItem(input: {
	clientMessageId?: string | null;
	failureReasonCode?: string | null;
	message: string;
	phase: WakeProgressItem["phase"];
	sourceSignalId?: string;
	startedAtMs?: number;
	targetLabel?: string;
	targetProfileId?: string;
	updatedAtMs: number;
}): WakeProgressItem {
	return {
		clientMessageId:
			"clientMessageId" in input
				? (input.clientMessageId ?? null)
				: "client-message-1",
		dispatchId: `dispatch-${input.updatedAtMs}`,
		failureReasonCode: input.failureReasonCode ?? null,
		message: input.message,
		phase: input.phase,
		sourceSignalId: input.sourceSignalId ?? "sig-source",
		startedAtMs: input.startedAtMs ?? input.updatedAtMs,
		targetLabel: input.targetLabel ?? "@runner",
		targetProfileId: input.targetProfileId ?? TARGET_PROFILE_ID,
		terminal:
			input.phase === "failed" ||
			input.phase === "publication_unknown" ||
			input.phase === "replied" ||
			input.phase === "stopped",
		updatedAtMs: input.updatedAtMs,
	};
}

function createWakeStopTarget(
	input: Partial<SpaceWakeStopTargetResolution> = {}
): SpaceWakeStopTargetResolution {
	const sourceSignalId =
		input.sourceSignalId === undefined ? "sig-source" : input.sourceSignalId;
	const targetProfileId = input.targetProfileId ?? TARGET_PROFILE_ID;
	return {
		canStop: input.canStop ?? true,
		clientMessageId:
			"clientMessageId" in input
				? (input.clientMessageId ?? null)
				: "client-message-1",
		selector:
			sourceSignalId === null
				? (input.selector ?? null)
				: {
						by: "source_signal",
						sourceSignalId,
						targetProfileId,
					},
		selectorKey:
			input.selectorKey ??
			(sourceSignalId
				? `source_signal:${sourceSignalId}:${targetProfileId}`
				: null),
		sourceSignalId,
		status: input.status ?? "active",
		targetLabel: input.targetLabel ?? "@runner",
		targetProfileId,
	};
}

function createWakeFailureTargetContext(
	input: Partial<WakeFailureTargetContext> = {}
): WakeFailureTargetContext {
	return {
		controllerDisplayName: input.controllerDisplayName ?? null,
		isCurrentUserManageable:
			"isCurrentUserManageable" in input
				? (input.isCurrentUserManageable ?? null)
				: true,
		ownerDisplayName:
			"ownerDisplayName" in input ? (input.ownerDisplayName ?? null) : "Mira",
	};
}

function createConnectControllerPlan(): AgentProfileReplyRecoveryPlan {
	return {
		agentDisplayName: "Codex",
		agentId: "codex",
		body: "Runner is in this space, and Codex is available on this computer.",
		agentControllerRef: "builtin:codex",
		kind: "connect_controller",
		primaryActionId: "connect_local_agent",
		primaryActionLabel: "Connect local agent",
		profileId: TARGET_PROFILE_ID,
		profileName: "Runner",
		recoveryReasonCode: "agent_profile_binding.missing",
		secondaryLabel: "Not connected to a local agent yet",
		title: "Runner is not connected",
	};
}
