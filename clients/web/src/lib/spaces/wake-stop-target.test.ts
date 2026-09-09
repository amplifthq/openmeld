import type { WakeProgressItem } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { shouldRenderSpaceWakeStopControl } from "../../components/spaces/space-wake-stop-control";
import type { SpaceTimelineItem } from "./timeline";
import {
	buildSpaceWakeOutcomeIndex,
	buildSpaceWakeStopSelectorKey,
	resolveSpaceMessageWakeStopTarget,
	resolveSpaceMessageWakeStopTargets,
} from "./wake-stop-target";

const TARGET_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";
const SECOND_TARGET_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";
const CANCEL_BACKED_WAKE_STOP_ELIGIBILITY = {
	controlMode: "cancel",
	reasonCode: null,
	reliability: "native_cancel",
	status: "eligible",
} satisfies NonNullable<WakeProgressItem["wakeStopEligibility"]>;
const INTERRUPT_BACKED_WAKE_STOP_ELIGIBILITY = {
	controlMode: "interrupt",
	reasonCode: null,
	reliability: "native_interrupt",
	status: "eligible",
} satisfies NonNullable<WakeProgressItem["wakeStopEligibility"]>;
const OPENMELD_OWNED_PRE_AGENT_WAKE_STOP_ELIGIBILITY = {
	controlMode: "openmeld_owned_pre_agent_cancel",
	reasonCode: null,
	reliability: "openmeld_owned_pre_agent",
	status: "eligible",
} satisfies NonNullable<WakeProgressItem["wakeStopEligibility"]>;
const UNSUPPORTED_WAKE_STOP_ELIGIBILITY = {
	controlMode: null,
	reasonCode: "agent_controller_interface.stop_unsupported",
	reliability: "unsupported",
	status: "not_eligible",
} satisfies NonNullable<WakeProgressItem["wakeStopEligibility"]>;

