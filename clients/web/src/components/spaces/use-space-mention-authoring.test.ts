import {
	createSpaceMemberAgentSnapshot,
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
	buildSpaceComposerAddressingSummary,
	buildSpaceComposerAddressingTargets,
	buildSpaceMentionTargetItems,
	resolveSpaceComposerAddressingMentions,
	useSpaceMentionAuthoring,
} from "./use-space-mention-authoring";

describe("useSpaceMentionAuthoring composer drafts", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("restores an unsent Space draft after the composer remounts", () => {
		const firstComposer = renderHook(() =>
			useSpaceMentionAuthoring({
				composerDraftScope: {
					kind: "space",
					ownerAccountId: "account-1",
					profileId: "human-1",
					spaceId: "space-1",
				},
				isMembersLoading: false,
				membersErrorMessage: null,
				snapshot: null,
				spaceId: "space-1",
				openMeldProfileId: "human-1",
			})
		);

		act(() => {
			firstComposer.result.current.onComposerChange(
				"Keep this plan after refresh",
				{ end: 28, start: 28 }
			);
		});
		firstComposer.unmount();

		const restoredComposer = renderHook(() =>
			useSpaceMentionAuthoring({
				composerDraftScope: {
					kind: "space",
					ownerAccountId: "account-1",
					profileId: "human-1",
					spaceId: "space-1",
				},
				isMembersLoading: false,
				membersErrorMessage: null,
				snapshot: null,
				spaceId: "space-1",
				openMeldProfileId: "human-1",
			})
		);

		expect(restoredComposer.result.current.composerText).toBe(
			"Keep this plan after refresh"
		);
	});

	it("keeps each thread draft isolated and restores it when the thread reopens", () => {
		const composer = renderHook(
			({ threadId }: { threadId: string }) =>
				useSpaceMentionAuthoring({
					composerDraftScope: {
						kind: "space_thread",
						ownerAccountId: "account-1",
						profileId: "human-1",
						spaceId: "space-1",
						threadId,
					},
					isMembersLoading: false,
					membersErrorMessage: null,
					snapshot: null,
					spaceId: "space-1",
					openMeldProfileId: "human-1",
				}),
			{ initialProps: { threadId: "thread-a" } }
		);

		act(() => {
			composer.result.current.onComposerChange("Draft for thread A", {
				end: 18,
				start: 18,
			});
		});

		composer.rerender({ threadId: "thread-b" });
		expect(composer.result.current.composerText).toBe("");

		act(() => {
			composer.result.current.onComposerChange("Draft for thread B", {
				end: 18,
				start: 18,
			});
		});

		composer.rerender({ threadId: "thread-a" });
		expect(composer.result.current.composerText).toBe("Draft for thread A");
	});

	it("restores structured mentions and the reply target with the draft text", () => {
		const snapshot = createSpaceMembersSnapshot({
			agents: [
				createSpaceMemberAgentSnapshot({
					agentWakeAvailability: { status: "available_for_wake" },
					profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					profileName: "Runner",
				}),
			],
		});
		const input = {
			composerDraftScope: {
				kind: "space" as const,
				ownerAccountId: "account-1",
				profileId: "human-1",
				spaceId: "space-1",
			},
			isMembersLoading: false,
			membersErrorMessage: null,
			snapshot,
			spaceId: "space-1",
			openMeldProfileId: "human-1",
		};
		const firstComposer = renderHook(() => useSpaceMentionAuthoring(input));

		act(() => {
			firstComposer.result.current.onComposerChange("@Run", {
				end: 4,
				start: 4,
			});
		});
		expect(firstComposer.result.current.mentionPopoverState.kind).toBe(
			"target_picker"
		);
		act(() => {
			firstComposer.result.current.onMentionItemSelect(0, "wake");
		});
		act(() => {
			firstComposer.result.current.onReplyToSignal({ signalId: "signal-1" });
		});
		firstComposer.unmount();

		const restoredComposer = renderHook(() => useSpaceMentionAuthoring(input));

		expect(restoredComposer.result.current.composerText).toBe("@Runner ");
		expect(restoredComposer.result.current.replyTo).toEqual({
			signalId: "signal-1",
		});
		expect(restoredComposer.result.current.addressingTargets).toEqual([
			expect.objectContaining({
				profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
				relation: "wake",
			}),
		]);
	});

	it("migrates a restored Human Reference into a Human Mention", async () => {
		const humanProfileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const composer = renderHook(() =>
			useSpaceMentionAuthoring({
				composerDraftScope: {
					kind: "space",
					ownerAccountId: "account-1",
					profileId: "human-1",
					spaceId: "space-1",
				},
				initialComposerDraft: {
					authoredMentions: [
						{
							end: 6,
							profileId: humanProfileId,
							relation: "reference",
							start: 0,
							text: "@Felix",
						},
					],
					replyToSignalId: null,
					text: "@Felix please review this.",
					updatedAtMs: 1,
					version: 1,
				},
				isMembersLoading: false,
				membersErrorMessage: null,
				openMeldProfileId: "human-1",
				snapshot: createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							profileId: humanProfileId,
							profileName: "Felix",
						}),
					],
				}),
				spaceId: "space-1",
			})
		);

		await waitFor(() => {
			expect(composer.result.current.addressingTargets).toEqual([
				expect.objectContaining({
					profileId: humanProfileId,
					relation: "mention",
				}),
			]);
		});
		expect(
			composer.result.current.prepareSubmission("Members are required.")
				.messageEnvelope
		).toMatchObject({
			mentionTargets: [humanProfileId],
			referenceTargets: [],
		});
	});

	it("rewrites the owning canonical mention when its relation changes", () => {
		const runnerProfileId = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const composer = renderHook(() =>
			useSpaceMentionAuthoring({
				composerDraftScope: {
					kind: "space",
					ownerAccountId: "account-1",
					profileId: "human-1",
					spaceId: "space-1",
				},
				isMembersLoading: false,
				membersErrorMessage: null,
				openMeldProfileId: "human-1",
				snapshot: createSpaceMembersSnapshot({
					agents: [
						createSpaceMemberAgentSnapshot({
							agentWakeAvailability: { status: "available_for_wake" },
							profileId: runnerProfileId,
							profileName: "Runner",
						}),
					],
				}),
				spaceId: "space-1",
			})
		);

		const textWithDuplicate = "@Runner(wake) Review this plan with @Run";
		act(() => {
			composer.result.current.onComposerChange(textWithDuplicate, {
				end: textWithDuplicate.length,
				start: textWithDuplicate.length,
			});
		});
		expect(composer.result.current.mentionPopoverState.kind).toBe(
			"target_picker"
		);
		act(() => {
			composer.result.current.onMentionItemSelect(0, "reference");
		});
		expect(composer.result.current.addressingTargets).toEqual([
			expect.objectContaining({
				profileId: runnerProfileId,
				relation: "wake",
			}),
		]);

		act(() => {
			composer.result.current.onMentionRelationChange(
				runnerProfileId,
				"reference"
			);
		});

		expect(composer.result.current.composerText).toBe(
			"@Runner(reference) Review this plan with @Runner "
		);
		expect(
			composer.result.current.prepareSubmission("Members are required.")
				.messageEnvelope
		).toEqual({
			activationTargets: [],
			mentionTargets: [],
			referenceTargets: [runnerProfileId],
			text: "@Runner(reference) Review this plan with @Runner",
		});
	});

	it("inserts @ at the current selection and opens the member picker", () => {
		const composer = renderHook(() =>
			useSpaceMentionAuthoring({
				composerDraftScope: {
					kind: "space",
					ownerAccountId: "account-1",
					profileId: "human-1",
					spaceId: "space-1",
				},
				isMembersLoading: false,
				membersErrorMessage: null,
				openMeldProfileId: "human-1",
				snapshot: createMentionOrderingSnapshot(),
				spaceId: "space-1",
			})
		);

		act(() => {
			composer.result.current.onComposerChange("Hello teammate", {
				end: 14,
				start: 6,
			});
		});
		act(() => {
			composer.result.current.onMentionButtonClick();
		});

		expect(composer.result.current.composerText).toBe("Hello @");
		expect(composer.result.current.composerSelection).toEqual({
			end: 7,
			start: 7,
		});
		expect(composer.result.current.mentionPopoverState.kind).toBe(
			"target_picker"
		);
	});

	it("authors a Human Mention without creating Agent addressing copy", () => {
		const humanProfileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const composer = renderHook(() =>
			useSpaceMentionAuthoring({
				composerDraftScope: {
					kind: "space",
					ownerAccountId: "account-1",
					profileId: "human-1",
					spaceId: "space-1",
				},
				isMembersLoading: false,
				membersErrorMessage: null,
				openMeldProfileId: "human-1",
				snapshot: createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							profileId: humanProfileId,
							profileName: "Felix",
						}),
					],
				}),
				spaceId: "space-1",
			})
		);

		act(() => {
			composer.result.current.onComposerChange("@", { end: 1, start: 1 });
		});
		act(() => {
			composer.result.current.onMentionItemSelect(0, "mention");
		});

		expect(composer.result.current.addressingTargets).toEqual([
			expect.objectContaining({
				profileId: humanProfileId,
				relation: "mention",
			}),
		]);
		expect(composer.result.current.addressingSummary).toBeNull();
		expect(
			composer.result.current.prepareSubmission("Members are required.")
				.messageEnvelope
		).toEqual({
			activationTargets: [],
			mentionTargets: [humanProfileId],
			referenceTargets: [],
			text: "@Felix",
		});
	});
});

