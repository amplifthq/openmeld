import { AGENT_REPLY_FINAL_PURPOSE } from "@openmeld/schemas";
import {
	createSpaceMemberAgentSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type {
	GetSpaceMessageDetailsResponse,
	PostSpaceWakeStopResponse,
	SignalEnvelope,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSpaceTimelineItems } from "#/lib/spaces/timeline";
import { SpaceThreadPanel } from "./space-thread-panel";
import type { SpaceExecutionRecoveryHandler } from "./space-wake-retry";

const FAILED_TEXT_PATTERN = /failed/i;
const REFERENCED_SPACE_ID = "c".repeat(64);

function createFreshExecutionRecoveryHandler() {
	return vi.fn<SpaceExecutionRecoveryHandler>(async (attempt) =>
		attempt.action === null
			? {
					action: "retry_as_new_execution",
					label: "Retry as new execution",
					status: "available",
					warning:
						"This starts a new execution and may run the task and its side effects again.",
				}
			: {
					action: null,
					label: null,
					status: "in_progress",
					warning: null,
				}
	);
}

// The Message Details dialog fetches through `useQuery`. Most tests in this
// file only check for the trigger button's presence, so a static
// "not_applicable everywhere" response is enough to reach the dialog's
// success branch without depending on real network I/O.
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
		"@tanstack/react-query"
	);

	return {
		...actual,
		useQuery: useQueryMock,
	};
});

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		params,
		to,
		...props
	}: {
		children: ReactNode;
		params?: { spaceId: string };
		to: string;
	}) => (
		<a href={params ? to.replace("$spaceId", params.spaceId) : to} {...props}>
			{children}
		</a>
	),
}));

vi.mock("./center-agent-computer-setup-card", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("./center-agent-computer-setup-card")>();
	return {
		...actual,
		CenterAgentComputerSetupCard: (input: {
			sourceSignalId?: string;
			target: { mode: string };
		}) => (
			<section
				data-mode={input.target.mode}
				data-slot="computer-setup-flow"
				data-source-signal-id={input.sourceSignalId}
			>
				Computer setup
			</section>
		),
	};
});

