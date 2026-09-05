import type { GetSpaceMessageDetailsResponse } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import {
	buildSpaceMessageDetailsPresentation,
	resolveMessageDetailsDiagnosticReportStatus,
} from "./space-message-details-presentation";

describe("resolveMessageDetailsDiagnosticReportStatus", () => {
	it.each([
		{ expected: "idle", isPending: false, isSent: false },
		{ expected: "sent", isPending: false, isSent: true },
		{ expected: "pending", isPending: true, isSent: false },
		{ expected: "pending", isPending: true, isSent: true },
	] as const)("resolves $expected", ({ expected, isPending, isSent }) => {
		expect(
			resolveMessageDetailsDiagnosticReportStatus({ isPending, isSent })
		).toBe(expected);
	});
});

describe("buildSpaceMessageDetailsPresentation", () => {
	it("presents a selected Agent reply as one replied Activity instead of repeating its inherited Wake target", () => {
		const source = createTimelineItem({
			actorName: "Felix",
			actorProfileId: "profile-felix",
			actorProfileKind: "human",
			id: "source-message",
			text: "Check production.",
			wakeTargetProfileIds: ["profile-codex"],
		});
		const reply = createTimelineItem({
			actorName: "Codex",
			actorProfileId: "profile-codex",
			id: "reply-codex",
			replyToSignalId: source.id,
			text: "Production is healthy.",
			wakeSourceSignalId: source.id,
		});
		const data = createMessageDetailsResponse("signal.text");

		const presentation = buildSpaceMessageDetailsPresentation({
			data: {
				...data,
				message: {
					...data.message,
					signalId: reply.id,
				},
				wakeContext: {
					clientMessageId: notApplicableFact(),
					sourceSignalId: recordedFact(source.id),
					state: "recorded",
					targets: [createWakeTarget("profile-codex", "replied")],
				},
			},
			item: reply,
			profilePresentationsById: new Map([
				["profile-codex", createProfilePresentation("profile-codex", "Codex")],
			]),
			replyItems: [],
			wakeIssueEntries: [],
		});

		expect(presentation.activityItems).toEqual([
			expect.objectContaining({
				description: "Production is healthy.",
				jumpSignalId: reply.id,
				kind: "reply",
				status: "replied",
				title: "Codex",
			}),
		]);
	});

	it("collapses each Wake target and its recorded outcome into one readable Activity row", () => {
		const source = createTimelineItem({
			actorName: "Felix",
			actorProfileId: "profile-felix",
			actorProfileKind: "human",
			id: "source-message",
			text: "Compare the release options.",
			wakeTargetProfileIds: ["profile-codex", "profile-cursor"],
		});
		const codexReply = createTimelineItem({
			actorName: "Codex",
			actorProfileId: "profile-codex",
			id: "reply-codex",
			replyToSignalId: source.id,
			text: "Use the staged release.",
			wakeSourceSignalId: source.id,
		});
		const cursorFailure = createTimelineItem({
			actorName: "OpenMeld System",
			actorProfileId: "system",
			actorProfileKind: "system",
			id: "failure-cursor",
			replyToSignalId: source.id,
			signalType: "signal.system_notice",
			systemNoticeTargetProfileId: "profile-cursor",
			systemNoticeType: "terminal_failure",
			text: "Cursor could not reply because its plan limit was reached.",
			wakeSourceSignalId: source.id,
		});
		const data = createMessageDetailsResponse("signal.text");
		const presentation = buildSpaceMessageDetailsPresentation({
			data: {
				...data,
				message: {
					...data.message,
					actor: {
						...data.message.actor,
						displayName: "Felix",
						profileId: "profile-felix",
						profileKind: "human",
						profileName: "Felix",
					},
					signalId: source.id,
				},
				wakeContext: {
					clientMessageId: notApplicableFact(),
					sourceSignalId: recordedFact(source.id),
					state: "recorded",
					targets: [
						createWakeTarget("profile-codex", "replied"),
						createWakeTarget("profile-cursor", "failed"),
					],
				},
			},
			item: source,
			profilePresentationsById: new Map([
				["profile-codex", createProfilePresentation("profile-codex", "Codex")],
				[
					"profile-cursor",
					createProfilePresentation("profile-cursor", "Cursor"),
				],
			]),
			replyItems: [codexReply, cursorFailure],
			wakeIssueEntries: [
				{
					action: null,
					body: "Upgrade the Cursor plan, then try again.",
					key: "cursor-limit",
					message: "Cursor could not reply.",
					targetLabel: "Cursor",
					targetProfileId: "profile-cursor",
				},
			],
			wakeProgressEntries: [],
		});

		expect(presentation.activityItems).toEqual([
			expect.objectContaining({
				description: "Compare the release options.",
				kind: "message",
				title: "Felix",
			}),
			expect.objectContaining({
				description: "Use the staged release.",
				jumpSignalId: "reply-codex",
				kind: "target",
				status: "replied",
				targetProfileId: "profile-codex",
				title: "Codex",
			}),
			expect.objectContaining({
				description: "Upgrade the Cursor plan, then try again.",
				jumpSignalId: "failure-cursor",
				kind: "target",
				status: "failed",
				targetProfileId: "profile-cursor",
				title: "Cursor",
			}),
		]);
	});

	it("replaces live Agent work with the durable reply instead of adding another Activity", () => {
		const source = createTimelineItem({
			actorName: "Felix",
			actorProfileId: "profile-felix",
			actorProfileKind: "human",
			id: "source-message",
			text: "Review the release.",
			wakeTargetProfileIds: ["profile-codex"],
		});
		const data = createMessageDetailsResponse("signal.text");
		const baseInput = {
			data: {
				...data,
				message: { ...data.message, signalId: source.id },
				wakeContext: {
					clientMessageId: notApplicableFact(),
					sourceSignalId: recordedFact(source.id),
					state: "recorded" as const,
					targets: [createWakeTarget("profile-codex", "running")],
				},
			},
			item: source,
			profilePresentationsById: new Map([
				["profile-codex", createProfilePresentation("profile-codex", "Codex")],
			]),
			wakeIssueEntries: [],
		};
		const workingPresentation = buildSpaceMessageDetailsPresentation({
			...baseInput,
			replyItems: [],
			wakeProgressEntries: [
				{
					elapsedStartedAtMs: 2,
					lastEvidenceAtMs: 2,
					key: "codex-working",
					kind: "progress",
					phase: "running",
					step: {
						description: "The agent has the Wake.",
						kind: "working",
						label: "Agent is working",
						status: "active",
					},
					targetProfileId: "profile-codex",
					text: "Reviewing the release plan…",
				},
			],
		});

		expect(workingPresentation.activityItems).toContainEqual(
			expect.objectContaining({
				description: "Reviewing the release plan…",
				status: "running",
				targetProfileId: "profile-codex",
			})
		);

		const reply = createTimelineItem({
			actorName: "Codex",
			actorProfileId: "profile-codex",
			id: "reply-codex",
			replyToSignalId: source.id,
			text: "The release plan is ready.",
			wakeSourceSignalId: source.id,
		});
		const repliedPresentation = buildSpaceMessageDetailsPresentation({
			...baseInput,
			replyItems: [reply],
			wakeProgressEntries: [
				{
					elapsedStartedAtMs: 2,
					lastEvidenceAtMs: 2,
					key: "codex-working",
					kind: "progress",
					phase: "running",
					step: {
						description: "The agent has the Wake.",
						kind: "working",
						label: "Agent is working",
						status: "active",
					},
					targetProfileId: "profile-codex",
					text: "Reviewing the release plan…",
				},
			],
		});
		const codexActivities = repliedPresentation.activityItems.filter(
			(item) => item.targetProfileId === "profile-codex"
		);

		expect(codexActivities).toEqual([
			expect.objectContaining({
				description: "The release plan is ready.",
				status: "replied",
			}),
		]);
	});

	it("keeps system outcomes and recovery notices in Activity without repeating reply verbs", () => {
		const source = createTimelineItem({
			actorName: "Felix",
			actorProfileKind: "human",
			id: "source-message",
		});
		const reply = createTimelineItem({
			actorName: "Codex",
			id: "reply-message",
			replyToSignalId: source.id,
		});
		const notices = [
			createTimelineItem({
				actorName: "OpenCode",
				actorProfileId: "profile-opencode",
				actorProfileName: "OpenCode",
				id: "notice-silent",
				replyToSignalId: source.id,
				signalType: "signal.system_notice",
				systemNoticeType: "stay_silent",
			}),
			createTimelineItem({
				actorName: "Claude",
				actorProfileId: "profile-claude",
				actorProfileName: "Claude",
				id: "notice-stopped",
				replyToSignalId: source.id,
				signalType: "signal.system_notice",
				systemNoticeType: "wake_stopped",
			}),
			createTimelineItem({
				actorName: "Cursor",
				actorProfileId: "profile-cursor",
				actorProfileName: "Cursor",
				id: "notice-blocked",
				replyToSignalId: source.id,
				signalType: "signal.system_notice",
				systemNoticeType: "policy_blocked",
			}),
			createTimelineItem({
				actorName: "Codex",
				id: "notice-failed",
				replyToSignalId: source.id,
				signalType: "signal.system_notice",
				systemNoticeType: "terminal_failure",
			}),
			createTimelineItem({
				id: "notice-recovery",
				replyToSignalId: source.id,
				signalType: "signal.system_notice",
				systemNoticeType: "execution_recovery_available",
				systemNoticeTargetProfileId: "profile-codex",
			}),
			createTimelineItem({
				id: "notice-recovered",
				replyToSignalId: source.id,
				signalType: "signal.system_notice",
				systemNoticeType: "execution_recovery_completed",
				systemNoticeTargetProfileId: "profile-codex",
			}),
			createTimelineItem({
				actorName: "Reviewer",
				actorProfileId: "profile-reviewer",
				actorProfileName: "Reviewer",
				id: "status-working",
				replyToSignalId: source.id,
				signalType: "signal.status",
				spaceStatus: "working",
			}),
		];

		const presentation = buildSpaceMessageDetailsPresentation({
			data: createMessageDetailsResponse("signal.text"),
			item: source,
			replyItems: [reply, ...notices],
			wakeIssueEntries: [],
		});

		expect(presentation.replyItems.map((item) => item.id)).toEqual([
			"reply-message",
		]);
		expect(presentation.recoveryNoticeItems.map((item) => item.id)).toEqual([
			"notice-recovery",
			"notice-recovered",
		]);
		expect(
			presentation.activityItems.filter(
				(item) => item.kind === "reply" || item.kind === "recovery"
			)
		).toEqual([]);
		expect(
			presentation.activityItems
				.filter((item) => item.kind === "target" || item.kind === "recovery")
				.map(({ kind, status, title }) => ({ kind, status, title }))
		).toEqual([
			{
				kind: "target",
				status: "completed",
				title: "Codex",
			},
			{
				kind: "target",
				status: "completed",
				title: "OpenCode",
			},
			{
				kind: "target",
				status: "stopped",
				title: "Claude",
			},
			{
				kind: "target",
				status: "failed",
				title: "Cursor",
			},
			{
				kind: "target",
				status: "running",
				title: "Reviewer",
			},
		]);
	});

	it("labels a system outcome opened directly as the original Activity event", () => {
		const item = createTimelineItem({
			actorName: "Codex",
			id: "notice-failed",
			signalType: "signal.system_notice",
			systemNoticeType: "terminal_failure",
			text: "Codex finished, but OpenMeld could not post the reply.",
		});

		const presentation = buildSpaceMessageDetailsPresentation({
			data: createMessageDetailsResponse("signal.system_notice"),
			item,
			replyItems: [],
			wakeIssueEntries: [],
		});

		expect(presentation.activityItems[0]).toEqual(
			expect.objectContaining({
				description: item.text,
				kind: "target",
				status: "failed",
				title: "Codex",
			})
		);
	});

	it.each([
		"signal.text",
		"signal.status",
		"signal.system_notice",
	] as const)("shows the original %s event as authored content instead of a generic action", (signalType) => {
		const item = createTimelineItem({ signalType });

		const presentation = buildSpaceMessageDetailsPresentation({
			data: createMessageDetailsResponse(signalType),
			item,
			replyItems: [],
			wakeIssueEntries: [],
		});

		expect(presentation.activityItems[0]).toEqual(
			expect.objectContaining({
				description: item.text,
				title: "Codex",
			})
		);
	});

	it("uses the current Agent Profile name when a Wake trace only records an opaque target ID", () => {
		const item = createTimelineItem();
		const data = createMessageDetailsResponse("signal.text");
		const targetProfileId = "agt_648a8325";
		const wakeData: GetSpaceMessageDetailsResponse = {
			...data,
			wakeContext: {
				clientMessageId: notApplicableFact(),
				sourceSignalId: notApplicableFact(),
				state: "recorded",
				targets: [
					{
						agentContext: {
							...notApplicableAgentContext(),
							profileId: recordedFact(targetProfileId),
							profileName: recordedFact(targetProfileId),
							state: "recorded",
						},
						status: "failed",
						targetLabel: targetProfileId,
						targetProfileId,
					},
				],
			},
		};
		const presentation = buildSpaceMessageDetailsPresentation({
			data: wakeData,
			item,
			replyItems: [],
			targetProfileDisplayNamesByProfileId: new Map([
				[targetProfileId, "Center Agent"],
			]),
			wakeIssueEntries: [],
		});

		expect(
			presentation.activityItems.find((activity) => activity.kind === "target")
		).toEqual(expect.objectContaining({ title: "Center Agent" }));

		const presentationWithoutCurrentProfile =
			buildSpaceMessageDetailsPresentation({
				data: wakeData,
				item,
				replyItems: [],
				wakeIssueEntries: [],
			});
		expect(
			presentationWithoutCurrentProfile.activityItems.find(
				(activity) => activity.kind === "target"
			)
		).toEqual(expect.objectContaining({ title: "Agent" }));
	});
});

