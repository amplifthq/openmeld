import {
	createSpaceMemberAgentSnapshot,
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	renderHook as renderTestingHook,
	waitFor,
} from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
	buildSpaceComposerAddressingTargets,
	buildSpaceMentionTargetItems,
	resolveDefaultSpaceComposerMentionRelation,
	resolveSpaceComposerAddressingMentions,
	useSpaceMentionAuthoring,
} from "./use-space-mention-authoring";

describe("useSpaceMentionAuthoring composer drafts", () => {
	it("keeps typed Thread text unchanged when member loading completes", () => {
		let loading = true;
		const composer = renderHook(() =>
			useSpaceMentionAuthoring({
				composerDraftScope: {
					kind: "space_thread",
					ownerAccountId: "account-1",
					profileId: "human-1",
					spaceId: "space-1",
					threadId: "thread-continuation",
				},
				isMembersLoading: loading,
				membersErrorMessage: null,
				snapshot: null,
				spaceId: "space-1",
				openMeldProfileId: "human-1",
			})
		);
		expect(composer.result.current.composerText).toBe("");
		act(() =>
			composer.result.current.onComposerEditorChange({
				text: "Please continue",
				authoredMentions: [],
				selection: { start: 15, end: 15 },
			})
		);
		loading = false;
		composer.rerender();
		expect(composer.result.current.composerText).toBe("Please continue");
		expect(composer.result.current.authoredMentions).toEqual([]);
	});
	it.each([
		"available_for_wake",
		"offline_for_wake",
	] as const)("prepares a fresh, target-specific request after expiry while %s", (status) => {
		const profileId = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const { result } = renderHook(() =>
			useSpaceMentionAuthoring({
				composerDraftScope: null,
				isMembersLoading: false,
				membersErrorMessage: null,
				spaceId: "space-1",
				openMeldProfileId: "human-1",
				snapshot: createSpaceMembersSnapshot({
					agents: [
						createSpaceMemberAgentSnapshot({
							profileId,
							profileName: "Runner",
							agentWakeAvailability: { status },
						}),
					],
				}),
			})
		);
		act(() =>
			result.current.composeExpiredDeviceWait({
				sourceSignalId: "expired-source",
				targetProfileId: profileId,
			})
		);
		expect(result.current.composerText).toBe(
			"@Runner Please carry out the request in the referenced message."
		);
		expect(result.current.replyTo).toEqual({ signalId: "expired-source" });
		expect(result.current.authoredMentions).toEqual([
			expect.objectContaining({
				profileId,
				relation: "wake",
			}),
		]);
		const submission = result.current.prepareSubmission("Members unavailable");
		expect(submission.messageEnvelope?.activationTargets).toEqual([profileId]);
		expect(submission.messageEnvelope?.referenceTargets).toEqual([]);
		expect(() =>
			result.current.composeExpiredDeviceWait({
				sourceSignalId: "other-source",
				targetProfileId: profileId,
			})
		).toThrow("current draft");
		expect(result.current.replyTo).toEqual({ signalId: "expired-source" });
	});

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
			firstComposer.result.current.onComposerEditorChange({
				authoredMentions: [],
				selection: { end: 28, start: 28 },
				text: "Keep this plan after refresh",
				restoredFromSignalId: "recalled-1",
			});
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
		expect(
			restoredComposer.result.current.prepareFileOnlySubmission()
				.restoredFromSignalId
		).toBe("recalled-1");
		const submission =
			restoredComposer.result.current.prepareFileOnlySubmission();
		act(() => restoredComposer.result.current.recordPendingSubmission());
		act(() =>
			restoredComposer.result.current.restoreFailedSubmission(submission)
		);
		expect(
			restoredComposer.result.current.prepareFileOnlySubmission()
				.restoredFromSignalId
		).toBe("recalled-1");
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
			composer.result.current.onComposerEditorChange({
				authoredMentions: [],
				selection: { end: 18, start: 18 },
				text: "Draft for thread A",
			});
		});

		composer.rerender({ threadId: "thread-b" });
		expect(composer.result.current.composerText).toBe("");

		act(() => {
			composer.result.current.onComposerEditorChange({
				authoredMentions: [],
				selection: { end: 18, start: 18 },
				text: "Draft for thread B",
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
			firstComposer.result.current.onComposerEditorChange({
				authoredMentions: [
					{
						end: 7,
						profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
						relation: "wake",
						start: 0,
						text: "@Runner",
					},
				],
				selection: { end: 8, start: 8 },
				text: "@Runner ",
			});
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
					version: 2,
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
			composer.result.current.onComposerEditorChange({
				authoredMentions: [
					{
						end: 6,
						profileId: humanProfileId,
						relation: "mention",
						start: 0,
						text: "@Felix",
					},
				],
				selection: { end: 7, start: 7 },
				text: "@Felix ",
			});
		});

		expect(composer.result.current.addressingTargets).toEqual([
			expect.objectContaining({
				profileId: humanProfileId,
				relation: "mention",
			}),
		]);
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
	it.each([
		false,
		true,
	])("defaults an offline Agent to Wake only when waiting is supported: %s", (canWait) => {
		const [item] = buildSpaceMentionTargetItems({
			query: "@runner",
			snapshot: createSpaceMembersSnapshot({
				agents: [
					{
						...createSpaceMemberAgentSnapshot({
							agentWakeAvailability: {
								action: "connect_service",
								badgeLabel: "Offline",
								category: "offline",
								isRefreshing: false,
								label: "Offline for Wake",
								phase: "service_not_connected",
								reasonCode: "service.not_running",
								status: "offline_for_wake",
								summary: "Connect your computer before this agent can reply.",
								tooltip: "Computer not connected",
							},
							profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
							profileName: "Runner",
						}),
						deviceWaitTarget: canWait
							? {
									bindingId: "binding-1",
									openMeldServiceRuntimeId: "runtime-1",
								}
							: undefined,
					},
				],
			}),
		});

		expect(item).toBeDefined();
		expect(
			item
				? resolveDefaultSpaceComposerMentionRelation(
						item.suggestion,
						item.agentMember
					)
				: null
		).toBe(canWait ? "wake" : "reference");
	});

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
	it("uses only the selected relation even when earlier prose looks like a Wake", () => {
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
				relation: "reference",
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

function renderHook<Result, Props>(
	callback: (props: Props) => Result,
	options?: { initialProps: Props }
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return renderTestingHook(callback, {
		...options,
		wrapper: ({ children }: PropsWithChildren) =>
			createElement(QueryClientProvider, { client }, children),
	});
}

it("restores cached identities without restoring Wake authority", async () => {
	const snapshot = createSpaceMembersSnapshot({
		spaceId: "space-cache",
		agents: [
			createSpaceMemberAgentSnapshot({
				profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
				profileName: "Cached agent",
			}),
		],
	});
	const client = new QueryClient();
	const composer = renderTestingHook(
		({ current }: { current: typeof snapshot | null }) =>
			useSpaceMentionAuthoring({
				composerDraftScope: null,
				openMeldProfileId: "human-1",
				spaceId: "space-cache",
				snapshot: current,
				isMembersLoading: !current,
				membersErrorMessage: null,
			}),
		{
			initialProps: { current: snapshot as typeof snapshot | null },
			wrapper: ({ children }: PropsWithChildren) =>
				createElement(QueryClientProvider, { client }, children),
		}
	);
	await waitFor(() =>
		expect(
			client.getQueryData([
				"spaces",
				"member-directory-display",
				"space-cache",
				"human-1",
			])
		).toBeDefined()
	);
	composer.rerender({ current: null });
	const target = composer.result.current.mentionPickerItems.find(
		(item) =>
			item.suggestion.profileId === "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	);
	expect(target?.suggestion.profileName).toBe("Cached agent");
	expect(target?.suggestion.wakeAvailability.status).toBe("blocked");
	expect(
		target && resolveDefaultSpaceComposerMentionRelation(target.suggestion)
	).toBe("wake");
	expect(composer.result.current.mentionEmptyMessage).toBe("Loading members…");
	const saved = client.getQueryData([
		"spaces",
		"member-directory-display",
		"space-cache",
		"human-1",
	]);
	expect(JSON.stringify(saved)).not.toContain("wakeAvailability");
});