describe("SpaceThreadPanel", () => {
	beforeEach(() => {
		useQueryMock.mockReturnValue({
			data: createMinimalMessageDetailsResponse(),
			isError: false,
			isPending: false,
		});
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		useQueryMock.mockReset();
	});

	it("separates the thread composer with spacing instead of a top divider", () => {
		renderThreadPanel();

		const composer = document.querySelector('[data-slot="thread-composer"]');

		expect(composer).toBeInstanceOf(HTMLElement);
		expect(composer?.className).not.toContain("border-t");
		expect(composer?.className).not.toContain("border-border");
	});

	it("places the current Space pending actions above the visible thread composer", () => {
		renderThreadPanel({
			pendingActionSurface: (
				<section data-testid="pending-agent-actions">Pending actions</section>
			),
		});

		const pendingActions = screen.getByTestId("pending-agent-actions");
		const composer = document.querySelector('[data-slot="thread-composer"]');

		expect(composer).toBeInstanceOf(HTMLElement);
		if (!composer) {
			throw new Error("Expected the visible thread composer.");
		}
		expect(pendingActions.compareDocumentPosition(composer)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
	});

	it("marks only the open thread read after its latest message stays visible", async () => {
		vi.useFakeTimers();
		const onViewedThroughTs = vi.fn().mockResolvedValue(undefined);
		const latestTs = Date.UTC(2026, 4, 27, 10, 0, 9);
		renderThreadPanel({
			onViewedThroughTs,
			signals: [createTextSignal({ ts: latestTs })],
		});

		await act(async () => {
			vi.advanceTimersByTime(800);
			await Promise.resolve();
		});
		expect(onViewedThroughTs).toHaveBeenCalledWith(latestTs);
	});

	it("keeps the Thread composer actions flush and aligned while sending", () => {
		const view = renderThreadPanel();

		expect(
			screen
				.getByRole("textbox", { name: "Reply in thread" })
				.getAttribute("aria-placeholder")
		).toBe("Reply in thread…");
		const mentionButton = screen.getByRole("button", {
			name: "Mention a member",
		});
		const addButton = screen.getByRole("button", { name: "Add to message" });
		expect(mentionButton.parentElement?.className).toContain("gap-0");
		expect(addButton).toHaveProperty("disabled", false);
		expect(mentionButton).toHaveProperty("disabled", false);

		view.rerenderThreadPanel({ isSendingMessage: true });

		expect(
			screen.getByRole("button", { name: "Add to message" })
		).toHaveProperty("disabled", true);
		expect(
			screen.getByRole("button", { name: "Mention a member" })
		).toHaveProperty("disabled", true);
	});

	it("hides redundant mention guidance in an Agent DM thread", () => {
		renderThreadPanel({
			agentDirectConversationKind: "direct_message",
		});

		expect(
			screen.queryByRole("button", { name: "Mention a member" })
		).toBeNull();
		expect(
			screen.queryByText("In this DM, @ is optional. Sending wakes the agent.")
		).toBeNull();
	});

	it("hides the @ button in a Center Agent DM thread", () => {
		renderThreadPanel({
			isCenterAgentDirectMessage: true,
		});

		expect(
			screen.queryByRole("button", { name: "Mention a member" })
		).toBeNull();
	});

	it("renders a live failure only when its trigger message belongs to this Thread", () => {
		renderThreadPanel({
			agentStreams: [
				{
					createdAtMs: Date.UTC(2026, 4, 27, 10, 0, 8),
					dispatchId: "dispatch-thread-1",
					observedRevision: 1,
					profileId: "agt_runner",
					reasonCode: "model.inventory_unavailable",
					sequence: 1,
					spaceId: "space-123",
					status: "failed",
					streamId: "stream-thread-1",
					text: "Runner could not confirm the available models.",
					triggerMessageId: "sig-thread-1",
					updatedAtMs: Date.UTC(2026, 4, 27, 10, 0, 9),
				},
			],
		});

		expect(
			screen.getByText("Runner could not confirm the available models.")
		).toBeTruthy();
	});

	it("opens the durable source message details from live Agent work in a Thread", () => {
		useQueryMock.mockImplementation(
			(options: { queryKey: readonly unknown[] }) =>
				options.queryKey[3] === "sig-thread-1"
					? {
							data: createMinimalMessageDetailsResponse(),
							isError: false,
							isPending: false,
						}
					: {
							data: undefined,
							isError: true,
							isPending: false,
						}
		);
		renderThreadPanel({
			agentStreams: [
				{
					createdAtMs: Date.UTC(2026, 4, 27, 10, 0, 8),
					dispatchId: "dispatch-thread-1",
					observedRevision: 1,
					profileId: "agt_runner",
					reasonCode: null,
					sequence: 1,
					spaceId: "space-123",
					status: "streaming",
					streamId: "stream-thread-1",
					text: "",
					textSequence: 0,
					toolParts: [
						{
							state: "input-available",
							toolCallId: "tool-call-1",
							toolName: "agent_read_files",
							type: "tool",
							work: { key: "source.read", v: 1 },
						},
					],
					triggerMessageId: "sig-thread-1",
					updatedAtMs: Date.UTC(2026, 4, 27, 10, 0, 9),
				},
			],
		});
		const activityTrigger = screen.getByRole("button", {
			name: "Agent is working. Work summary: Reviewing source files…",
		});
		expect(activityTrigger.getAttribute("aria-expanded")).toBe("false");
		const progressRow = activityTrigger.closest(
			'[data-slot="space-message-progress-row"]'
		);
		const bubbleContent = activityTrigger.closest(
			'[data-slot="bubble-content"]'
		);
		const messageRow = activityTrigger.closest("[data-message-row-id]");
		const footer = messageRow?.querySelector('[data-slot="message-footer"]');
		expect(progressRow).not.toBeNull();
		expect(bubbleContent?.contains(progressRow)).toBe(true);
		expect(footer).not.toBeNull();
		expect(progressRow?.compareDocumentPosition(footer as Node)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Open message details" })
		);

		expect(
			screen.getByRole("dialog", { name: "Message details" })
		).toBeTruthy();
		expect(screen.queryByText("Couldn't load message details.")).toBeNull();
	});

	it("uses the shared reserved footer for thread message actions", () => {
		renderThreadPanel();

		const threadMessage = screen
			.getByText("Thread message")
			.closest("[data-signal-id='sig-thread-1']");
		const bubbleRoot = threadMessage?.closest("[data-slot='bubble']");
		const messageRow = threadMessage?.closest(
			"[data-message-row-id='sig-thread-1']"
		);
		const footer = messageRow?.querySelector('[data-slot="message-footer"]');
		const actions = footer?.querySelector(
			'[data-slot="message-footer-primary-actions"]'
		);

		expect(messageRow).not.toBeNull();
		expect(footer).not.toBeNull();
		expect(messageRow?.contains(footer ?? null)).toBe(true);
		expect(bubbleRoot?.contains(footer ?? null)).toBe(false);
		expect(footer?.className).toContain("min-h-7");
		expect(actions?.className).toContain("opacity-0");
		expect(actions?.className).toContain("group-hover/message-row:opacity-100");
		expect(actions?.className).toContain(
			"group-focus-within/message-row:opacity-100"
		);
		expect(
			messageRow?.querySelector("[data-slot='message-hover-actions']")
		).toBeNull();

		const detailsButton = within(footer as HTMLElement).getByRole("button", {
			name: "Message details",
		});
		const copyButton = within(footer as HTMLElement).getByRole("button", {
			name: "Copy message",
		});
		for (const button of [copyButton, detailsButton]) {
			expect(button.className).toContain("size-7");
			expect(button.className).toContain("border-0");
			expect(button.className).toContain("bg-transparent");
		}
	});
	it("uses the member Agent identity in Message details opened from a thread", async () => {
		const details = createMinimalMessageDetailsResponse();
		useQueryMock.mockReturnValue({
			data: {
				...details,
				message: {
					...details.message,
					signalId: "sig-thread-wake",
				},
				wakeContext: {
					clientMessageId: notApplicableFact(),
					sourceSignalId: {
						source: "space_signal",
						state: "recorded",
						value: "sig-thread-wake",
					},
					state: "recorded",
					targets: [
						{
							agentContext: notApplicableAgentContext(),
							status: "pending",
							targetLabel: "Codex 5.6 Sol",
							targetProfileId: TARGET_PROFILE_ID,
						},
					],
				},
			},
			isError: false,
			isPending: false,
		});
		renderThreadPanel({
			membersSnapshot: createWakeReceiptMembersSnapshot(),
			signals: [createWakeTextSignal()],
		});

		const messageRow = document.querySelector(
			'[data-message-row-id="sig-thread-wake"]'
		);
		if (!(messageRow instanceof HTMLElement)) {
			throw new Error("Expected the Wake source row to render.");
		}
		fireEvent.click(
			within(messageRow).getByRole("button", { name: "Message details" })
		);

		const dialog = await screen.findByRole("dialog", {
			name: "Message details",
		});
		expect(
			within(dialog).getByTestId(`space-profile-icon-${TARGET_PROFILE_ID}`)
		).toBeTruthy();
		expect(
			within(dialog).queryByTestId(
				`space-agent-profile-fallback-icon-${TARGET_PROFILE_ID}`
			)
		).toBeNull();
	});

	it("uses the shared Space reference renderer in a thread", () => {
		renderThreadPanel({
			signals: [createTextSignal({ text: `/spaces/${REFERENCED_SPACE_ID}` })],
			spaceReferencesById: new Map([
				[
					REFERENCED_SPACE_ID,
					{ name: "Launch Planning", spaceId: REFERENCED_SPACE_ID },
				],
			]),
		});

		expect(
			screen.getByRole("link", { name: "Open Space Launch Planning" })
		).toBeTruthy();
	});

	it("renders trusted Center Agent computer setup inline without a redundant continuation control", () => {
		const onSendText = vi.fn().mockResolvedValue(undefined);
		renderThreadPanel({
			centerAgentProfileId: "agent-profile-center",
			isCenterAgentDirectMessage: true,
			onSendText,
			orgSlug: "acme",
			signals: [createCenterAgentComputerSetupSignal()],
		});

		const setup = screen.getByText("Computer setup").closest("section");
		expect(setup?.getAttribute("data-mode")).toBe("reconnect");
		expect(setup?.getAttribute("data-source-signal-id")).toBe(
			"sig-thread-computer-setup"
		);
		expect(
			screen.queryByRole("button", { name: "Continue with Center Agent" })
		).toBeNull();
		expect(onSendText).not.toHaveBeenCalled();
	});

	it("renders a durable conversation compaction separator before a thread reply", () => {
		renderThreadPanel({
			signals: [
				{
					data: {
						meta: {
							conversationCompaction: {
								completedAtMs: Date.UTC(2026, 4, 27, 10),
								count: 1,
								v: 1,
							},
							purpose: AGENT_REPLY_FINAL_PURPOSE,
						},
						text: "I kept the important thread context.",
					},
					id: "sig-thread-compacted-reply",
					profile: {
						kind: "agent",
						profileId: TARGET_PROFILE_ID,
						profileName: "Runner",
					},
					spaceId: "space-123",
					ts: Date.UTC(2026, 4, 27, 10, 0, 7),
					type: "signal.text",
					v: 1,
				},
			],
		});

		const markerContent = screen.getByText("Conversation compacted");
		const marker = markerContent.closest("[data-slot='marker']");

		expect(marker?.getAttribute("data-variant")).toBe("separator");
		expect(marker?.getAttribute("data-conversation-compaction-marker")).toBe(
			"true"
		);
		expect(marker?.getAttribute("aria-busy")).toBeNull();
	});

	it("uses Dither for Center Agent replies in an ordinary Space thread", () => {
		const centerAgentProfileId = "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
		renderThreadPanel({
			centerAgentProfileId,
			signals: [
				createTextSignal({
					profileId: centerAgentProfileId,
					profileKind: "agent",
					profileName: "Center Agent",
					text: "Thread coordination update",
				}),
			],
		});

		const avatar = screen.getByTestId(
			`space-center-agent-profile-avatar-${centerAgentProfileId}`
		);
		expect(
			avatar.querySelector("canvas")?.getAttribute("data-profile-avatar-seed")
		).toBe(
			`openmeld-dither-profile-avatar:v1:center-agent:${centerAgentProfileId}`
		);
	});

	it("renders completed Agent Activity once inside its durable thread reply", () => {
		renderThreadPanel({
			signals: [createAgentFinalReplySignal()],
		});

		const activityTriggers = screen.getAllByRole("button", {
			name: "Work summary: Reviewed Space context",
		});
		expect(activityTriggers).toHaveLength(1);
		expect(activityTriggers[0]?.getAttribute("aria-expanded")).toBe("false");

		const bubbleContent = screen
			.getByText("Here is the thread summary.")
			.closest("[data-slot='bubble-content']");
		expect(bubbleContent?.contains(activityTriggers[0] ?? null)).toBe(true);
		const answerElement = screen.getByText("Here is the thread summary.");
		const directChildren = Array.from(bubbleContent?.children ?? []);
		const answerSection = directChildren.find((child) =>
			child.contains(answerElement)
		);
		const activitySection = directChildren.find((child) =>
			child.contains(activityTriggers[0] ?? null)
		);
		expect(directChildren.indexOf(answerSection as Element)).toBeLessThan(
			directChildren.indexOf(activitySection as Element)
		);
	});

	it("removes the gap between consecutive bubbles from the same sender", () => {
		renderThreadPanel({
			signals: [
				createTextSignal({
					id: "sig-thread-first",
					text: "First consecutive thread message",
					ts: Date.UTC(2026, 4, 27, 10, 0, 0),
				}),
				createTextSignal({
					id: "sig-thread-second",
					text: "Second consecutive thread message",
					ts: Date.UTC(2026, 4, 27, 10, 3, 0),
				}),
			],
		});

		const firstMessage = screen
			.getByText("First consecutive thread message")
			.closest("[data-slot='message']");
		const secondMessage = screen
			.getByText("Second consecutive thread message")
			.closest("[data-slot='message']");

		expect(firstMessage?.className).toContain("pt-1.5");
		expect(firstMessage?.className).toContain("pb-0");
		expect(firstMessage?.className).not.toContain("py-2");
		expect(secondMessage?.className).toContain("pt-1");
		expect(secondMessage?.className).toContain("pb-1.5");
		expect(secondMessage?.className).not.toContain("py-2");
	});

	it("renders structured Wake targets as inline Agent identities in a read-only thread", () => {
		renderThreadPanel({
			membersSnapshot: createWakeReceiptMembersSnapshot(),
			readOnly: true,
			signals: [
				createWakeTextSignal({
					activationTargets: [TARGET_PROFILE_ID, SECOND_TARGET_PROFILE_ID],
					text: "@Codex 5.6 Sol coordinate with @Claude Opus 4.8.",
				}),
			],
		});

		expect(screen.queryByTestId("space-message-wake-receipt")).toBeNull();
		expect(screen.getByText("Codex 5.6 Sol").tagName).toBe("STRONG");
		expect(screen.getByText("Claude Opus 4.8").tagName).toBe("STRONG");
		expect(
			screen.getByTestId(`space-profile-icon-${TARGET_PROFILE_ID}`)
		).toBeTruthy();
		expect(
			screen.getByTestId(`space-profile-icon-${SECOND_TARGET_PROFILE_ID}`)
		).toBeTruthy();
		expect(screen.queryByRole("textbox")).toBeNull();
	});

	it("renders an unanchored terminal_failure notice via the outcome row, with a Message details action", () => {
		renderThreadPanel({
			signals: [
				createSystemNoticeSignal({
					id: "sig-thread-failure",
					noticeType: "terminal_failure",
					text: "Runner could not reply in this thread.",
				}),
			],
		});

		expect(
			screen.getByText("Runner could not reply in this thread.")
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Open message details" })
		).toBeTruthy();
	});

	it("indents the unanchored thread outcome row to match the message content column instead of sitting flush against the edge", () => {
		renderThreadPanel({
			signals: [
				createSystemNoticeSignal({
					id: "sig-thread-failure",
					noticeType: "terminal_failure",
					text: "Runner could not reply in this thread.",
				}),
			],
		});

		const row = screen
			.getByText("Runner could not reply in this thread.")
			.closest("[data-message-row-id='sig-thread-failure']");
		const scrollerItem = row?.closest("[data-slot='message-scroller-item']");
		expect(row?.className).toContain("px-3");
		expect(row?.className).toContain("py-2");
		expect(scrollerItem?.getAttribute("data-message-id")).toBe(
			"sig-thread-failure"
		);
		expect(scrollerItem?.getAttribute("data-scroll-anchor")).toBe("false");
	});

	it("moves an anchored thread failure into the source message footer", () => {
		const detailedFailure =
			"The model provider was unreachable. Check provider status or network access, then wake the Agent again.";
		renderThreadPanel({
			membersSnapshot: createWakeReceiptMembersSnapshot(),
			signals: [
				createTextSignal({
					id: "sig-thread-wake",
					text: "@Runner(wake) please investigate",
					ts: Date.UTC(2026, 4, 27, 10, 0, 0),
				}),
				createSystemNoticeSignal({
					actorProfileId: TARGET_PROFILE_ID,
					id: "sig-thread-failure",
					noticeType: "terminal_failure",
					replyToSignalId: "sig-thread-wake",
					text: detailedFailure,
					ts: Date.UTC(2026, 4, 27, 10, 0, 30),
				}),
			],
		});

		const sourceMessage = screen
			.getByText("@Runner(wake) please investigate")
			.closest("[data-message-row-id='sig-thread-wake']");
		expect(sourceMessage).not.toBeNull();
		const footer = sourceMessage?.querySelector("[data-slot='message-footer']");
		expect(footer).not.toBeNull();
		expect(
			within(footer as HTMLElement).getByText("Codex 5.6 Sol couldn’t reply")
		).toBeTruthy();
		expect(
			within(sourceMessage as HTMLElement).queryByText(detailedFailure)
		).toBeNull();
		expect(
			within(sourceMessage as HTMLElement).queryByTestId("space-outcome-row")
		).toBeNull();
		expect(
			within(footer as HTMLElement).getByRole("button", {
				name: "Message details",
			})
		).toBeTruthy();
	});

	it("offers thread recovery only inside Message details", async () => {
		const onRecoverExecution = createFreshExecutionRecoveryHandler();
		renderThreadPanel({
			onRecoverExecution,
			signals: [
				createWakeTextSignal({
					text: "@Runner(wake) please investigate",
				}),
				createSystemNoticeSignal({
					actorProfileId: TARGET_PROFILE_ID,
					dispatchId: "dispatch-1",
					id: "sig-thread-failure",
					noticeType: "terminal_failure",
					replyToSignalId: "sig-thread-wake",
					text: "Runner could not reply.",
				}),
			],
		});

		expect(
			screen.queryByRole("button", { name: "Retry as new execution" })
		).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Message details" }));
		const retry = await screen.findByRole("button", {
			name: "Retry as new execution",
		});
		fireEvent.click(retry);
		await waitFor(() => {
			expect(onRecoverExecution).toHaveBeenCalledWith({
				action: "retry_as_new_execution",
				dispatchId: "dispatch-1",
				operationId: expect.any(String),
				resultRef: null,
				targetProfileId: TARGET_PROFILE_ID,
			});
		});
	});

	it("keeps thread footer recovery fenced to one operation", async () => {
		const execution = createVoidDeferred();
		const onRecoverExecution = vi.fn<SpaceExecutionRecoveryHandler>(
			async (attempt) => {
				if (attempt.action === null) {
					return {
						action: "recover_result",
						label: "Recover result",
						status: "available",
						warning: null,
					};
				}
				await execution.promise;
				return {
					action: null,
					label: null,
					status: "recovered",
					warning: null,
				};
			}
		);
		renderThreadPanel({
			onRecoverExecution,
			signals: [
				createWakeTextSignal({
					text: "@Runner(wake) please investigate",
				}),
				createSystemNoticeSignal({
					actorProfileId: TARGET_PROFILE_ID,
					dispatchId: "dispatch-thread",
					id: "sig-thread-failure",
					noticeType: "terminal_failure",
					reasonCode: "runtime.progress_stale",
					replyToSignalId: "sig-thread-wake",
					text: "Runner stopped making progress.",
				}),
				createSystemNoticeSignal({
					actorProfileId: TARGET_PROFILE_ID,
					dispatchId: "dispatch-thread",
					id: "sig-thread-recovery",
					noticeType: "execution_recovery_available",
					replyToSignalId: "sig-thread-wake",
					resultRef: "dispatch-thread::result-1",
					text: "A completed result is ready to recover.",
				}),
			],
		});

		expect(screen.queryByRole("button", { name: "Recover result" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Message details" }));
		const recoverButton = await screen.findByRole("button", {
			name: "Recover result",
		});
		fireEvent.click(recoverButton);
		fireEvent.click(recoverButton);

		expect(
			onRecoverExecution.mock.calls.filter(
				([attempt]) => attempt.action === "recover_result"
			)
		).toHaveLength(1);
		execution.resolve();
		await waitFor(() => {
			expect(
				screen.queryByRole("dialog", { name: "Message details" })
			).toBeNull();
		});
	});

	it("aligns anchored thread failure footers with their source messages", () => {
		const { rerenderThreadPanel } = renderThreadPanel({
			selfProfileId: "human-profile-1",
			signals: [
				createTextSignal({
					profileId: "human-profile-1",
					id: "sig-thread-wake",
					text: "@Runner(wake) please investigate",
				}),
				createSystemNoticeSignal({
					id: "sig-thread-failure",
					noticeType: "terminal_failure",
					replyToSignalId: "sig-thread-wake",
					text: "Runner could not reply.",
				}),
			],
		});

		let sourceMessage = screen
			.getByText("@Runner(wake) please investigate")
			.closest("[data-message-row-id='sig-thread-wake']");
		expect(
			sourceMessage?.querySelector("[data-slot='message-footer']")?.className
		).toContain("justify-end");

		rerenderThreadPanel({
			selfProfileId: "human-profile-1",
			signals: [
				createTextSignal({
					profileName: "Mira",
					profileId: "human-profile-2",
					id: "sig-thread-wake",
					text: "@Runner(wake) please investigate",
				}),
				createSystemNoticeSignal({
					id: "sig-thread-failure",
					noticeType: "terminal_failure",
					replyToSignalId: "sig-thread-wake",
					text: "Runner could not reply.",
				}),
			],
		});
		sourceMessage = screen
			.getByText("@Runner(wake) please investigate")
			.closest("[data-message-row-id='sig-thread-wake']");
		expect(
			sourceMessage?.querySelector("[data-slot='message-footer']")?.className
		).toContain("justify-start");
	});

	it("gives a stopped Wake a muted outcome row in the thread instead of a destructive one", () => {
		renderThreadPanel({
			signals: [
				createSystemNoticeSignal({
					id: "sig-thread-stopped",
					noticeType: "wake_stopped",
					text: "Wake was stopped for Runner.",
				}),
			],
		});

		const marker = screen
			.getByText("Wake was stopped for Runner.")
			.closest("[data-slot='marker']");
		expect(marker?.className).toContain("text-muted-foreground");
		expect(marker?.className).not.toContain("text-destructive");
	});

	it("shows the outcome row text but hides the Message details action for a read-only thread viewer", () => {
		renderThreadPanel({
			readOnly: true,
			signals: [
				createSystemNoticeSignal({
					id: "sig-thread-failure",
					noticeType: "terminal_failure",
					text: "Runner could not reply in this thread.",
				}),
			],
		});

		expect(
			screen.getByText("Runner could not reply in this thread.")
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Open message details" })
		).toBeNull();
	});

	it("shows delayed local pending copy inside the thread timeline", () => {
		const createdAtMs = Date.UTC(2026, 4, 27, 10, 0, 7);
		vi.useFakeTimers();
		vi.setSystemTime(createdAtMs + 8000);

		renderThreadPanel({
			signals: [
				createTextSignal({
					id: "pending:thread-message-1",
					text: "Pending thread message",
					ts: createdAtMs,
				}),
			],
		});

		expect(screen.getByText("Pending thread message")).toBeTruthy();
		expect(screen.getByText("Still sending...")).toBeTruthy();
		expect(screen.queryByText(FAILED_TEXT_PATTERN)).toBeNull();
	});

	it("places the speaking profile control next to the thread send action", () => {
		renderThreadPanel({
			profileControl: <button type="button">Speaking as Mira</button>,
		});

		const profileControl = screen.getByRole("button", {
			name: "Speaking as Mira",
		});
		const sendButton = screen.getByRole("button", { name: "Send reply" });

		expect(profileControl.compareDocumentPosition(sendButton)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
	});

	it("lets a person send a ready file in a thread without filler text", async () => {
		const onSend = vi.fn(async () => undefined);
		renderThreadPanel({
			composerFiles: [createReadyComposerFile()],
			onSend,
		});

		expect(screen.getByText("1 file ready to send")).toBeTruthy();
		const sendButton = screen.getByRole("button", { name: "Send reply" });
		expect(sendButton.hasAttribute("disabled")).toBe(false);
		fireEvent.click(sendButton);

		await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
	});

	it("sends a thread reply while excluding a failed file", async () => {
		const onSend = vi.fn(async () => undefined);
		renderThreadPanel({
			composerFiles: [createFailedComposerFile()],
			composerText: "Keep the reply draft",
			onSend,
		});

		expect(
			screen.getByText("1 file couldn't be uploaded and won't be sent.")
		).toBeTruthy();
		const sendButton = screen.getByRole("button", { name: "Send reply" });
		expect(sendButton).toHaveProperty("disabled", false);
		fireEvent.click(sendButton);
		await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
	});

	it("keeps a recently completed root Wake terminal when its thread omits the top-level reply", () => {
		const wakeSignal = createWakeTextSignal();
		vi.useFakeTimers();
		vi.setSystemTime(wakeSignal.ts + 2 * 60 * 1000);

		renderThreadPanel({
			signals: [wakeSignal],
			spaceTimelineItems: buildSpaceTimelineItems({
				envelopes: [wakeSignal, createAgentWakeReplySignal()],
				membersSnapshot: null,
			}),
		});

		expect(screen.getByText("@runner please triage this")).toBeTruthy();
		expect(screen.queryByText("Starting Wake")).toBeNull();
		expect(screen.queryByText("Stop")).toBeNull();
	});

	it("does not let another Wake's later outcome close an active thread Wake", () => {
		const wakeSignal = createWakeTextSignal();
		vi.useFakeTimers();
		vi.setSystemTime(wakeSignal.ts + 2 * 60 * 1000);

		renderThreadPanel({
			onWakeStopRequest: vi.fn(),
			signals: [wakeSignal],
			spaceTimelineItems: buildSpaceTimelineItems({
				envelopes: [
					wakeSignal,
					createSystemNoticeSignal({
						actorProfileId: TARGET_PROFILE_ID,
						id: "sig-other-wake-stopped",
						noticeType: "wake_stopped",
						replyToSignalId: "sig-other-wake",
						text: "Another Wake was stopped for Runner.",
						ts: wakeSignal.ts + 60_000,
					}),
				],
				membersSnapshot: null,
			}),
		});

		expect(screen.getAllByText("Starting Wake")).not.toHaveLength(0);
		expect(
			screen.getByRole("button", { name: "Stop Wake for this agent" })
		).toBeTruthy();
	});

	it("confirms and requests Stop for an active Wake in the thread timeline", async () => {
		const onWakeStopRequest = vi
			.fn()
			.mockResolvedValue(createWakeStopResponse());
		renderThreadPanel({
			ephemeralActivityItems: [createWakeProgressItem()],
			onWakeStopRequest,
			signals: [createWakeTextSignal()],
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Stop Wake for @runner" })
		);
		const dialog = within(
			screen.getByRole("dialog", { name: "Stop this Wake?" })
		);
		fireEvent.click(dialog.getByRole("button", { name: "Stop Wake" }));

		await waitFor(() => {
			expect(onWakeStopRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					selector: {
						by: "source_signal",
						sourceSignalId: "sig-thread-wake",
						targetProfileId: TARGET_PROFILE_ID,
					},
					status: "active",
				})
			);
		});
	});

	it("does not request Stop for an unsupported active Wake in the thread timeline", () => {
		const onWakeStopRequest = vi.fn();
		renderThreadPanel({
			ephemeralActivityItems: [
				createWakeProgressItem({
					wakeStopEligibility: UNSUPPORTED_WAKE_STOP_ELIGIBILITY,
				}),
			],
			onWakeStopRequest,
			signals: [createWakeTextSignal()],
		});

		expect(screen.queryByText("Stop")).toBeNull();
		expect(
			screen.queryByRole("dialog", { name: "Stop this Wake?" })
		).toBeNull();
		expect(onWakeStopRequest).not.toHaveBeenCalled();
	});

	it("keeps a local-agent question actionable inside its source thread", async () => {
		const onAgentInteractionResponse = vi.fn().mockResolvedValue(undefined);
		renderThreadPanel({
			ephemeralActivityItems: [
				{
					...createWakeProgressItem(),
					pendingInteraction: {
						canRespond: true,
						expiresAtMs: Date.UTC(2026, 6, 29),
						interactionId: "interaction-thread",
						kind: "question",
						request: {
							expiresAtMs: Date.UTC(2026, 6, 29),
							interactionId: "interaction-thread",
							kind: "question",
							questions: [
								{
									allowOther: false,
									multiple: false,
									options: [
										{
											label: "Run focused tests",
											optionId: "focused",
										},
									],
									prompt: "How should I validate this change?",
									questionId: "validation",
								},
							],
							requestedAtMs: Date.UTC(2026, 6, 28),
							title: "Choose validation",
							v: 1,
						},
						requestedAtMs: Date.UTC(2026, 6, 28),
					},
					runtimeCoordinatorExecutionId: "rce_thread",
				},
			],
			onAgentInteractionResponse,
			signals: [createWakeTextSignal()],
		});

		const sourceMessage = screen
			.getByText("@runner please triage this")
			.closest("[data-signal-id='sig-thread-wake']");
		expect(sourceMessage).not.toBeNull();
		const source = within(sourceMessage as HTMLElement);
		expect(source.getByText("How should I validate this change?")).toBeTruthy();
		fireEvent.click(source.getByRole("radio", { name: "Run focused tests" }));
		fireEvent.click(source.getByRole("button", { name: "Submit answers" }));

		await waitFor(() => {
			expect(onAgentInteractionResponse).toHaveBeenCalledWith({
				interactionId: "interaction-thread",
				response: {
					answers: [
						{
							questionId: "validation",
							values: ["focused"],
						},
					],
					kind: "question",
				},
				runtimeCoordinatorExecutionId: "rce_thread",
			});
		});
	});

	it("keeps reused provider interaction ids isolated across inline thread Wake executions", () => {
		const view = renderThreadPanel({
			ephemeralActivityItems: [
				createInlineThreadPermissionProgressItem({
					runtimeCoordinatorExecutionId: "rce-thread-first",
					title: "Allow the first thread execution?",
				}),
			],
			onAgentInteractionResponse: vi.fn().mockResolvedValue(undefined),
			signals: [createWakeTextSignal()],
		});

		fireEvent.click(screen.getByRole("radio", { name: "Allow once" }));
		view.rerenderThreadPanel({
			ephemeralActivityItems: [
				createInlineThreadPermissionProgressItem({
					runtimeCoordinatorExecutionId: "rce-thread-second",
					title: "Allow the second thread execution?",
				}),
			],
		});

		expect(screen.getByText("Allow the second thread execution?")).toBeTruthy();
		expect(
			screen
				.getByRole("radio", { name: "Allow once" })
				.getAttribute("aria-checked")
		).toBe("false");
	});

	it("opens future permission settings from a permission request in a thread", () => {
		const onEditAgentProfile = vi.fn();
		renderThreadPanel({
			editableAgentProfileIds: new Set([TARGET_PROFILE_ID]),
			ephemeralActivityItems: [
				{
					...createWakeProgressItem(),
					pendingInteraction: {
						canRespond: true,
						expiresAtMs: Date.UTC(2026, 6, 29),
						interactionId: "interaction-thread-permission",
						kind: "permission",
						request: {
							expiresAtMs: Date.UTC(2026, 6, 29),
							interactionId: "interaction-thread-permission",
							kind: "permission",
							options: [
								{
									intent: "allow_once",
									label: "Allow once",
									optionId: "allow-once",
								},
							],
							requestedAtMs: Date.UTC(2026, 6, 28),
							subject: { type: "tool" },
							title: "Use this tool?",
							v: 1,
						},
						requestedAtMs: Date.UTC(2026, 6, 28),
					},
					runtimeCoordinatorExecutionId: "rce_thread_permission",
				},
			],
			onAgentInteractionResponse: vi.fn().mockResolvedValue(undefined),
			onEditAgentProfile,
			signals: [createWakeTextSignal()],
		});

		const sourceMessage = screen
			.getByText("@runner please triage this")
			.closest("[data-signal-id='sig-thread-wake']");
		expect(sourceMessage).not.toBeNull();
		fireEvent.click(
			within(sourceMessage as HTMLElement).getByRole("button", {
				name: "Edit Agent Profile",
			})
		);

		expect(onEditAgentProfile).toHaveBeenCalledWith(TARGET_PROFILE_ID);
	});

	it("opens the exact structured Wake target from an inline Agent mention", () => {
		renderThreadPanel({
			membersSnapshot: createWakeReceiptMembersSnapshot(),
			signals: [
				createWakeTextSignal({
					text: "@Codex 5.6 Sol please review this.",
				}),
			],
		});

		fireEvent.click(
			screen.getByRole("button", {
				name: "Open Codex 5.6 Sol profile (Wake)",
			})
		);

		const dialog = within(screen.getByRole("dialog"));
		expect(
			dialog.getByRole("heading", { name: "How this Agent works" })
		).toBeTruthy();
		expect(dialog.getAllByText("Codex 5.6 Sol").length).toBeGreaterThan(0);
		expect(dialog.getByText("Available for Wake")).toBeTruthy();
	});
});

const TARGET_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";
const SECOND_TARGET_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";
const CANCEL_BACKED_WAKE_STOP_ELIGIBILITY = {
	controlMode: "cancel",
	reasonCode: null,
	reliability: "native_cancel",
	status: "eligible",
} satisfies NonNullable<WakeProgressItem["wakeStopEligibility"]>;
const UNSUPPORTED_WAKE_STOP_ELIGIBILITY = {
	controlMode: null,
	reasonCode: "agent_controller_interface.stop_unsupported",
	reliability: "unsupported",
	status: "not_eligible",
} satisfies NonNullable<WakeProgressItem["wakeStopEligibility"]>;

function renderThreadPanel(
	overrides: Partial<ComponentProps<typeof SpaceThreadPanel>> = {}
) {
	const defaultProps = {
		activeThread: {
			createdAt: "2026-04-11T00:00:00.000Z",
			createdByProfileId: "human-profile-1",
			rootSignalId: "sig-root",
			spaceId: "space-123",
			threadId: "thread-1",
			updatedAt: "2026-04-11T00:00:00.000Z",
		},
		agentRecoveryPlansByProfileId: new Map(),
		agentDirectConversationKind: null,
		agentStreams: [],
		composerBlockedWakeProfileId: null,
		composerErrorMessage: null,
		composerText: "",
		composerFiles: [],
		composerFileLimitReached: false,
		currentOwnerUserId: null,
		ephemeralActivityItems: [],
		isAgentRecoveryPending: () => false,
		isDiagnosticReportPending: () => false,
		isDiagnosticReportSent: () => false,
		isSendingMessage: false,
		membersSnapshot: null,
		modelCatalog: null,
		onAgentRecoveryAction: async () => undefined,
		onClose: () => undefined,
		onComposerEditorChange: () => undefined,
		onAddComposerFiles: async () => undefined,
		onRemoveComposerFile: () => undefined,
		onMentionButtonClick: () => undefined,
		onReportMessage: async () => undefined,
		onOpenSpaceFile: () => undefined,
		onSend: async () => undefined,
		readOnly: false,
		selfAvatarImageUrl: "https://example.com/felix.png",
		selfProfileId: "human-profile-1",
		signals: [createTextSignal()],
		signalsErrorMessage: null,
		signalsIsLoading: false,
		spaceTimelineItems: [],
		textareaRef: { current: null },
		wakeFailureTargetContextsByProfileId: new Map(),
	} satisfies ComponentProps<typeof SpaceThreadPanel>;
	const renderResult = render(
		<SpaceThreadPanel {...defaultProps} {...overrides} />
	);
	return {
		...renderResult,
		rerenderThreadPanel: (
			nextOverrides: Partial<ComponentProps<typeof SpaceThreadPanel>>
		) =>
			renderResult.rerender(
				<SpaceThreadPanel {...defaultProps} {...overrides} {...nextOverrides} />
			),
	};
}

function createReadyComposerFile() {
	return {
		upload: {
			id: "11111111-1111-4111-8111-111111111111",
			expiresAt: "2026-08-30T00:00:00.000Z",
			mimeType: "application/pdf",
			name: "launch-brief.pdf",
			sizeBytes: 4096,
		},
		errorMessage: null,
		errorRequestId: null,
		fileName: "launch-brief.pdf",
		localId: "local-file-1",
		mimeType: "application/pdf",
		previewUrl: null,
		progress: 1,
		publishMutationId: "publish-file-1",
		status: "ready" as const,
	};
}

function createFailedComposerFile() {
	return {
		upload: null,
		errorMessage: "OpenMeld couldn't add this file. Try again.",
		errorRequestId: "request-file-failed",
		fileName: "broken.pdf",
		localId: "local-file-failed",
		mimeType: "application/pdf",
		previewUrl: null,
		progress: 100,
		publishMutationId: "publish-file-failed",
		status: "failed" as const,
	};
}

function createTextSignal(
	input: {
		id?: string;
		profileId?: string;
		profileKind?: "agent" | "human";
		profileName?: string;
		text?: string;
		ts?: number;
	} = {}
): SignalEnvelope {
	return {
		data: {
			text: input.text ?? "Thread message",
		},
		id: input.id ?? "sig-thread-1",
		profile: {
			kind: input.profileKind ?? "human",
			profileId: input.profileId ?? "human-profile-1",
			profileName: input.profileName ?? "Felix",
		},
		spaceId: "space-123",
		ts: input.ts ?? Date.UTC(2026, 4, 27, 10, 0, 7),
		type: "signal.text",
		v: 1,
	};
}

function createCenterAgentComputerSetupSignal(): SignalEnvelope {
	const text = "Reconnect this computer.";
	return {
		data: {
			messageEnvelope: {
				activationTargets: [],
				navigationAction: {
					label: "Reconnect this computer",
					target: {
						connectedComputerId: "computer-1",
						kind: "computer_setup",
						mode: "reconnect",
					},
					url: "http://localhost:5173/o/acme/connect?connectedComputerId=computer-1&session=fresh",
				},
				referenceTargets: [],
				text,
			},
			meta: {
				purpose: AGENT_REPLY_FINAL_PURPOSE,
			},
			text,
		},
		id: "sig-thread-computer-setup",
		profile: {
			kind: "agent",
			profileId: "agent-profile-center",
			profileName: "Center Agent",
		},
		spaceId: "space-123",
		ts: Date.UTC(2026, 4, 27, 10),
		type: "signal.text",
		v: 1,
	};
}

function createWakeTextSignal(
	input: { activationTargets?: readonly string[]; text?: string } = {}
): SignalEnvelope {
	const text = input.text ?? "@runner please triage this";
	return {
		data: {
			messageEnvelope: {
				activationTargets: [
					...(input.activationTargets ?? [TARGET_PROFILE_ID]),
				],
				referenceTargets: [],
				text,
			},
			meta: {
				clientMessageId: "client-message-1",
			},
			text,
		},
		id: "sig-thread-wake",
		profile: {
			kind: "human",
			profileId: "human-profile-1",
			profileName: "Felix",
		},
		spaceId: "space-123",
		ts: Date.UTC(2026, 4, 27, 10),
		type: "signal.text",
		v: 1,
	};
}

function createAgentWakeReplySignal(): SignalEnvelope {
	return {
		data: {
			messageEnvelope: {
				activationTargets: [],
				referenceTargets: [],
				replyToSignalId: "sig-thread-wake",
				text: "Wake completed.",
			},
			text: "Wake completed.",
		},
		id: "sig-thread-wake-reply",
		profile: {
			kind: "agent",
			profileId: TARGET_PROFILE_ID,
			profileName: "Runner",
		},
		spaceId: "space-123",
		ts: Date.UTC(2026, 4, 27, 10, 1),
		type: "signal.text",
		v: 1,
	};
}

function createAgentFinalReplySignal(): SignalEnvelope {
	return {
		data: {
			meta: {
				agentActivity: {
					v: 1,
					steps: [
						{
							toolName: "openmeld_read_space_context",
							state: "output-available",
							work: {
								v: 1,
								key: "space.context.read",
							},
						},
					],
					truncated: false,
				},
				purpose: AGENT_REPLY_FINAL_PURPOSE,
			},
			text: "Here is the thread summary.",
		},
		id: "sig-thread-agent-final",
		profile: {
			kind: "agent",
			profileId: TARGET_PROFILE_ID,
			profileName: "Runner",
		},
		spaceId: "space-123",
		ts: Date.UTC(2026, 4, 27, 10, 2),
		type: "signal.text",
		v: 1,
	};
}

function createWakeReceiptMembersSnapshot() {
	return createSpaceMembersSnapshot({
		agents: [
			createSpaceMemberAgentSnapshot({
				profileId: TARGET_PROFILE_ID,
				profileName: "Codex 5.6 Sol",
			}),
			createSpaceMemberAgentSnapshot({
				profileId: SECOND_TARGET_PROFILE_ID,
				profileName: "Claude Opus 4.8",
			}),
		],
	});
}

function createSystemNoticeSignal(input: {
	actorProfileId?: string;
	dispatchId?: string;
	id: string;
	noticeType: string;
	reasonCode?: string;
	replyToSignalId?: string;
	resultRef?: string;
	text: string;
	ts?: number;
}): SignalEnvelope {
	return {
		data: {
			noticeType: input.noticeType,
			dispatchId: input.dispatchId ?? "dispatch-1",
			text: input.text,
			generatedBy: "openmeld",
			...(input.actorProfileId ? { actorProfileId: input.actorProfileId } : {}),
			...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
			...(input.resultRef ? { resultRef: input.resultRef } : {}),
			...(input.replyToSignalId
				? {
						replyTo: {
							signalId: input.replyToSignalId,
							profileId: "human-profile-1",
							profileKind: "human",
							profileName: "Felix",
							previewText: "@Runner(wake) please investigate",
						},
					}
				: {}),
		},
		id: input.id,
		profile: {
			kind: "system",
			profileId: "system",
			profileName: "OpenMeld",
		},
		spaceId: "space-123",
		ts: input.ts ?? Date.UTC(2026, 4, 27, 10, 0, 30),
		type: "signal.system_notice",
		v: 1,
	} as SignalEnvelope;
}

function createWakeProgressItem(input?: {
	omitWakeStopEligibility?: boolean;
	wakeStopEligibility?: WakeProgressItem["wakeStopEligibility"];
}): WakeProgressItem {
	const item: WakeProgressItem = {
		clientMessageId: "client-message-1",
		dispatchId: "dispatch-1",
		failureReasonCode: null,
		message: "@runner is working on this computer...",
		phase: "running",
		sourceSignalId: "sig-thread-wake",
		targetLabel: "@runner",
		targetProfileId: TARGET_PROFILE_ID,
		terminal: false,
		updatedAtMs: Date.UTC(2026, 4, 27, 10, 1),
	};
	if (!input?.omitWakeStopEligibility) {
		item.wakeStopEligibility =
			input?.wakeStopEligibility ?? CANCEL_BACKED_WAKE_STOP_ELIGIBILITY;
	}
	return item;
}

function createInlineThreadPermissionProgressItem(input: {
	runtimeCoordinatorExecutionId: string;
	title: string;
}): WakeProgressItem {
	const interactionId = "provider-interaction-reused";
	return {
		...createWakeProgressItem(),
		pendingInteraction: {
			canRespond: true,
			expiresAtMs: Date.UTC(2026, 6, 29),
			interactionId,
			kind: "permission",
			request: {
				expiresAtMs: Date.UTC(2026, 6, 29),
				interactionId,
				kind: "permission",
				options: [
					{
						intent: "allow_once",
						label: "Allow once",
						optionId: "allow-once",
					},
				],
				requestedAtMs: Date.UTC(2026, 6, 28),
				subject: { type: "tool" },
				title: input.title,
				v: 1,
			},
			requestedAtMs: Date.UTC(2026, 6, 28),
		},
		runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
	};
}

function createWakeStopResponse(): PostSpaceWakeStopResponse {
	return {
		cancellationState: {
			observedAtMs: Date.UTC(2026, 4, 27, 10, 2),
			reasonCode: null,
			status: "requested",
		},
		ok: true,
		runtimeCoordinatorExecutionId: "rce_123",
		status: "cancellation_requested",
		targetProfileId: TARGET_PROFILE_ID,
	};
}

function createMinimalMessageDetailsResponse(): GetSpaceMessageDetailsResponse {
	return {
		agentContext: notApplicableAgentContext(),
		diagnostics: {
			signalId: "sig-unused",
			traceSelectors: [],
		},
		message: {
			actor: {
				displayName: "Felix",
				profileHandle: null,
				profileId: "human-profile-1",
				profileKind: "human",
				profileName: "Felix",
			},
			sentAtMs: Date.UTC(2026, 4, 27, 10, 0),
			signalId: "sig-unused",
			signalType: "signal.text",
		},
		query: { signalId: "sig-unused", spaceId: "space-123" },
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

function createVoidDeferred(): {
	promise: Promise<void>;
	resolve: () => void;
} {
	let resolvePromise: (() => void) | undefined;
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve: () => resolvePromise?.(),
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
		workspaceFingerprint: notApplicableFact(),
		workspacePath: notApplicableFact(),
		openMeldServiceRuntimeId: notApplicableFact(),
	};
}

function notApplicableFact(): GetSpaceMessageDetailsResponse["agentContext"]["profileId"] {
	return {
		source: "none",
		state: "not_applicable",
		value: null,
	};
}
