import type {
	GetSpaceMessageDetailsResponse,
	PostSpaceWakeStopResponse,
} from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import type { WakeFailureTargetContext } from "#/lib/spaces/wake-failure-display";
import type {
	SpaceMessageWakeIssueEntry,
	SpaceMessageWakeThinkingEntry,
} from "#/lib/spaces/wake-progress-presentation";
import type { SpaceWakeStopTargetResolution } from "#/lib/spaces/wake-stop-target";
import { SpaceMessageDetailsDrawer } from "./space-message-details-drawer";

const CODE_MODE_PATTERN = /codemode/iu;
const copyTextToClipboardMock = vi.hoisted(() => vi.fn());

import type { SpaceMessageReferencesById } from "./space-message-reference";
import type { SpaceExecutionRecoveryHandler } from "./space-wake-retry";

const useQueryMock = vi.hoisted(() => vi.fn());
const REPORT_POINTER_COPY_PATTERN =
	/The report sends message IDs and system trace pointers/;
const AGENTS_RECOVERY_HREF_PATTERN = /\/agents$/u;
const COMPUTERS_RECOVERY_HREF_PATTERN = /\/computers$/u;
const ORGANIZATION_WAKE_ACCESS_HREF_PATTERN = /#organization-wake-access$/u;
const REFERENCED_SPACE_ID = "d".repeat(64);

vi.mock("#/lib/clipboard", () => ({
	copyTextToClipboard: copyTextToClipboardMock,
}));

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