describe("resolveSpaceMessageWakeStopTarget", () => {
	it.each([
		"timeline",
		"details",
	] as const)("uses server publication eligibility for %s Stop", (variant) => {
		const item = createWakeProgressItem({
			phase: "publishing",
			wakeStopEligibility: {
				controlMode: "openmeld_owned_publication_cancel",
				reasonCode: null,
				reliability: "openmeld_owned_publication",
				status: "eligible",
			},
		});
		const target = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem(),
			wakeProgressItems: [item],
		});
		expect(target.canStop).toBe(true);
		expect(shouldRenderSpaceWakeStopControl(target, variant)).toBe(true);
		const unavailable = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem(),
			wakeProgressItems: [{ ...item, wakeStopEligibility: null }],
		});
		expect(unavailable.canStop).toBe(false);
		expect(shouldRenderSpaceWakeStopControl(unavailable, variant)).toBe(false);
	});
	it.each([
		"timeline",
		"details",
	] as const)("hides %s Stop when Core withholds viewer eligibility", (variant) => {
		const target = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem(),
			wakeProgressItems: [
				createWakeProgressItem({ phase: "running", wakeStopEligibility: null }),
			],
		});
		expect(target.canStop).toBe(false);
		expect(shouldRenderSpaceWakeStopControl(target, variant)).toBe(false);
	});
	it("resolves an active Wake Stop target from the Wake source signal", () => {
		const target = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem(),
			wakeProgressItems: [
				createWakeProgressItem({
					phase: "running",
				}),
			],
		});

		expect(target).toMatchObject({
			canStop: true,
			selector: {
				by: "source_signal",
				sourceSignalId: "sig-source",
				targetProfileId: TARGET_PROFILE_ID,
			},
			status: "active",
			targetLabel: "@runner",
			targetProfileId: TARGET_PROFILE_ID,
		});
	});

	it("uses the source message id only inside the shared resolver fallback", () => {
		const target = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem({
				wakeSourceSignalId: null,
			}),
			wakeProgressItems: [
				createWakeProgressItem({
					phase: "running",
					sourceSignalId: "sig-source",
				}),
			],
		});

		expect(target.selector).toEqual({
			by: "source_signal",
			sourceSignalId: "sig-source",
			targetProfileId: TARGET_PROFILE_ID,
		});
	});

	it("prefers the source message id fallback over client-message selection", () => {
		const target = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem({
				wakeSourceSignalId: null,
			}),
			wakeProgressItems: [
				createWakeProgressItem({
					phase: "running",
					sourceSignalId: null,
				}),
			],
		});

		expect(target.selector).toEqual({
			by: "source_signal",
			sourceSignalId: "sig-source",
			targetProfileId: TARGET_PROFILE_ID,
		});
	});

	it("shows cancellation_requested responses as stopping, not stopped", () => {
		const selector = {
			by: "source_signal" as const,
			sourceSignalId: "sig-source",
			targetProfileId: TARGET_PROFILE_ID,
		};
		const target = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem(),
			stopRequestStatusBySelectorKey: new Map([
				[buildSpaceWakeStopSelectorKey(selector), "cancellation_requested"],
			]),
			wakeProgressItems: [
				createWakeProgressItem({
					phase: "running",
				}),
			],
		});

		expect(target.canStop).toBe(false);
		expect(target.status).toBe("stopping");
	});

	it("fails closed before click when active Wake Stop eligibility is unsupported", () => {
		const target = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem(),
			wakeProgressItems: [
				createWakeProgressItem({
					phase: "running",
					wakeStopEligibility: UNSUPPORTED_WAKE_STOP_ELIGIBILITY,
				}),
			],
		});

		expect(target.canStop).toBe(false);
		expect(target.status).toBe("unsupported");
		expect(target.selector).toEqual({
			by: "source_signal",
			sourceSignalId: "sig-source",
			targetProfileId: TARGET_PROFILE_ID,
		});
	});

	it("waits for Core authorization when active Wake Stop eligibility is missing", () => {
		const target = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem(),
			wakeProgressItems: [
				createWakeProgressItem({
					omitWakeStopEligibility: true,
					phase: "running",
				}),
			],
		});

		expect(target.canStop).toBe(false);
		expect(target.status).toBe("not_stoppable");
	});

	it("derives an active Wake Stop target for Direct Message automatic Wake progress", () => {
		const target = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem({
				text: "hi",
				wakeClientMessageId: null,
				wakeSourceSignalId: null,
				wakeTargetProfileIds: [],
			}),
			wakeProgressItems: [
				createWakeProgressItem({
					phase: "running",
					sourceSignalId: "sig-source",
				}),
			],
		});

		expect(target).toMatchObject({
			canStop: true,
			selector: {
				by: "source_signal",
				sourceSignalId: "sig-source",
				targetProfileId: TARGET_PROFILE_ID,
			},
			status: "active",
			targetProfileId: TARGET_PROFILE_ID,
		});
	});

	it("waits for Core authorization before offering pre-agent Stop", () => {
		const target = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem(),
			wakeProgressItems: [
				createWakeProgressItem({
					omitWakeStopEligibility: true,
					phase: "queued",
				}),
			],
		});

		expect(target.canStop).toBe(false);
		expect(target.status).toBe("not_stoppable");
	});

	it("does not let a previous retry bypass missing authorization", () => {
		const selector = {
			by: "source_signal" as const,
			sourceSignalId: "sig-source",
			targetProfileId: TARGET_PROFILE_ID,
		};
		const target = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem(),
			stopRequestStatusBySelectorKey: new Map([
				[buildSpaceWakeStopSelectorKey(selector), "retry_later"],
			]),
			wakeProgressItems: [
				createWakeProgressItem({
					omitWakeStopEligibility: true,
					phase: "running",
				}),
			],
		});

		expect(target.canStop).toBe(false);
		expect(target.status).toBe("not_stoppable");
	});

	it("keeps retry_later retryable only for control-backed Wake Stop eligibility", () => {
		const selector = {
			by: "source_signal" as const,
			sourceSignalId: "sig-source",
			targetProfileId: TARGET_PROFILE_ID,
		};
		const target = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem(),
			stopRequestStatusBySelectorKey: new Map([
				[buildSpaceWakeStopSelectorKey(selector), "retry_later"],
			]),
			wakeProgressItems: [
				createWakeProgressItem({
					phase: "running",
				}),
			],
		});

		expect(target.canStop).toBe(true);
		expect(target.status).toBe("retry_later");
	});

	it("allows interrupt-backed active Wake Stop targets", () => {
		const target = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem(),
			wakeProgressItems: [
				createWakeProgressItem({
					phase: "running",
					wakeStopEligibility: INTERRUPT_BACKED_WAKE_STOP_ELIGIBILITY,
				}),
			],
		});

		expect(target.canStop).toBe(true);
		expect(target.status).toBe("active");
	});

	it.each([
		"sending",
		"queued",
	] as const)("allows OpenMeld-owned pre-agent Wake Stop targets during %s", (phase) => {
		const target = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem(),
			wakeProgressItems: [
				createWakeProgressItem({
					phase,
					wakeStopEligibility: OPENMELD_OWNED_PRE_AGENT_WAKE_STOP_ELIGIBILITY,
				}),
			],
		});

		expect(target).toMatchObject({
			canStop: true,
			selector: {
				by: "source_signal",
				sourceSignalId: "sig-source",
				targetProfileId: TARGET_PROFILE_ID,
			},
			status: "active",
			targetLabel: "@runner",
			targetProfileId: TARGET_PROFILE_ID,
		});
	});

	it("does not infer Stop permission from a structured Wake before progress arrives", () => {
		const sourceItem = createTimelineItem();
		const target = resolveSpaceMessageWakeStopTarget({
			item: sourceItem,
			timelineItems: [sourceItem],
			wakeProgressItems: [],
		});

		expect(target).toMatchObject({
			canStop: false,
			selector: null,
			status: "not_stoppable",
		});
	});

	it("does not create a Stop intent from an old structured Wake without progress", () => {
		const sourceItem = createTimelineItem();
		const target = resolveSpaceMessageWakeStopTarget({
			item: sourceItem,
			timelineItems: [sourceItem],
			wakeProgressItems: [],
		});

		expect(target.canStop).toBe(false);
		expect(target.selector).toBeNull();
		expect(target.status).toBe("not_stoppable");
	});

	it("does not recreate a Stop intent after a visible agent reply is present", () => {
		const sourceItem = createTimelineItem();
		const target = resolveSpaceMessageWakeStopTarget({
			item: sourceItem,
			timelineItems: [
				sourceItem,
				createTimelineItem({
					actorProfileId: TARGET_PROFILE_ID,
					actorProfileKind: "agent",
					id: "sig-agent-reply",
					replyToSignalId: "sig-source",
					wakeClientMessageId: null,
					wakeSourceSignalId: null,
					wakeTargetProfileIds: [],
				}),
			],
			wakeProgressItems: [],
		});

		expect(target.canStop).toBe(false);
		expect(target.selector).toBeNull();
		expect(target.status).toBe("not_stoppable");
	});

	it("does not keep a Stop intent after a stopped system notice is visible", () => {
		const sourceItem = createTimelineItem();
		const target = resolveSpaceMessageWakeStopTarget({
			item: sourceItem,
			timelineItems: [
				sourceItem,
				createTimelineItem({
					actorProfileKind: "system",
					createdAtMs: sourceItem.createdAtMs + 500,
					id: "sig-wake-stopped",
					signalType: "signal.system_notice",
					systemNoticeTargetProfileId: TARGET_PROFILE_ID,
					systemNoticeType: "wake_stopped",
					wakeClientMessageId: null,
					wakeSourceSignalId: null,
					wakeTargetProfileIds: [],
				}),
			],
			wakeProgressItems: [],
		});

		expect(target.canStop).toBe(false);
		expect(target.selector).toBeNull();
		expect(target.status).toBe("not_stoppable");
	});

	it.each([
		"stay_silent",
		"policy_blocked",
	])("does not keep a Stop intent after a visible %s notice", (systemNoticeType) => {
		const sourceItem = createTimelineItem();
		const target = resolveSpaceMessageWakeStopTarget({
			item: sourceItem,
			timelineItems: [
				sourceItem,
				createTimelineItem({
					actorProfileKind: "system",
					createdAtMs: sourceItem.createdAtMs + 500,
					id: `sig-${systemNoticeType}`,
					replyToSignalId: "sig-source",
					signalType: "signal.system_notice",
					systemNoticeTargetProfileId: TARGET_PROFILE_ID,
					systemNoticeType,
					wakeClientMessageId: null,
					wakeSourceSignalId: null,
					wakeTargetProfileIds: [],
				}),
			],
			wakeProgressItems: [],
		});

		expect(target.canStop).toBe(false);
		expect(target.selector).toBeNull();
		expect(target.status).toBe("not_stoppable");
	});

	it("does not keep a Stop intent after a stopped system notice names the source target", () => {
		const sourceItem = createTimelineItem({
			text: "@OpenMeld Test 0624 5's OpenMeld Assistant please wait before replying",
		});
		const timelineItems = [
			sourceItem,
			createTimelineItem({
				actorProfileKind: "system",
				createdAtMs: sourceItem.createdAtMs + 500,
				id: "sig-wake-stopped",
				signalType: "signal.system_notice",
				systemNoticeType: "wake_stopped",
				text: "Wake was stopped for OpenMeld Test 0624 5's OpenMeld Assistant before it reached the agent.",
				wakeClientMessageId: null,
				wakeSourceSignalId: null,
				wakeTargetProfileIds: [],
			}),
		];
		const target = resolveSpaceMessageWakeStopTarget({
			item: sourceItem,
			timelineItems,
			wakeOutcomeIndex: buildSpaceWakeOutcomeIndex(timelineItems),
			wakeProgressItems: [],
		});

		expect(target.canStop).toBe(false);
		expect(target.selector).toBeNull();
		expect(target.status).toBe("not_stoppable");
	});

	it("does not offer batch Stop before Core authorizes individual targets", () => {
		const sourceItem = createTimelineItem({
			wakeTargetProfileIds: [TARGET_PROFILE_ID, SECOND_TARGET_PROFILE_ID],
		});
		const targets = resolveSpaceMessageWakeStopTargets({
			item: sourceItem,
			wakeProgressItems: [],
		});

		expect(targets).toEqual([]);
	});

	it("keeps the authorized remaining target after one target has a visible stopped notice", () => {
		const sourceItem = createTimelineItem({
			wakeTargetProfileIds: [TARGET_PROFILE_ID, SECOND_TARGET_PROFILE_ID],
		});
		const targets = resolveSpaceMessageWakeStopTargets({
			item: sourceItem,
			timelineItems: [
				sourceItem,
				createTimelineItem({
					actorProfileKind: "system",
					createdAtMs: sourceItem.createdAtMs + 500,
					id: "sig-wake-stopped",
					signalType: "signal.system_notice",
					systemNoticeTargetProfileId: TARGET_PROFILE_ID,
					systemNoticeType: "wake_stopped",
					wakeClientMessageId: null,
					wakeSourceSignalId: null,
					wakeTargetProfileIds: [],
				}),
			],
			wakeProgressItems: [
				createWakeProgressItem({
					phase: "running",
					targetProfileId: SECOND_TARGET_PROFILE_ID,
				}),
			],
		});

		expect(targets).toHaveLength(1);
		expect(targets[0]).toMatchObject({
			canStop: true,
			selector: {
				by: "source_signal",
				sourceSignalId: "sig-source",
				targetProfileId: SECOND_TARGET_PROFILE_ID,
			},
			targetProfileId: SECOND_TARGET_PROFILE_ID,
		});
	});

	it("does not keep active Stop controls after a visible stopped notice", () => {
		const sourceItem = createTimelineItem();
		const target = resolveSpaceMessageWakeStopTarget({
			item: sourceItem,
			timelineItems: [
				sourceItem,
				createTimelineItem({
					actorProfileKind: "system",
					createdAtMs: sourceItem.createdAtMs + 500,
					id: "sig-wake-stopped",
					replyToSignalId: "sig-source",
					signalType: "signal.system_notice",
					systemNoticeTargetProfileId: TARGET_PROFILE_ID,
					systemNoticeType: "wake_stopped",
					wakeClientMessageId: null,
					wakeSourceSignalId: null,
					wakeTargetProfileIds: [],
				}),
			],
			wakeProgressItems: [
				createWakeProgressItem({
					phase: "sending",
				}),
			],
		});

		expect(target.canStop).toBe(false);
		expect(target.selector).toBeNull();
		expect(target.status).toBe("not_stoppable");
	});

	it("keeps active Stop controls for remaining targets after another target is stopped", () => {
		const sourceItem = createTimelineItem({
			wakeTargetProfileIds: [TARGET_PROFILE_ID, SECOND_TARGET_PROFILE_ID],
		});
		const targets = resolveSpaceMessageWakeStopTargets({
			item: sourceItem,
			timelineItems: [
				sourceItem,
				createTimelineItem({
					actorProfileKind: "system",
					createdAtMs: sourceItem.createdAtMs + 500,
					id: "sig-wake-stopped",
					replyToSignalId: "sig-source",
					signalType: "signal.system_notice",
					systemNoticeTargetProfileId: TARGET_PROFILE_ID,
					systemNoticeType: "wake_stopped",
					wakeClientMessageId: null,
					wakeSourceSignalId: null,
					wakeTargetProfileIds: [],
				}),
			],
			wakeProgressItems: [
				createWakeProgressItem({
					phase: "sending",
					targetProfileId: TARGET_PROFILE_ID,
				}),
				createWakeProgressItem({
					phase: "running",
					targetProfileId: SECOND_TARGET_PROFILE_ID,
				}),
			],
		});

		expect(targets).toHaveLength(1);
		expect(targets[0]).toMatchObject({
			canStop: true,
			selector: {
				by: "source_signal",
				sourceSignalId: "sig-source",
				targetProfileId: SECOND_TARGET_PROFILE_ID,
			},
			status: "active",
			targetProfileId: SECOND_TARGET_PROFILE_ID,
		});
	});

	it("shows stopped only after stopped Wake progress is visible", () => {
		const target = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem(),
			wakeProgressItems: [
				createWakeProgressItem({
					phase: "stopped",
				}),
			],
		});

		expect(target.canStop).toBe(false);
		expect(target.status).toBe("stopped");
	});

	it("keeps terminal replied Wakes not stoppable", () => {
		const target = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem(),
			wakeProgressItems: [
				createWakeProgressItem({
					phase: "replied",
				}),
			],
		});

		expect(target.canStop).toBe(false);
		expect(target.status).toBe("not_stoppable");
	});

	it("keeps unsupported Stop attempts visible without enabling another Stop", () => {
		const selector = {
			by: "source_signal" as const,
			sourceSignalId: "sig-source",
			targetProfileId: TARGET_PROFILE_ID,
		};
		const target = resolveSpaceMessageWakeStopTarget({
			item: createTimelineItem(),
			stopRequestStatusBySelectorKey: new Map([
				[buildSpaceWakeStopSelectorKey(selector), "unsupported"],
			]),
			wakeProgressItems: [
				createWakeProgressItem({
					phase: "running",
				}),
			],
		});

		expect(target.canStop).toBe(false);
		expect(target.status).toBe("unsupported");
	});
});