function createTimelineItem(
	overrides: Partial<SpaceTimelineItem> = {}
): SpaceTimelineItem {
	return {
		actorAgentControllerRef: null,
		actorAvatarImageUrl: null,
		actorControllerDisplay: null,
		actorName: "Codex",
		actorOwnerDisplay: null,
		actorOwnerName: null,
		actorOwnerUserId: null,
		actorProfileId: "profile-codex",
		actorProfileKind: "agent",
		actorProfileName: "Codex",
		actorRuntimeDeviceDisplayName: null,
		agentControllerConversationId: null,
		agentWorkspace: null,
		attachments: [],
		clientMessageId: null,
		createdAtMs: 2,
		deliveryState: "sent",
		id: "message-1",
		newMessagesDuringComposition: null,
		replyPreviewText: null,
		replyToProfileName: null,
		replyToSignalId: null,
		signalType: "signal.text",
		spaceId: "space-1",
		systemNoticeType: null,
		text: "Result",
		transientActivityPurpose: null,
		wakeClientMessageId: null,
		wakeSourceSignalId: null,
		wakeTargetProfileIds: [],
		...overrides,
	};
}

function createWakeTarget(
	targetProfileId: string,
	status: NonNullable<
		GetSpaceMessageDetailsResponse["wakeContext"]["targets"][number]["status"]
	>
): GetSpaceMessageDetailsResponse["wakeContext"]["targets"][number] {
	return {
		agentContext: {
			...notApplicableAgentContext(),
			profileId: recordedFact(targetProfileId),
			profileName: recordedFact(targetProfileId),
			state: "recorded",
		},
		status,
		targetLabel: targetProfileId,
		targetProfileId,
	};
}