describe("SpaceMessageDetailsDrawer", () => {
	afterEach(() => {
		cleanup();
		copyTextToClipboardMock.mockReset();
		useQueryMock.mockReset();
	});

	it("renders a human message from the backend Message Details model", () => {
		const details = createHumanMessageDetails();
		useQueryMock.mockReturnValue(createQueryResult({ data: details }));

		renderMessageDetailsPanel();

		expect(
			screen.getByRole("heading", { name: "Message details" })
		).toBeTruthy();
		expect(screen.getByTestId("message-details-drawer")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Activity" })).toBeTruthy();
		expect(screen.getByText("hello")).toBeTruthy();
		expect(screen.queryByText("Message sent")).toBeNull();
		expect(screen.getByText("Felix")).toBeTruthy();
		expect(
			screen.getByRole("time", {
				name: formatMessageDetailsTestTime(details.message.sentAtMs),
			})
		).toBeTruthy();
		expect(screen.queryByText("Support details")).toBeNull();
		expect(screen.getByText(REPORT_POINTER_COPY_PATTERN)).toBeTruthy();
		expect(getQueryOptions().queryKey).toEqual([
			"spaces",
			"message-details",
			"space-123",
			"sig-human",
			null,
		]);

		openTechnicalDetails();
		expect(screen.getAllByText("Message ID").length).toBeGreaterThan(0);
		expect(screen.getAllByText("sig-human").length).toBeGreaterThan(0);
	});

	it("opens Graph focused on the selected message", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);
		const onOpenChange = vi.fn();
		const onViewInGraph = vi.fn();

		renderMessageDetailsPanel({ onOpenChange, onViewInGraph });
		fireEvent.click(screen.getByRole("button", { name: "View in Graph" }));

		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(onViewInGraph).toHaveBeenCalledWith("sig-human");
	});

	it("shows agent-authored manual messages without inventing local runtime facts", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({
				data: createAgentManualMessageDetails(),
			})
		);

		renderMessageDetailsPanel({
			item: createTimelineItem({ id: "sig-agent-manual" }),
		});
		const technicalSection = openTechnicalDetails();

		expect(within(technicalSection).getByText("Agent profile")).toBeTruthy();
		expect(within(technicalSection).getByText("OpenMeld CLI Bot")).toBeTruthy();
		expect(
			within(technicalSection).queryByText("Agent Controller Conversation ID")
		).toBeNull();
	});

	it("renders Wake success replies with agent and Wake context together", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createWakeSuccessReplyDetails() })
		);

		renderMessageDetailsPanel({
			item: createAgentReplyTimelineItem(),
		});

		expect(screen.getAllByText("Replied")).toHaveLength(1);
		expect(screen.queryByRole("heading", { name: "Reply" })).toBeNull();
		expect(screen.getByText("In reply to")).toBeTruthy();

		const technicalSection = openTechnicalDetails();
		expect(
			within(technicalSection).getByText(
				"Message author Agent Controller Conversation ID"
			)
		).toBeTruthy();
		expect(within(technicalSection).getByText("conv-1")).toBeTruthy();
		expect(
			within(technicalSection).getByText("/Users/felix/.openmeld/workspace")
		).toBeTruthy();
	});

	it("keeps drawer text selectable and copies individual or complete technical details", async () => {
		copyTextToClipboardMock.mockResolvedValue(true);
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);

		renderMessageDetailsPanel();

		const scrollArea = screen.getByTestId("message-details-scroll-area");
		expect(scrollArea.className).toContain("select-text");
		expect(scrollArea.hasAttribute("data-vaul-no-drag")).toBe(true);

		const technicalDetails = openTechnicalDetails();
		fireEvent.click(
			within(technicalDetails).getByRole("button", {
				name: "Copy Message ID",
			})
		);
		await waitFor(() => {
			expect(copyTextToClipboardMock).toHaveBeenCalledWith("sig-human");
		});

		fireEvent.click(
			within(technicalDetails).getByRole("button", {
				name: "Copy technical details",
			})
		);
		await waitFor(() => {
			expect(copyTextToClipboardMock).toHaveBeenLastCalledWith(
				expect.stringContaining("Message ID: sig-human\nType: Message")
			);
		});
	});

	it("shows a long Agent reply as an expandable preview", () => {
		const longReply = Array.from(
			{ length: 24 },
			(_, index) => `Release finding ${index + 1} is ready for review.`
		).join(" ");
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createWakeSuccessReplyDetails() })
		);

		renderMessageDetailsPanel({
			item: createAgentReplyTimelineItem({ text: longReply }),
		});

		const replyActivity = getActivityRegion("Codex");
		const preview = within(replyActivity).getByText(longReply);
		expect(preview.className).toContain("line-clamp-6");

		fireEvent.click(
			within(replyActivity).getByRole("button", { name: "Show full reply" })
		);
		expect(preview.className).not.toContain("line-clamp-6");
		expect(
			within(replyActivity).getByRole("button", { name: "Collapse reply" })
		).toBeTruthy();
	});

	it("shows a long source message as a shorter expandable preview", () => {
		const longMessage = Array.from(
			{ length: 16 },
			(_, index) => `Question ${index + 1} adds relevant collaboration context.`
		).join(" ");
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);

		renderMessageDetailsPanel({
			item: createTimelineItem({ id: "sig-human", text: longMessage }),
		});

		const sourceActivity = getActivityRegion("Felix");
		const preview = within(sourceActivity).getByText(longMessage);
		expect(preview.className).toContain("line-clamp-3");
		expect(
			within(sourceActivity).getByRole("button", { name: "Show full message" })
		).toBeTruthy();
	});

	it("separates an Agent message author from the Agent targeted by its Wake", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createAgentHandoffMessageDetails() })
		);

		renderMessageDetailsPanel({
			item: createTimelineItem({ id: "sig-agent-handoff" }),
		});
		const activitySection = screen
			.getByRole("heading", { name: "Activity" })
			.closest("section");
		expect(activitySection).toBeTruthy();
		expect(
			within(activitySection as HTMLElement).getByText("Center Agent")
		).toBeTruthy();
		expect(
			within(activitySection as HTMLElement).getByText("Failed")
		).toBeTruthy();

		const technicalSection = openTechnicalDetails();
		expect(
			within(technicalSection).getByText("Message author Agent profile")
		).toBeTruthy();
		expect(within(technicalSection).getByText("Codex 5.6 Sol")).toBeTruthy();
		expect(
			within(technicalSection).getByText("Wake target Agent profile")
		).toBeTruthy();
		expect(within(technicalSection).getByText("Center Agent")).toBeTruthy();
		expect(
			within(technicalSection).getByText("Wake target Binding ID")
		).toBeTruthy();
		expect(
			within(technicalSection).getByText("binding-center-agent")
		).toBeTruthy();
		expect(
			within(technicalSection).getByText("Message author Agent Controller")
		).toBeTruthy();
		expect(
			within(technicalSection).getByText("Wake target Agent Controller")
		).toBeTruthy();
		expect(within(technicalSection).getAllByText("builtin:codex")).toHaveLength(
			2
		);
	});

	it("renders Wake failure notices through the same Wake context model", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createWakeFailureNoticeDetails() })
		);

		renderMessageDetailsPanel({
			item: createTimelineItem({ id: "sig-failure-notice" }),
		});
		const technicalSection = openTechnicalDetails();

		expect(within(technicalSection).getByText("System notice")).toBeTruthy();
		expect(within(technicalSection).queryByText("Agent profile")).toBeNull();
		expect(
			within(technicalSection).getByText("Wake source message")
		).toBeTruthy();
		expect(within(technicalSection).queryByText("Not applicable")).toBeNull();
		expect(
			within(technicalSection).queryByText("space_action.valid_action_required")
		).toBeNull();
		expect(
			within(technicalSection).queryByText("Agent Controller Conversation ID")
		).toBeNull();
		expect(within(technicalSection).queryByText("conv-failed-1")).toBeNull();
	});

	it("renders redacted local origin facts as hidden instead of missing", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createRedactedAgentMessageDetails() })
		);

		renderMessageDetailsPanel({
			item: createTimelineItem({ id: "sig-redacted-agent" }),
		});
		const technicalSection = openTechnicalDetails();

		expect(
			within(technicalSection).getByText("Agent Controller Conversation ID")
		).toBeTruthy();
		expect(within(technicalSection).getByText("Workspace")).toBeTruthy();
		expect(
			within(technicalSection).getAllByText("Hidden").length
		).toBeGreaterThanOrEqual(2);
		expect(screen.queryByText("/Users/felix/private")).toBeNull();
	});

	it("uses the selected message when reporting an issue", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);
		const onReportMessage = vi.fn().mockResolvedValue(undefined);
		const item = createTimelineItem({ id: "sig-human" });

		renderMessageDetailsPanel({ item, onReportMessage });
		fireEvent.click(screen.getByRole("button", { name: "Send report" }));

		expect(onReportMessage).toHaveBeenCalledWith(item);
	});

	it("shows loaded replies to the selected message and jumps to the reply", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);
		const onJumpToMessage = vi.fn();
		const onOpenChange = vi.fn();

		renderMessageDetailsPanel({
			onJumpToMessage,
			onOpenChange,
			replyItems: [
				createTimelineItem({
					id: "sig-agent-reply",
					actorName: "Felix's Codex Spark",
					actorProfileId: "agt_codex",
					actorProfileKind: "agent",
					actorProfileName: "Felix's Codex Spark",
					replyToProfileName: "Felix",
					replyToSignalId: "sig-human",
					text: "Awake and responding.",
				}),
			],
		});

		const repliesSection = getActivityRegion("Felix's Codex Spark");
		expect(
			within(repliesSection).getByText("Felix's Codex Spark")
		).toBeTruthy();
		expect(
			within(repliesSection).getByText("Awake and responding.")
		).toBeTruthy();
		expect(within(repliesSection).getByText("Replied")).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "Replies" })).toBeNull();

		fireEvent.click(
			within(repliesSection).getByRole("button", {
				name: "Show reply in Messages",
			})
		);

		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(onJumpToMessage).toHaveBeenCalledWith("sig-agent-reply");
	});

	it("updates a Wake target in place while the agent is working", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);

		renderMessageDetailsPanel({
			targetProfileDisplayNamesByProfileId: new Map([["agt_runner", "Runner"]]),
			wakeProgressEntries: [
				{
					elapsedStartedAtMs: Date.UTC(2026, 5, 3, 22, 8),
					key: "runner-working",
					kind: "progress",
					phase: "running",
					step: {
						description: "The agent has the Wake.",
						label: "Agent is working",
						status: "active",
					},
					targetProfileId: "agt_runner",
					text: "Reviewing the release checklist…",
				},
			],
		});

		const runner = getActivityRegion("Runner");
		expect(within(runner).getByText("Working")).toBeTruthy();
		expect(
			within(runner).getByText("Reviewing the release checklist…")
		).toBeTruthy();
		expect(within(runner).queryByText("Replied")).toBeNull();
	});

	it("uses the shared Space reference entity in message details", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);

		renderMessageDetailsPanel({
			replyItems: [
				createTimelineItem({
					id: "sig-agent-reply",
					text: `/spaces/${REFERENCED_SPACE_ID}`,
				}),
			],
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

	it("shows terminal failure notices as the one authoritative failure reason instead of regular replies", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);

		renderMessageDetailsPanel({
			replyItems: [
				createTimelineItem({
					id: "sig-terminal-failure",
					actorName: "OpenMeld",
					actorProfileId: "openmeld-system",
					actorProfileKind: "system",
					actorProfileName: "OpenMeld",
					replyToProfileName: "Felix",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeType: "terminal_failure",
					text: "Runner couldn't reply: OpenMeld did not receive a message it could post in this space.",
				}),
			],
		});

		const reasonSection = getActivityRegion("OpenMeld");
		expect(
			within(reasonSection).getByText(
				"Runner couldn't reply: OpenMeld did not receive a message it could post in this space."
			)
		).toBeTruthy();
		expect(within(reasonSection).queryByRole("link")).toBeNull();
		expect(within(reasonSection).queryByRole("button")).toBeNull();
		expect(
			screen.queryByRole("heading", { name: "Why this failed" })
		).toBeNull();
		expect(screen.queryByRole("heading", { name: "Replies" })).toBeNull();
	});

	it("keeps a historical failure notice verbatim and links its known reason to recovery", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);
		const persistedNoticeText = "Runner needs setup before it can reply.";

		renderMessageDetailsPanel({
			replyItems: [
				createTimelineItem({
					id: "sig-terminal-failure",
					actorName: "OpenMeld",
					actorProfileId: "openmeld-system",
					actorProfileKind: "system",
					actorProfileName: "OpenMeld",
					replyToProfileName: "Felix",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeReasonCode: "agent_profile_binding.missing",
					systemNoticeTargetProfileId: "agt_triage",
					systemNoticeType: "terminal_failure",
					text: persistedNoticeText,
				}),
			],
			targetProfileDisplayNamesByProfileId: new Map([["agt_triage", "Runner"]]),
		});

		const reasonSection = getActivityRegion("Runner");
		expect(within(reasonSection).getByText(persistedNoticeText)).toBeTruthy();
		const recoveryLink = within(reasonSection).getByRole("link", {
			name: "Choose local agent",
		});
		expect(recoveryLink.getAttribute("href")).toMatch(
			AGENTS_RECOVERY_HREF_PATTERN
		);
	});

	it("links a runtime permission denial to Agent Profile permissions", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);

		renderMessageDetailsPanel({
			replyItems: [
				createTimelineItem({
					id: "sig-terminal-failure",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeFailureStage: "execution",
					systemNoticeReasonCode: "permission.denied.runtime",
					systemNoticeTargetProfileId: "agt_opencode",
					systemNoticeType: "terminal_failure",
					text: "The requested action was blocked by the Agent Profile’s permission settings.",
				}),
			],
			targetProfileDisplayNamesByProfileId: new Map([
				["agt_opencode", "OpenCode Agent"],
			]),
		});

		const recoveryLink = screen.getByRole("link", {
			name: "Review Agent Profile permissions",
		});
		expect(recoveryLink.getAttribute("href")).toMatch(
			AGENTS_RECOVERY_HREF_PATTERN
		);
	});

	it("prioritizes the exact setup fix over rerunning the failed Wake", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);
		const onRetryWakeTarget = vi.fn().mockResolvedValue(undefined);

		renderMessageDetailsPanel({
			item: createTimelineItem({
				id: "sig-human",
				text: "@Runner check the release build",
				wakeTargetProfileIds: ["agt_triage"],
			}),
			onRetryWakeTarget,
			replyItems: [
				createTimelineItem({
					id: "sig-terminal-failure",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeFailureStage: "execution",
					systemNoticeReasonCode: "agent_profile_binding.missing",
					systemNoticeTargetProfileId: "agt_triage",
					systemNoticeType: "terminal_failure",
					text: "Runner needs setup before it can reply.",
				}),
			],
			targetProfileDisplayNamesByProfileId: new Map([["agt_triage", "Runner"]]),
		});

		const reasonSection = getActivityRegion("Runner");
		const actions = Array.from(
			reasonSection.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>(
				"button, a"
			)
		);
		expect(actions.map((action) => action.textContent)).toEqual([
			"Choose local agent",
			"Open diagnostics",
		]);
		expect(onRetryWakeTarget).not.toHaveBeenCalled();
	});

	it("shows a visible failure when retrying a Wake fails", async () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);
		const onOpenChange = vi.fn();
		const onRetryWakeTarget = vi
			.fn()
			.mockRejectedValue(new Error("The retry request failed."));

		renderMessageDetailsPanel({
			item: createTimelineItem({
				id: "sig-human",
				text: "@Runner check the release build",
				wakeTargetProfileIds: ["agt_triage"],
			}),
			onOpenChange,
			onRetryWakeTarget,
			replyItems: [
				createTimelineItem({
					id: "sig-terminal-failure",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeFailureStage: "execution",
					systemNoticeTargetProfileId: "agt_triage",
					systemNoticeType: "terminal_failure",
					text: "Runner could not complete the Wake.",
				}),
			],
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Retry as new execution" })
		);

		const failedRetryButton = await screen.findByRole("button", {
			name: "New execution failed. Try again",
		});
		const firstClientMessageId =
			onRetryWakeTarget.mock.calls[0]?.[0].clientMessageId;
		expect(firstClientMessageId).toEqual(expect.any(String));

		fireEvent.click(failedRetryButton);

		await waitFor(() => {
			expect(onRetryWakeTarget).toHaveBeenCalledTimes(2);
		});
		expect(onRetryWakeTarget.mock.calls[1]?.[0].clientMessageId).not.toBe(
			firstClientMessageId
		);
		expect(onOpenChange).not.toHaveBeenCalledWith(false);
	});

	it("does not offer Retry when the source Wake contains attachments", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);

		renderMessageDetailsPanel({
			item: createTimelineItem({
				attachments: [
					{
						fileName: "context.png",
						height: 600,
						id: "attachment-context",
						localPreviewUrl: null,
						mimeType: "image/png",
						sizeBytes: 2048,
						width: 800,
					},
				],
				id: "sig-human",
				text: "@Runner check this screenshot",
				wakeTargetProfileIds: ["agt_triage"],
			}),
			onRetryWakeTarget: vi.fn().mockResolvedValue(undefined),
			replyItems: [
				createTimelineItem({
					id: "sig-terminal-failure",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeFailureStage: "execution",
					systemNoticeTargetProfileId: "agt_triage",
					systemNoticeType: "terminal_failure",
					text: "Runner could not complete this Wake.",
				}),
			],
		});

		expect(
			screen.queryByRole("button", { name: "Retry as new execution" })
		).toBeNull();
	});

	it("does not offer Retry when only one target of a multi-target Wake failed", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);

		renderMessageDetailsPanel({
			item: createTimelineItem({
				id: "sig-human",
				text: "@Runner @Reviewer check the release",
				wakeTargetProfileIds: ["agt_triage", "agt_reviewer"],
			}),
			onRetryWakeTarget: vi.fn().mockResolvedValue(undefined),
			replyItems: [
				createTimelineItem({
					id: "sig-terminal-failure",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeFailureStage: "execution",
					systemNoticeTargetProfileId: "agt_triage",
					systemNoticeType: "terminal_failure",
					text: "Runner could not complete this Wake.",
				}),
			],
		});

		expect(
			screen.queryByRole("button", { name: "Retry as new execution" })
		).toBeNull();
	});

	it("offers recovery-controlled Retry and Open diagnostics for a persisted system failure", async () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);
		const onRecoverExecution = createFreshExecutionRecoveryHandler();

		renderMessageDetailsPanel({
			item: createTimelineItem({
				id: "sig-human",
				text: "Wake up test",
				wakeTargetProfileIds: ["agt_center"],
			}),
			onRecoverExecution,
			onRetryWakeTarget: vi.fn().mockResolvedValue(undefined),
			replyItems: [
				createTimelineItem({
					id: "sig-system-failure",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeDispatchId: "dispatch-system-failure",
					systemNoticeFailureStage: "execution",
					systemNoticeReasonCode: "dispatch.storage.schema_missing",
					systemNoticeTargetProfileId: "agt_center",
					systemNoticeType: "terminal_failure",
					text: "OpenMeld ran into a system problem before Center Agent could reply. Try again. If it keeps happening, open diagnostics.",
				}),
			],
			targetProfileDisplayNamesByProfileId: new Map([
				["agt_center", "Center Agent"],
			]),
		});

		const reasonSection = getActivityRegion("Center Agent");
		await within(reasonSection).findByRole("button", {
			name: "Retry as new execution",
		});
		expect(
			Array.from(
				reasonSection.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>(
					"button, a"
				)
			).map((action) => action.textContent)
		).toEqual(["Retry as new execution", "Open diagnostics"]);
		expect(
			screen.queryByRole("link", { name: "Review agent settings" })
		).toBeNull();

		fireEvent.click(
			within(reasonSection).getByRole("button", { name: "Open diagnostics" })
		);
		const technicalDetails = screen
			.getByText("Technical details")
			.closest("details") as HTMLDetailsElement;
		expect(technicalDetails.open).toBe(true);
		expect(
			within(technicalDetails).getByText("dispatch.storage.schema_missing")
		).toBeTruthy();
	});

	it("explains a reply-publication failure with one recovery action and diagnostics", async () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);
		const onRecoverExecution = vi.fn<SpaceExecutionRecoveryHandler>(
			async (attempt) =>
				attempt.action === null
					? {
							action: "resume_controller_conversation",
							label: "Continue conversation",
							status: "available",
							warning:
								"OpenMeld will ask the same Agent conversation to post the reply it already finished. It will not run the task again.",
						}
					: {
							action: null,
							label: null,
							status: "in_progress",
							warning: null,
						}
		);

		renderMessageDetailsPanel({
			item: createTimelineItem({
				id: "sig-human",
				text: "Run the release check",
				wakeTargetProfileIds: ["agt_cursor"],
			}),
			onRecoverExecution,
			replyItems: [
				createTimelineItem({
					id: "sig-cursor-failure",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeDispatchId: "dispatch-cursor",
					systemNoticeFailureStage: "execution",
					systemNoticeReasonCode: "openmeld.space_action.repair_failed",
					systemNoticeTargetProfileId: "agt_cursor",
					systemNoticeType: "terminal_failure",
					text: "Cursor finished, but OpenMeld couldn't post its reply.",
				}),
			],
			targetProfileDisplayNamesByProfileId: new Map([["agt_cursor", "Cursor"]]),
		});

		const reasonSection = getActivityRegion("Cursor");
		expect(
			within(reasonSection).getByText(
				"Cursor answered in its local conversation, but it did not tell OpenMeld whether to post a message or stay silent, so nothing was posted."
			)
		).toBeTruthy();
		await within(reasonSection).findByRole("button", {
			name: "Recover reply",
		});
		expect(
			within(reasonSection).getByText(
				"OpenMeld will ask the same Agent conversation to post the reply it already finished. It will not run the task again."
			)
		).toBeTruthy();
		expect(
			Array.from(
				reasonSection.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>(
					"button, a"
				)
			).map((action) => action.textContent)
		).toEqual(["Recover reply", "Open diagnostics"]);
		expect(
			within(reasonSection).queryByRole("link", {
				name: "Connect local agent",
			})
		).toBeNull();
	});

	it("links Cursor plan limits to Cursor instead of local-agent setup", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);

		renderMessageDetailsPanel({
			replyItems: [
				createTimelineItem({
					id: "sig-cursor-plan-failure",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeDispatchId: "dispatch-cursor-plan",
					systemNoticeFailureStage: "execution",
					systemNoticeReasonCode: "cursor.plan_upgrade_required",
					systemNoticeTargetProfileId: "agt_cursor",
					systemNoticeType: "terminal_failure",
					text: "Cursor stopped this Wake because the current Cursor plan has reached its usage limit. Upgrade the Cursor plan, then wake Cursor again.",
				}),
			],
			targetProfileDisplayNamesByProfileId: new Map([["agt_cursor", "Cursor"]]),
		});

		const reasonSection = getActivityRegion("Cursor");
		const managePlan = within(reasonSection).getByRole("link", {
			name: "Manage Cursor plan",
		});
		const diagnostics = within(reasonSection).getByRole("button", {
			name: "Open diagnostics",
		});
		expect(managePlan.getAttribute("href")).toBe(
			"https://cursor.com/dashboard"
		);
		expect(managePlan.getAttribute("target")).toBe("_blank");
		expect(managePlan.className).toContain("h-7");
		expect(diagnostics.className).toContain("h-7");
		expect(
			within(reasonSection).queryByRole("link", {
				name: "Connect local agent",
			})
		).toBeNull();
	});

	it("offers recovery-controlled Retry and Open diagnostics for an oversized Center Agent tool result", async () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);
		const onRecoverExecution = createFreshExecutionRecoveryHandler();

		renderMessageDetailsPanel({
			item: createTimelineItem({
				id: "sig-human",
				text: "Review the pull request",
				wakeTargetProfileIds: ["agt_center"],
			}),
			onRecoverExecution,
			onRetryWakeTarget: vi.fn().mockResolvedValue(undefined),
			replyItems: [
				createTimelineItem({
					id: "sig-large-tool-result",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeDispatchId: "dispatch-large-tool-result",
					systemNoticeFailureStage: "execution",
					systemNoticeReasonCode: "remote_agent.tool_result_too_large",
					systemNoticeTargetProfileId: "agt_center",
					systemNoticeType: "terminal_failure",
					text: "Center Agent tried to process too much data at once.",
				}),
			],
			targetProfileDisplayNamesByProfileId: new Map([
				["agt_center", "Center Agent"],
			]),
		});

		const reasonSection = getActivityRegion("Center Agent");
		await within(reasonSection).findByRole("button", {
			name: "Retry as new execution",
		});
		expect(
			Array.from(
				reasonSection.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>(
					"button, a"
				)
			).map((action) => action.textContent)
		).toEqual(["Retry as new execution", "Open diagnostics"]);
	});

	it("shows one exact Recover result action for an independent late-result notice", async () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);
		const onRecoverExecution = vi.fn<SpaceExecutionRecoveryHandler>(
			async (attempt) =>
				attempt.action === null
					? {
							action: "recover_result",
							label: "Recover result",
							status: "available",
							warning: null,
						}
					: {
							action: null,
							label: null,
							status: "in_progress",
							warning: null,
						}
		);

		renderMessageDetailsPanel({
			item: createTimelineItem({
				id: "sig-human",
				text: "@Runner @Reviewer check the release",
				wakeTargetProfileIds: ["agt_triage", "agt_reviewer"],
			}),
			onRecoverExecution,
			replyItems: [
				createTimelineItem({
					id: "sig-terminal-failure",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeDispatchId: "dispatch-runner",
					systemNoticeFailureStage: "execution",
					systemNoticeReasonCode: "runtime.progress_stale",
					systemNoticeTargetProfileId: "agt_triage",
					systemNoticeType: "terminal_failure",
					text: "Runner stopped making progress.",
				}),
				createTimelineItem({
					id: "sig-recovery-available",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeDispatchId: "dispatch-runner",
					systemNoticeResultRef: "dispatch-runner::result-1",
					systemNoticeTargetProfileId: "agt_triage",
					systemNoticeType: "execution_recovery_available",
					text: "A completed result is ready to recover.",
				}),
				createTimelineItem({
					id: "sig-reviewer-stopped",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeDispatchId: "dispatch-reviewer",
					systemNoticeTargetProfileId: "agt_reviewer",
					systemNoticeType: "wake_stopped",
					text: "Reviewer was stopped by the user.",
				}),
			],
		});

		expect(
			await screen.findAllByRole("button", { name: "Recover result" })
		).toHaveLength(1);
		expect(
			screen.queryByRole("button", { name: "Retry as new execution" })
		).toBeNull();
		expect(onRecoverExecution).toHaveBeenCalledOnce();
		expect(onRecoverExecution).toHaveBeenCalledWith({
			action: null,
			dispatchId: "dispatch-runner",
			operationId: null,
			resultRef: "dispatch-runner::result-1",
			targetProfileId: "agt_triage",
		});
	});

	it("does not retry publication failures", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);

		renderMessageDetailsPanel({
			onRetryWakeTarget: vi.fn(),
			replyItems: [
				createTimelineItem({
					id: "sig-publication-failure",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeFailureStage: "publication",
					systemNoticeTargetProfileId: "agt_triage",
					systemNoticeType: "terminal_failure",
					text: "Runner finished, but the reply could not be posted.",
				}),
			],
		});

		expect(
			screen.queryByRole("button", { name: "Retry as new execution" })
		).toBeNull();
	});

	it("does not expose a generic issue message beside a named recovery explanation", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);
		const genericMessage = "This agent's local agent is turned off.";
		const namedRecovery =
			"Runner's local agent is turned off in OpenMeld on this computer. Turn it on, then wake the agent again.";

		renderMessageDetailsPanel({
			wakeIssueEntries: [
				{
					action: null,
					body: namedRecovery,
					key: "agt_runner:controller.registry.disabled",
					message: genericMessage,
					targetLabel: "Runner",
					targetProfileId: "agt_runner",
				},
			],
		});

		const issue = getActivityRegion("Runner");
		expect(within(issue).queryByText(genericMessage)).toBeNull();
		expect(within(issue).getByText(namedRecovery)).toBeTruthy();
	});

	it("shows one exact setup action when progress details also offer a rerun", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);

		renderMessageDetailsPanel({
			item: createTimelineItem({
				id: "sig-human",
				wakeTargetProfileIds: ["agt_runner"],
			}),
			onRetryWakeTarget: vi.fn().mockResolvedValue(undefined),
			replyItems: [
				createTimelineItem({
					id: "sig-terminal-failure",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeFailureStage: "execution",
					systemNoticeTargetProfileId: "agt_runner",
					systemNoticeType: "terminal_failure",
					text: "Runner needs setup before it can reply.",
				}),
			],
			wakeIssueEntries: [
				{
					action: {
						display: {
							actionTarget: "agents",
							body: "Choose a local agent, then try again.",
							primaryActionId: "choose_local_agent",
							primaryActionLabel: "Choose local agent",
						},
						kind: "wake_failure",
					},
					body: "Choose a local agent, then try again.",
					key: "dispatch-runner",
					message: "Runner could not complete this Wake.",
					targetLabel: "Runner",
					targetProfileId: "agt_runner",
				},
			],
		});

		const issue = getActivityRegion("Runner");
		expect(
			Array.from(
				issue.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>(
					"button, a"
				)
			).map((action) => action.textContent)
		).toEqual(["Choose local agent"]);
	});

	it("opens diagnostics for a known storage failure without a settings action", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);

		renderMessageDetailsPanel({
			replyItems: [
				createTimelineItem({
					id: "sig-terminal-failure",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeReasonCode: "dispatch.storage_unavailable",
					systemNoticeType: "terminal_failure",
					text: "OpenMeld needs a storage update before this Wake can run.",
				}),
			],
		});

		expect(
			screen.queryByRole("heading", { name: "Why this failed" })
		).toBeNull();
		expect(screen.queryByRole("link")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Open diagnostics" })
		).toBeTruthy();
	});

	it("links a manageable local-service failure to its shared recovery target", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);

		renderMessageDetailsPanel({
			replyItems: [
				createTimelineItem({
					id: "sig-terminal-failure",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeReasonCode: "service.not_running",
					systemNoticeTargetProfileId: "agt_triage",
					systemNoticeType: "terminal_failure",
					text: "Runner could not reply.",
				}),
			],
			targetProfileDisplayNamesByProfileId: new Map([["agt_triage", "Runner"]]),
			wakeFailureTargetContextsByProfileId: new Map([
				[
					"agt_triage",
					{
						controllerDisplayName: "Codex",
						isCurrentUserManageable: true,
						ownerDisplayName: "Felix",
					},
				],
			]),
		});

		const recoveryLink = screen.getByRole("link", {
			name: "Reconnect OpenMeld Service",
		});
		expect(recoveryLink.getAttribute("href")).toMatch(
			COMPUTERS_RECOVERY_HREF_PATTERN
		);
	});

	it("keeps an Organization Wake access failure and its action in one activity row", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);

		renderMessageDetailsPanel({
			replyItems: [
				createTimelineItem({
					id: "sig-terminal-failure",
					actorName: "OpenMeld",
					actorProfileId: "openmeld-system",
					actorProfileKind: "system",
					actorProfileName: "OpenMeld",
					replyToProfileName: "Felix",
					replyToSignalId: "sig-human",
					signalType: "signal.system_notice",
					systemNoticeFailureStage: "execution",
					systemNoticeReasonCode: "organization_binding_authorization.required",
					systemNoticeType: "terminal_failure",
					text: "Wake access is off for Runner in this organization.",
				}),
			],
		});

		const failureSection = getActivityRegion("OpenMeld");
		const statusBadge = within(failureSection).getByText("Failed");
		const failureReason = within(failureSection).getByText(
			"Wake access is off for Runner in this organization."
		);
		expect(statusBadge.className).toContain("text-destructive");
		expect(failureReason).toBeTruthy();
		expect(screen.queryByText("Wake failed")).toBeNull();
		expect(
			screen.queryByRole("heading", { name: "Why this failed" })
		).toBeNull();
		const recoveryLink = screen.getByRole("link", {
			name: "Turn on Wake access",
		});
		expect(recoveryLink.getAttribute("href")).toMatch(
			ORGANIZATION_WAKE_ACCESS_HREF_PATTERN
		);
	});

	it("shows one failed activity row and keeps reason-code facts in Technical details", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createWakeFailureNoticeDetails() })
		);

		renderMessageDetailsPanel({
			canJumpToMessage: () => false,
			item: createTimelineItem({
				id: "sig-failure-notice",
				replyToSignalId: "sig-source",
				signalType: "signal.system_notice",
				systemNoticeDispatchId: "dispatch-1",
				systemNoticeFailureStage: "execution",
				systemNoticeReasonCode: "controller.runtime.missing",
				systemNoticeTargetProfileId: "agt_triage",
				systemNoticeType: "terminal_failure",
				text: "Runner could not reply.",
			}),
			onRetryWakeTarget: vi.fn(),
			targetProfileDisplayNamesByProfileId: new Map([["agt_triage", "Runner"]]),
		});

		const failureSection = getActivityRegion("Runner");
		expect(within(failureSection).getByText("Failed").className).toContain(
			"text-destructive"
		);
		expect(
			within(failureSection).getByText("Runner could not reply.")
		).toBeTruthy();
		expect(screen.queryByText("Wake failed")).toBeNull();
		expect(
			screen.queryByRole("heading", { name: "Why this failed" })
		).toBeNull();
		expect(
			screen.getAllByText("Original message is not loaded in this view.").length
		).toBeGreaterThan(0);

		const technicalSection = openTechnicalDetails();
		expect(within(technicalSection).getByText("Reason code")).toBeTruthy();
		expect(
			within(technicalSection).getByText("controller.runtime.missing")
		).toBeTruthy();
		expect(within(technicalSection).getByText("Failure stage")).toBeTruthy();
		expect(within(technicalSection).getByText("Execution")).toBeTruthy();
		expect(within(technicalSection).getByText("Dispatch ID")).toBeTruthy();
		expect(within(technicalSection).getByText("dispatch-1")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Retry as new execution" })
		).toBeNull();
	});

	it("shows a stopped activity status and its reason code for a wake_stopped notice", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createWakeFailureNoticeDetails() })
		);

		renderMessageDetailsPanel({
			item: createTimelineItem({
				id: "sig-stopped-notice",
				signalType: "signal.system_notice",
				systemNoticeReasonCode: "user_requested",
				systemNoticeType: "wake_stopped",
				text: "Wake was stopped.",
			}),
			onRetryWakeTarget: vi.fn(),
		});

		expect(
			screen.queryByRole("button", { name: "Retry as new execution" })
		).toBeNull();

		const stoppedBadge = screen.getByText("Stopped");
		expect(stoppedBadge.className).toContain("text-muted-foreground");
		expect(stoppedBadge.className).not.toContain("text-destructive");
		const technicalSection = openTechnicalDetails();
		expect(within(technicalSection).getByText("user_requested")).toBeTruthy();
	});

	it("omits reason-code facts from Technical details instead of showing an empty placeholder when none are recorded", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createWakeFailureNoticeDetails() })
		);

		renderMessageDetailsPanel({
			canJumpToMessage: () => true,
			item: createTimelineItem({
				id: "sig-failure-notice",
				replyToSignalId: "sig-source",
				signalType: "signal.system_notice",
				systemNoticeType: "terminal_failure",
				text: "Runner could not reply.",
			}),
		});

		const technicalSection = openTechnicalDetails();
		expect(within(technicalSection).queryByText("Reason code")).toBeNull();
		expect(within(technicalSection).queryByText("Failure stage")).toBeNull();
		expect(within(technicalSection).queryByText("Dispatch ID")).toBeNull();
	});

	it("shows no status badge for an ordinary text message with no Wake", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createHumanMessageDetails() })
		);

		renderMessageDetailsPanel({
			item: createTimelineItem({ id: "sig-human" }),
		});

		for (const status of [
			"Failed",
			"Stopped",
			"Replied",
			"Running",
			"Pending",
		]) {
			expect(screen.queryByText(status)).toBeNull();
		}
	});

	it("shows recorded Agent tool activity without exposing raw tool payloads", () => {
		const details = createWakeSuccessReplyDetails();
		useQueryMock.mockReturnValue(
			createQueryResult({
				data: {
					...details,
					workingDetails: {
						state: "recorded",
						tools: [
							{
								toolName: "openmeld_list_spaces",
								state: "output-available",
								startedAtMs: Date.UTC(2026, 5, 3, 22, 7),
								updatedAtMs: Date.UTC(2026, 5, 3, 22, 7, 1),
								work: { key: "spaces.read", v: 1 },
							},
							{
								toolName: "github_search_issues",
								state: "output-error",
								startedAtMs: Date.UTC(2026, 5, 3, 22, 7, 2),
								updatedAtMs: Date.UTC(2026, 5, 3, 22, 7, 3),
								work: { key: "github.issues.search", v: 1 },
							},
							{
								toolName: "agent_read_files",
								state: "output-available",
								startedAtMs: Date.UTC(2026, 5, 3, 22, 7, 4),
								updatedAtMs: Date.UTC(2026, 5, 3, 22, 7, 5),
								work: { key: "source.read", v: 1 },
							},
							{
								toolName: "agent_run_command",
								state: "output-error",
								startedAtMs: Date.UTC(2026, 5, 3, 22, 7, 6),
								updatedAtMs: Date.UTC(2026, 5, 3, 22, 7, 7),
								work: { key: "tests.run", v: 1 },
							},
							{
								toolName: "codemode",
								state: "output-error",
								startedAtMs: Date.UTC(2026, 5, 3, 22, 7, 8),
								updatedAtMs: Date.UTC(2026, 5, 3, 22, 7, 9),
							},
						],
						truncated: false,
					},
				},
			})
		);

		renderMessageDetailsPanel({
			item: createTimelineItem({ id: "sig-agent-reply" }),
		});

		const activity = screen.getByRole("heading", {
			name: "Activity",
		}).parentElement;
		expect(activity).toBeTruthy();
		const scoped = within(activity as HTMLElement);
		expect(scoped.getByText("Checked available Spaces")).toBeTruthy();
		expect(scoped.getByText("Couldn't search GitHub issues")).toBeTruthy();
		expect(scoped.getByText("Reviewed source files")).toBeTruthy();
		expect(scoped.getByText("Couldn't run project tests")).toBeTruthy();
		expect(scoped.queryByText("Had a problem")).toBeNull();
		expect(scoped.getAllByText("Failed")).toHaveLength(2);
		expect(scoped.queryByText("openmeld_list_spaces")).toBeNull();
		expect(scoped.queryByText("agent_read_files")).toBeNull();
		expect(scoped.queryByText(CODE_MODE_PATTERN)).toBeNull();
		expect(scoped.queryByText("tool_call_1")).toBeNull();
	});

	it("renders Wake Stop controls from the resolved Wake Stop target", async () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createWakeSuccessReplyDetails() })
		);
		const onWakeStopRequest = vi
			.fn()
			.mockResolvedValue(createWakeStopResponse());

		renderMessageDetailsPanel({
			item: createTimelineItem({ id: "sig-source" }),
			onWakeStopRequest,
			wakeStopTarget: createWakeStopTarget(),
		});

		expect(screen.queryByRole("heading", { name: "Wake controls" })).toBeNull();
		const wakeStopButton = screen.getByRole("button", {
			name: "Stop Wake for @runner",
		});
		expect(wakeStopButton.textContent).toContain("Stop");
		fireEvent.click(wakeStopButton);
		const dialog = within(
			screen.getByRole("dialog", { name: "Stop this Wake?" })
		);
		fireEvent.click(dialog.getByRole("button", { name: "Stop Wake" }));

		await waitFor(() => {
			expect(onWakeStopRequest).toHaveBeenCalledWith(createWakeStopTarget());
		});
	});

	it("replaces a waiting target with one stopped outcome after Wake Stop is confirmed", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({
				data: {
					...createHumanMessageDetails(),
					wakeContext: createWakeContext({ status: "pending" }),
				},
			})
		);

		renderMessageDetailsPanel({
			item: createTimelineItem({ id: "sig-source" }),
			onWakeStopRequest: vi.fn(),
			targetProfileDisplayNamesByProfileId: new Map([["agt_triage", "Runner"]]),
			wakeStopTarget: createWakeStopTarget({ status: "stopped" }),
		});

		const activity = getActivityRegion("Runner");
		expect(within(activity).getByText("Stopped")).toBeTruthy();
		expect(within(activity).getByText("Wake was stopped.")).toBeTruthy();
		expect(within(activity).queryByText("Waiting")).toBeNull();
		expect(within(activity).queryByText("Waiting for a reply.")).toBeNull();
		expect(
			within(activity).queryByRole("button", { name: "Stop Wake for @runner" })
		).toBeNull();
	});

	it("does not request Stop for an unsupported Wake Stop target in details", () => {
		useQueryMock.mockReturnValue(
			createQueryResult({ data: createWakeSuccessReplyDetails() })
		);
		const onWakeStopRequest = vi.fn();

		renderMessageDetailsPanel({
			item: createTimelineItem({ id: "sig-source" }),
			onWakeStopRequest,
			wakeStopTarget: createWakeStopTarget({
				canStop: false,
				status: "unsupported",
			}),
		});

		expect(
			screen.getByText("Stop is not supported for this local agent.")
		).toBeTruthy();
		expect(
			screen.queryByRole("button", {
				name: "Wake Stop unavailable for @runner",
			})
		).toBeNull();

		expect(
			screen.queryByRole("dialog", { name: "Stop this Wake?" })
		).toBeNull();
		expect(onWakeStopRequest).not.toHaveBeenCalled();
	});
});