describe("buildSpaceMentionTargetItems", () => {
	it("orders non-recent mention targets by the same visible status order as the members panel", () => {
		const items = buildSpaceMentionTargetItems({
			query: "@",
			snapshot: createMentionOrderingSnapshot(),
		});

		expect(items.map((item) => item.suggestion.profileName)).toEqual([
			"C Available Agent",
			"B Unavailable Agent",
			"A Offline Agent",
			"B Live Human",
			"A Away Human",
		]);
		expect(items.map((item) => item.memberEntry.profileName)).toEqual(
			items.map((item) => item.suggestion.profileName)
		);
	});

	it("keeps recent mention targets first within their own kind group", () => {
		const items = buildSpaceMentionTargetItems({
			query: "@",
			recentProfileIds: [
				"agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
				"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			],
			snapshot: createMentionOrderingSnapshot(),
		});

		// Agents always precede humans so this flat list matches the popover's
		// Agents/Humans sectioned rendering — when they diverge, the highlighted
		// row desyncs from the item that Enter/click actually selects. Recency
		// therefore floats a target to the top of its own kind group rather than
		// across the whole list: the recent "A Offline Agent" leads the agents,
		// and the recent "A Away Human" leads the humans.
		expect(items.map((item) => item.suggestion.profileName)).toEqual([
			"A Offline Agent",
			"C Available Agent",
			"B Unavailable Agent",
			"A Away Human",
			"B Live Human",
		]);
		expect(items.map((item) => item.memberEntry.profileName)).toEqual(
			items.map((item) => item.suggestion.profileName)
		);
	});
});

describe("buildSpaceComposerAddressingSummary", () => {
	it("states the Agent action for a single structured target", () => {
		expect(
			buildSpaceComposerAddressingSummary([
				{
					profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					relation: "wake",
					text: "@Runner",
				},
			])
		).toBe("Waking 1 agent");
	});

	it("summarizes multiple structured relations without changing them", () => {
		expect(
			buildSpaceComposerAddressingSummary([
				{
					profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					relation: "wake",
					text: "@Runner",
				},
				{
					profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
					relation: "wake",
					text: "@Reviewer",
				},
				{
					profileId: "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
					relation: "reference",
					text: "@Mira",
				},
			])
		).toBe("Waking 2 agents · Referencing 1 agent");
	});

	it("does not expose a CC relation in the multi-target summary", () => {
		expect(
			buildSpaceComposerAddressingSummary([
				{
					profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					relation: "wake",
					text: "@Runner",
				},
				{
					profileId: "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
					relation: "reference",
					text: "@Mira",
				},
			])
		).toBe("Waking 1 agent · Referencing 1 agent");
	});

	it("counts each profile once and uses its first authored relation", () => {
		expect(
			buildSpaceComposerAddressingSummary([
				{
					profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					relation: "wake",
					text: "@Runner",
				},
				{
					profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					relation: "reference",
					text: "@Runner",
				},
				{
					profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
					relation: "wake",
					text: "@Reviewer",
				},
			])
		).toBe("Waking 2 agents");
	});

	it("omits Human Mentions from the Agent-only summary", () => {
		expect(
			buildSpaceComposerAddressingSummary([
				{
					profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					relation: "mention",
					text: "@Felix",
				},
			])
		).toBeNull();
	});
});

describe("buildSpaceComposerAddressingTargets", () => {
	it("shows the first relation when the same profile occurs more than once", () => {
		const runnerProfileId = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

		expect(
			buildSpaceComposerAddressingTargets({
				mentions: [
					{
						profileId: runnerProfileId,
						relation: "wake",
						text: "@Runner",
					},
					{
						profileId: runnerProfileId,
						relation: "reference",
						text: "@Runner",
					},
				],
				snapshot: createSpaceMembersSnapshot({
					agents: [
						createSpaceMemberAgentSnapshot({
							agentWakeAvailability: { status: "available_for_wake" },
							profileId: runnerProfileId,
							profileName: "Runner",
						}),
					],
				}),
			})
		).toEqual([
			expect.objectContaining({
				profileId: runnerProfileId,
				relation: "wake",
			}),
		]);
	});
});

describe("resolveSpaceComposerAddressingMentions", () => {
	it("shows the earlier canonical relation when an authored duplicate appears later", () => {
		const runnerProfileId = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const text = "@Runner(wake) Review this with @Runner";

		expect(
			resolveSpaceComposerAddressingMentions({
				authoredMentions: [
					{
						profileId: runnerProfileId,
						relation: "reference",
						start: text.lastIndexOf("@Runner"),
						text: "@Runner",
					},
				],
				snapshot: createSpaceMembersSnapshot({
					agents: [
						createSpaceMemberAgentSnapshot({
							agentWakeAvailability: { status: "available_for_wake" },
							profileId: runnerProfileId,
							profileName: "Runner",
						}),
					],
				}),
				text,
			})
		).toEqual([
			{
				profileId: runnerProfileId,
				relation: "wake",
			},
		]);
	});
});

function createMentionOrderingSnapshot() {
	return createSpaceMembersSnapshot({
		agents: [
			createSpaceMemberAgentSnapshot({
				profileName: "A Offline Agent",
				profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
				agentWakeAvailability: { status: "offline_for_wake" },
			}),
			createSpaceMemberAgentSnapshot({
				profileName: "B Unavailable Agent",
				profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
				agentWakeAvailability: {
					action: "check_status",
					badgeLabel: "Unavailable",
					category: "unavailable",
					isRefreshing: false,
					label: "Unavailable for Wake",
					phase: "unavailable",
					reasonCode: "agent_execution.unavailable",
					status: "unavailable_for_wake",
					summary: "This agent cannot reply right now.",
					tooltip: "Unavailable for Wake",
				},
			}),
			createSpaceMemberAgentSnapshot({
				profileName: "C Available Agent",
				profileId: "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
				agentWakeAvailability: { status: "available_for_wake" },
			}),
		],
		humans: [
			createSpaceMemberHumanSnapshot({
				liveNow: false,
				profileName: "A Away Human",
				profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			}),
			createSpaceMemberHumanSnapshot({
				liveNow: true,
				profileName: "B Live Human",
				profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
			}),
		],
	});
}