function createTimelineItem(
	overrides: Partial<SpaceTimelineItem> = {}
): SpaceTimelineItem {
	return {
		attachments: [],
		id: "sig-source",
		spaceId: "space-1",
		signalType: "signal.text",
		createdAtMs: Date.UTC(2026, 5, 3, 22, 7),
		deliveryState: "sent",
		actorName: "Felix",
		actorAvatarImageUrl: null,
		actorControllerDisplay: null,
		actorAgentControllerRef: null,
		actorOwnerDisplay: null,
		actorOwnerName: null,
		actorOwnerUserId: null,
		actorProfileId: "human-profile-1",
		actorProfileKind: "human",
		actorProfileName: "Felix",
		actorRuntimeDeviceDisplayName: null,
		agentControllerConversationId: null,
		agentWorkspace: null,
		clientMessageId: null,
		newMessagesDuringComposition: null,
		replyPreviewText: null,
		replyToProfileName: null,
		replyToSignalId: null,
		systemNoticeType: null,
		text: "@runner please triage this",
		transientActivityPurpose: null,
		wakeClientMessageId: "client-message-1",
		wakeSourceSignalId: "sig-source",
		wakeTargetProfileIds: [TARGET_PROFILE_ID],
		...overrides,
	};
}

function createWakeProgressItem(input: {
	omitWakeStopEligibility?: boolean;
	phase: WakeProgressItem["phase"];
	sourceSignalId?: string | null;
	targetProfileId?: string;
	wakeStopEligibility?: WakeProgressItem["wakeStopEligibility"];
}): WakeProgressItem {
	const item: WakeProgressItem = {
		clientMessageId: "client-message-1",
		dispatchId: "dispatch-1",
		failureReasonCode: null,
		message: "@runner is working on this computer...",
		phase: input.phase,
		sourceSignalId:
			"sourceSignalId" in input ? (input.sourceSignalId ?? null) : "sig-source",
		targetLabel: "@runner",
		targetProfileId: input.targetProfileId ?? TARGET_PROFILE_ID,
		terminal: ["failed", "replied", "stopped"].includes(input.phase),
		updatedAtMs: 1,
	};
	if (!input.omitWakeStopEligibility) {
		item.wakeStopEligibility = Object.hasOwn(input, "wakeStopEligibility")
			? input.wakeStopEligibility
			: CANCEL_BACKED_WAKE_STOP_ELIGIBILITY;
	}
	return item;
}