// Technical details fields are inside a native <details>, closed by default,
// so their contents aren't in the accessibility tree until the <summary> is
// clicked open. Returns the section so callers can scope queries to it.
function openTechnicalDetails(): HTMLElement {
	const summary = screen.getByText("Technical details");
	fireEvent.click(summary);
	return summary.closest("details") as HTMLElement;
}

function getActivityRegion(name: string): HTMLElement {
	return screen.getByRole("region", { name: `${name} activity` });
}

function renderMessageDetailsPanel(input?: {
	canJumpToMessage?: (signalId: string) => boolean;
	item?: SpaceTimelineItem;
	onJumpToMessage?: (signalId: string) => void;
	onOpenChange?: (open: boolean) => void;
	onViewInGraph?: (signalId: string) => void;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onReportMessage?: (item: SpaceTimelineItem) => Promise<void>;
	onRetryWakeTarget?: (input: {
		sourceText: string;
		targetProfileId: string;
	}) => Promise<void>;
	onWakeStopRequest?: (
		target: SpaceWakeStopTargetResolution
	) => Promise<PostSpaceWakeStopResponse>;
	replyItems?: readonly SpaceTimelineItem[];
	spaceReferencesById?: SpaceMessageReferencesById;
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
	wakeFailureTargetContextsByProfileId?: ReadonlyMap<
		string,
		WakeFailureTargetContext
	>;
	wakeIssueEntries?: readonly SpaceMessageWakeIssueEntry[];
	wakeProgressEntries?: readonly SpaceMessageWakeThinkingEntry[];
	wakeStopTarget?: SpaceWakeStopTargetResolution | null;
}) {
	const item = input?.item ?? createTimelineItem({ id: "sig-human" });
	return render(
		<SpaceMessageDetailsDrawer
			canJumpToMessage={
				input?.canJumpToMessage ??
				((signalId) =>
					signalId === "sig-source" || signalId === "sig-agent-reply")
			}
			diagnosticReportStatus="idle"
			errorLogMessage="message details report failed"
			item={item}
			onJumpToMessage={input?.onJumpToMessage ?? vi.fn()}
			onOpenChange={input?.onOpenChange ?? vi.fn()}
			onRecoverExecution={input?.onRecoverExecution}
			onReportMessage={input?.onReportMessage ?? vi.fn()}
			onRetryWakeTarget={input?.onRetryWakeTarget}
			onViewInGraph={input?.onViewInGraph}
			onWakeStopRequest={input?.onWakeStopRequest}
			open={true}
			orgSlug="acme"
			replyItems={input?.replyItems ?? []}
			spaceId="space-123"
			spaceReferencesById={input?.spaceReferencesById}
			targetProfileDisplayNamesByProfileId={
				input?.targetProfileDisplayNamesByProfileId
			}
			wakeFailureTargetContextsByProfileId={
				input?.wakeFailureTargetContextsByProfileId
			}
			wakeIssueEntries={input?.wakeIssueEntries}
			wakeProgressEntries={input?.wakeProgressEntries}
			wakeStopTarget={input?.wakeStopTarget}
		/>
	);
}