function createProfilePresentation(profileId: string, profileName: string) {
	return {
		agentControllerRef: null,
		avatarImageUrl: null,
		isCenterAgent: false,
		profileId,
		profileKind: "agent" as const,
		profileName,
	};
}

function createMessageDetailsResponse(
	signalType: GetSpaceMessageDetailsResponse["message"]["signalType"]
): GetSpaceMessageDetailsResponse {
	return {
		agentContext: notApplicableAgentContext(),
		diagnostics: {
			signalId: "message-1",
			traceSelectors: [],
		},
		message: {
			actor: {
				displayName: "Codex",
				profileHandle: null,
				profileId: "profile-codex",
				profileKind: "agent",
				profileName: "Codex",
			},
			sentAtMs: 1,
			signalId: "message-1",
			signalType,
		},
		query: { signalId: "message-1", spaceId: "space-1" },
		replyContext: {
			previewText: notApplicableFact(),
			replyingToAuthor: notApplicableFact(),
			replyingToSignalId: notApplicableFact(),
			resolved: false,
			state: "not_applicable",
		},
		wakeContext: {
			clientMessageId: notApplicableFact(),
			sourceSignalId: notApplicableFact(),
			state: "not_applicable",
			targets: [],
		},
	};
}

function notApplicableAgentContext(): GetSpaceMessageDetailsResponse["agentContext"] {
	return {
		agentControllerConversationId: notApplicableFact(),
		agentControllerRef: notApplicableFact(),
		bindingId: notApplicableFact(),
		profileId: notApplicableFact(),
		profileName: notApplicableFact(),
		state: "not_applicable",
		openMeldServiceRuntimeId: notApplicableFact(),
		workspaceFingerprint: notApplicableFact(),
		workspacePath: notApplicableFact(),
	};
}

function notApplicableFact() {
	return {
		state: "not_applicable" as const,
		value: null,
		source: "none" as const,
	};
}

function recordedFact(value: string) {
	return {
		source: "wake_trace" as const,
		state: "recorded" as const,
		value,
	};
}