function getQueryOptions(): Record<string, unknown> {
	return useQueryMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

function createQueryResult(
	input: {
		data?: GetSpaceMessageDetailsResponse;
		isError?: boolean;
		isPending?: boolean;
	} = {}
) {
	return {
		data: input.data,
		isError: input.isError ?? false,
		isPending: input.isPending ?? false,
	};
}

function createTimelineItem(
	input: { id: string } & Partial<SpaceTimelineItem>
): SpaceTimelineItem {
	const { id, ...overrides } = input;
	return {
		attachments: [],
		id,
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
		actorProfileId: "human-1",
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
		text: "hello",
		transientActivityPurpose: null,
		wakeClientMessageId: null,
		wakeSourceSignalId: null,
		wakeTargetProfileIds: [],
		...overrides,
	};
}

function createAgentReplyTimelineItem(
	overrides: Partial<SpaceTimelineItem> = {}
): SpaceTimelineItem {
	return createTimelineItem({
		actorAgentControllerRef: "builtin:codex",
		actorName: "Codex",
		actorProfileId: "agt_triage",
		actorProfileKind: "agent",
		actorProfileName: "Codex",
		id: "sig-agent-reply",
		replyToProfileName: "Felix",
		replyToSignalId: "sig-source",
		text: "Wake completed.",
		wakeSourceSignalId: "sig-source",
		...overrides,
	});
}

function createHumanMessageDetails(): GetSpaceMessageDetailsResponse {
	return {
		query: { spaceId: "space-123", signalId: "sig-human" },
		message: {
			signalId: "sig-human",
			signalType: "signal.text",
			sentAtMs: Date.UTC(2026, 5, 3, 22, 7, 13),
			actor: {
				profileId: "human-1",
				profileKind: "human",
				displayName: "Felix",
				profileName: "Felix",
				profileHandle: null,
			},
		},
		agentContext: notApplicableAgentContext(),
		wakeContext: {
			state: "not_applicable",
			sourceSignalId: notApplicableFact(),
			clientMessageId: notApplicableFact(),
			targets: [],
		},
		replyContext: {
			state: "not_applicable",
			replyingToSignalId: notApplicableFact(),
			replyingToAuthor: notApplicableFact(),
			previewText: notApplicableFact(),
			resolved: false,
		},
		diagnostics: {
			signalId: "sig-human",
			traceSelectors: [
				{
					kind: "signal",
					label: "Message ID",
					value: "sig-human",
					targetProfileId: null,
				},
			],
		},
	};
}

function formatMessageDetailsTestTime(sentAtMs: number): string {
	return new Intl.DateTimeFormat("en-US", {
		dateStyle: "medium",
		timeStyle: "medium",
	}).format(sentAtMs);
}

function createAgentManualMessageDetails(): GetSpaceMessageDetailsResponse {
	return {
		...createHumanMessageDetails(),
		query: { spaceId: "space-123", signalId: "sig-agent-manual" },
		message: {
			...createHumanMessageDetails().message,
			signalId: "sig-agent-manual",
			actor: {
				profileId: "agt_cli",
				profileKind: "agent",
				displayName: "OpenMeld CLI Bot",
				profileName: "OpenMeld CLI Bot",
				profileHandle: null,
			},
		},
		agentContext: {
			state: "recorded",
			profileId: recordedFact("agt_cli", "space_signal_profile"),
			profileName: recordedFact("OpenMeld CLI Bot", "space_signal_profile"),
			agentControllerRef: recordedFact("builtin:codex", "space_signal_profile"),
			agentControllerConversationId: notRecordedFact("space_signal_profile"),
			workspacePath: notRecordedFact("space_signal_profile"),
			openMeldServiceRuntimeId: notRecordedFact("space_signal_profile"),
			bindingId: notRecordedFact("space_signal_profile"),
			workspaceFingerprint: notRecordedFact("space_signal_profile"),
		},
	};
}

function createWakeSuccessReplyDetails(): GetSpaceMessageDetailsResponse {
	const details = createAgentManualMessageDetails();
	return {
		...details,
		query: { spaceId: "space-123", signalId: "sig-agent-reply" },
		message: {
			...details.message,
			signalId: "sig-agent-reply",
		},
		agentContext: recordedAgentContext({
			conversationId: "conv-1",
			workspace: "/Users/felix/.openmeld/workspace",
		}),
		wakeContext: createWakeContext({ status: "replied" }),
		replyContext: {
			state: "recorded",
			replyingToSignalId: recordedFact("sig-source", "reply_signal"),
			replyingToAuthor: recordedFact("Felix", "reply_signal"),
			previewText: recordedFact(
				"@OpenMeld Feedback Triage(wake) please triage",
				"reply_signal"
			),
			resolved: true,
		},
		diagnostics: diagnosticsFor("sig-agent-reply"),
	};
}

function createAgentHandoffMessageDetails(): GetSpaceMessageDetailsResponse {
	const details = createAgentManualMessageDetails();
	return {
		...details,
		query: { spaceId: "space-123", signalId: "sig-agent-handoff" },
		message: {
			...details.message,
			signalId: "sig-agent-handoff",
			actor: {
				...details.message.actor,
				displayName: "Codex 5.6 Sol",
				profileName: "Codex 5.6 Sol",
			},
		},
		agentContext: {
			...details.agentContext,
			profileName: recordedFact("Codex 5.6 Sol", "space_signal_profile"),
		},
		wakeContext: {
			state: "recorded",
			sourceSignalId: recordedFact("sig-agent-handoff", "space_signal"),
			clientMessageId: recordedFact("client-message-handoff", "space_signal"),
			targets: [
				{
					targetProfileId: "agt-center",
					targetLabel: "Center Agent",
					status: "failed",
					terminalStep: "attempt",
					reasonCode: "remote_agent.turn.context_window_exceeded",
					agentContext: {
						state: "recorded",
						profileId: recordedFact("agt-center", "wake_trace"),
						profileName: recordedFact("Center Agent", "wake_trace"),
						agentControllerRef: recordedFact(
							"builtin:codex",
							"wake_trace_execution_context"
						),
						agentControllerConversationId: notRecordedFact(
							"wake_trace_execution_context"
						),
						workspacePath: notRecordedFact("wake_trace_execution_context"),
						openMeldServiceRuntimeId: notRecordedFact(
							"wake_trace_execution_context"
						),
						bindingId: recordedFact(
							"binding-center-agent",
							"wake_trace_execution_context"
						),
						workspaceFingerprint: notRecordedFact(
							"wake_trace_execution_context"
						),
					},
				},
			],
		},
		diagnostics: diagnosticsFor("sig-agent-handoff"),
	};
}

function createWakeFailureNoticeDetails(): GetSpaceMessageDetailsResponse {
	return {
		...createHumanMessageDetails(),
		query: { spaceId: "space-123", signalId: "sig-failure-notice" },
		message: {
			signalId: "sig-failure-notice",
			signalType: "signal.system_notice",
			sentAtMs: Date.UTC(2026, 5, 3, 22, 8),
			actor: {
				profileId: "openmeld-system",
				profileKind: "system",
				displayName: "OpenMeld",
				profileName: "OpenMeld",
				profileHandle: null,
			},
		},
		agentContext: notApplicableAgentContext(),
		wakeContext: createWakeContext(),
		replyContext: {
			state: "recorded",
			replyingToSignalId: recordedFact("sig-source", "reply_signal"),
			replyingToAuthor: recordedFact("Felix", "reply_signal"),
			previewText: recordedFact(
				"@OpenMeld Feedback Triage(wake) broken action",
				"reply_signal"
			),
			resolved: true,
		},
		diagnostics: diagnosticsFor("sig-failure-notice"),
	};
}

function createRedactedAgentMessageDetails(): GetSpaceMessageDetailsResponse {
	const details = createAgentManualMessageDetails();
	return {
		...details,
		query: { spaceId: "space-123", signalId: "sig-redacted-agent" },
		message: {
			...details.message,
			signalId: "sig-redacted-agent",
		},
		agentContext: {
			...details.agentContext,
			agentControllerConversationId: redactedFact("space_signal_profile"),
			workspacePath: redactedFact("space_signal_profile"),
		},
		diagnostics: diagnosticsFor("sig-redacted-agent"),
	};
}

function createWakeContext(
	input: {
		status?: GetSpaceMessageDetailsResponse["wakeContext"]["targets"][number]["status"];
	} = {}
): GetSpaceMessageDetailsResponse["wakeContext"] {
	return {
		state: "recorded",
		sourceSignalId: recordedFact("sig-source", "space_signal"),
		clientMessageId: recordedFact("cm_123", "space_signal"),
		targets: [
			{
				targetProfileId: "agt_triage",
				targetLabel: null,
				...(input.status ? { status: input.status } : {}),
			},
		],
	};
}

function createWakeStopTarget(
	overrides: Partial<SpaceWakeStopTargetResolution> = {}
): SpaceWakeStopTargetResolution {
	return {
		canStop: true,
		clientMessageId: "client-message-1",
		selector: {
			by: "source_signal",
			sourceSignalId: "sig-source",
			targetProfileId: "agt_triage",
		},
		selectorKey: "source_signal:sig-source:agt_triage",
		sourceSignalId: "sig-source",
		status: "active",
		targetLabel: "@runner",
		targetProfileId: "agt_triage",
		...overrides,
	};
}

function createWakeStopResponse(): PostSpaceWakeStopResponse {
	return {
		cancellationState: {
			observedAtMs: Date.UTC(2026, 5, 3, 22, 8),
			reasonCode: null,
			status: "requested",
		},
		ok: true,
		runtimeCoordinatorExecutionId: "rce_123",
		status: "cancellation_requested",
		targetProfileId: "agt_triage",
	};
}

function recordedAgentContext(input: {
	conversationId: string;
	workspace: string;
}): GetSpaceMessageDetailsResponse["agentContext"] {
	return {
		state: "recorded",
		profileId: recordedFact("agt_triage", "wake_trace"),
		profileName: recordedFact("@OpenMeld Feedback Triage", "wake_trace"),
		agentControllerRef: recordedFact(
			"builtin:codex",
			"wake_trace_execution_context"
		),
		agentControllerConversationId: recordedFact(
			input.conversationId,
			"wake_trace_execution_context"
		),
		workspacePath: recordedFact(
			input.workspace,
			"wake_trace_execution_context"
		),
		openMeldServiceRuntimeId: recordedFact(
			"runtime-1",
			"wake_trace_execution_context"
		),
		bindingId: recordedFact("binding-1", "wake_trace_execution_context"),
		workspaceFingerprint: recordedFact(
			"sha256:abc",
			"wake_trace_execution_context"
		),
	};
}

function diagnosticsFor(
	signalId: string
): GetSpaceMessageDetailsResponse["diagnostics"] {
	return {
		signalId,
		traceSelectors: [
			{
				kind: "signal",
				label: "Message ID",
				value: signalId,
				targetProfileId: null,
			},
			{
				kind: "wake_source_signal",
				label: "Wake source signal ID",
				value: "sig-source",
				targetProfileId: null,
			},
		],
	};
}

function notApplicableAgentContext(): GetSpaceMessageDetailsResponse["agentContext"] {
	return {
		state: "not_applicable",
		profileId: notApplicableFact(),
		profileName: notApplicableFact(),
		agentControllerRef: notApplicableFact(),
		agentControllerConversationId: notApplicableFact(),
		workspacePath: notApplicableFact(),
		openMeldServiceRuntimeId: notApplicableFact(),
		bindingId: notApplicableFact(),
		workspaceFingerprint: notApplicableFact(),
	};
}

function recordedFact(
	value: string,
	source: GetSpaceMessageDetailsResponse["agentContext"]["profileId"]["source"]
) {
	return {
		state: "recorded" as const,
		value,
		source,
	};
}

function notRecordedFact(
	source: GetSpaceMessageDetailsResponse["agentContext"]["profileId"]["source"]
) {
	return {
		state: "not_recorded" as const,
		value: null,
		source,
	};
}

function redactedFact(
	source: GetSpaceMessageDetailsResponse["agentContext"]["profileId"]["source"]
) {
	return {
		state: "redacted" as const,
		value: null,
		source,
	};
}

function notApplicableFact() {
	return {
		state: "not_applicable" as const,
		value: null,
		source: "none" as const,
	};
}
