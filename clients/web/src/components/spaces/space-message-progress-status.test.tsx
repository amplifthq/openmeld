import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import type { SpaceMessageWakeThinkingEntry } from "#/lib/spaces/wake-progress-presentation";
import { SpaceMessageProgressStatus } from "./space-message-progress-status";

const AGENT_WORKING_TEXT_PATTERN = /Agent is working/;

afterEach(() => {
	vi.useRealTimers();
	cleanup();
});

describe("SpaceMessageProgressStatus", () => {
	it("shows honest optimistic work without inventing an elapsed start time", () => {
		const view = render(
			<SpaceMessageProgressStatus entries={[]} item={createStartingItem()} />
		);

		const startingStatus = screen.getByRole("status", {
			name: "Agent is working",
		});
		expect(startingStatus.textContent).toBe("Agent is working");
		expect(
			startingStatus.querySelector('[data-slot="agent-thinking-elapsed"]')
		).toBeNull();

		view.rerender(
			<SpaceMessageProgressStatus entries={[]} item={createStreamingItem()} />
		);

		expect(
			document.querySelector('[data-slot="agent-thinking-elapsed"]')
		).toBeNull();
		expect(
			screen.getByRole("status", { name: "Agent is working" }).textContent
		).toBe("Agent is working");
	});

	it.each([
		["failed", "Reply failed"],
		["stopped", "Stopped"],
		["completed_but_publish_failed", "Reply could not be posted"],
	] as const)("removes optimistic thinking for the %s terminal state", (status, statusText) => {
		const view = render(
			<SpaceMessageProgressStatus entries={[]} item={createStartingItem()} />
		);
		const terminalItem = createStreamingItem();
		terminalItem.agentStreamState = {
			reasonCode: "remote_agent.test",
			sequence: 2,
			status,
			streamId: "local-agent:dispatch-1:attempt-1",
		};

		view.rerender(
			<SpaceMessageProgressStatus entries={[]} item={terminalItem} />
		);

		expect(
			document.querySelector('[data-slot="agent-thinking-elapsed"]')
		).toBeNull();
		expect(screen.getByRole("status", { name: statusText })).toBeTruthy();
	});

	it("keeps the explicit working state beside live tool activity", () => {
		const onOpenMessageDetails = vi.fn();
		const view = render(
			<SpaceMessageProgressStatus
				align="end"
				control={<button type="button">Stop</button>}
				entries={[createWakeProgressEntry()]}
				item={createStreamingToolActivityItem()}
				onOpenMessageDetails={onOpenMessageDetails}
			/>
		);

		expect(view.container.childElementCount).toBe(1);
		expect(screen.queryByText("Responding...")).toBeNull();
		expect(screen.getByText(AGENT_WORKING_TEXT_PATTERN)).toBeTruthy();

		const activity = screen.getByTestId("space-agent-tool-activity");
		const row = activity.closest("[data-slot='space-message-progress-row']");
		expect(row?.getAttribute("data-align")).toBe("end");
		expect(
			within(row as HTMLElement).getByRole("button", { name: "Stop" })
		).toBeTruthy();

		const activityTrigger = screen.getByRole("button", {
			name: "Agent is working. Work summary: Reviewing source files…",
		});
		expect(activityTrigger).toBe(activity);
		fireEvent.click(
			screen.getByRole("button", { name: "Open message details" })
		);
		expect(onOpenMessageDetails).toHaveBeenCalledOnce();
	});

	it("shows one working state when a live stream has no visible tool activity", () => {
		render(
			<SpaceMessageProgressStatus
				entries={[createWakeProgressEntry()]}
				item={createStreamingItem()}
			/>
		);

		expect(screen.getAllByText(AGENT_WORKING_TEXT_PATTERN)).toHaveLength(1);
		expect(screen.queryByText("Responding...")).toBeNull();
	});

	it("keeps the working state explicit beside a live output preview", () => {
		render(
			<SpaceMessageProgressStatus
				entries={[createWakePreviewEntry()]}
				item={createStreamingItem()}
			/>
		);

		expect(
			screen.getByText("Agent is working · Checking the release configuration…")
		).toBeTruthy();
		expect(screen.getAllByText(AGENT_WORKING_TEXT_PATTERN)).toHaveLength(1);
	});

	it.each([
		"Finalizing reply",
		"Starting Wake",
		"Stopping Wake",
	])("keeps the authoritative working state beside the %s phase", (phase) => {
		render(
			<SpaceMessageProgressStatus
				entries={[createWakeProgressEntry({ text: phase })]}
				item={createStreamingItem()}
			/>
		);

		expect(
			screen.getByTestId("space-wake-thinking-indicator").textContent
		).toBe(`Agent is working · ${phase} · 0s`);
		expect(screen.getAllByText(AGENT_WORKING_TEXT_PATTERN)).toHaveLength(1);
	});

	it("does not claim the Agent is working before the stream begins", () => {
		const item = createStreamingItem();
		item.agentStreamState = undefined;

		render(
			<SpaceMessageProgressStatus
				entries={[createWakeProgressEntry({ text: "Starting Wake" })]}
				item={item}
			/>
		);

		expect(
			screen.getByTestId("space-wake-thinking-indicator").textContent
		).toBe("Starting Wake · 0s");
		expect(screen.queryByText(AGENT_WORKING_TEXT_PATTERN)).toBeNull();
	});

	it("uses the canonical working state when the live stream is the only evidence", () => {
		render(
			<SpaceMessageProgressStatus
				control={<button type="button">Stop</button>}
				entries={[]}
				item={createStreamingItem()}
			/>
		);

		expect(
			screen.getByRole("status", { name: "Agent is working" })
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
		expect(screen.queryByText("Responding...")).toBeNull();
	});

	it("keeps the working state and Stop control beside partial reply text", () => {
		const item = createStreamingItem();
		item.text = "I am working through the request.";

		const view = render(
			<SpaceMessageProgressStatus
				control={<button type="button">Stop</button>}
				entries={[createWakeProgressEntry()]}
				item={item}
			/>
		);

		expect(screen.getAllByText(AGENT_WORKING_TEXT_PATTERN)).toHaveLength(1);
		expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();

		view.rerender(
			<SpaceMessageProgressStatus
				entries={[createWakeProgressEntry()]}
				item={item}
			/>
		);
		expect(screen.getAllByText(AGENT_WORKING_TEXT_PATTERN)).toHaveLength(1);
		expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
	});

	it("keeps one explicit working presentation with live activity and partial text", () => {
		const item = createStreamingToolActivityItem();
		item.text = "I am working through the request.";

		render(
			<SpaceMessageProgressStatus
				control={<button type="button">Stop</button>}
				entries={[createWakeProgressEntry()]}
				item={item}
			/>
		);

		expect(screen.getAllByText(AGENT_WORKING_TEXT_PATTERN)).toHaveLength(1);
		expect(
			screen.getByRole("button", {
				name: "Agent is working. Work summary: Reviewing source files…",
			})
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
	});

	it.each([
		["failed", "Reply failed"],
		["stopped", "Stopped"],
		["completed_but_publish_failed", "Reply could not be posted"],
	] as const)("lets the %s stream state replace stale working progress", (status, statusText) => {
		const item = createStreamingItem();
		item.agentStreamState = {
			reasonCode: "remote_agent.test",
			sequence: 2,
			status,
			streamId: "local-agent:dispatch-1:attempt-1",
		};

		render(
			<SpaceMessageProgressStatus
				entries={[createWakeProgressEntry()]}
				item={item}
			/>
		);

		expect(screen.getByRole("status", { name: statusText })).toBeTruthy();
		expect(screen.queryByText(AGENT_WORKING_TEXT_PATTERN)).toBeNull();
	});
});

function createWakeProgressEntry(
	overrides: Partial<SpaceMessageWakeThinkingEntry> = {}
): SpaceMessageWakeThinkingEntry {
	return {
		elapsedStartedAtMs: 1_800_000_000_000,
		key: "dispatch:agt_runner",
		kind: "progress",
		phase: "running",
		step: {
			description: "OpenMeld is running the agent.",
			label: "Agent is working",
			status: "active",
		},
		targetProfileId: "agt_runner",
		text: "Agent is working",
		...overrides,
	};
}

function createWakePreviewEntry(): SpaceMessageWakeThinkingEntry {
	return {
		elapsedStartedAtMs: null,
		key: "dispatch:agt_runner:preview",
		kind: "preview",
		phase: "writing",
		step: {
			description: "OpenMeld is receiving live output from the agent.",
			label: "Agent is working",
			status: "active",
		},
		targetProfileId: "agt_runner",
		text: "Checking the release configuration…",
	};
}

function createStreamingToolActivityItem(): SpaceTimelineItem {
	return createStreamingItem([
		{
			state: "input-available",
			toolCallId: "tool-call-1",
			toolName: "agent_read_files",
			type: "tool",
			work: { key: "source.read", v: 1 },
		},
	]);
}

function createStartingItem(): SpaceTimelineItem {
	const item = createStreamingItem();
	item.agentStreamState = undefined;
	item.deliveryState = "pending";
	item.optimisticAgentReplyState = "working";
	return item;
}

function createStreamingItem(
	toolParts: NonNullable<
		NonNullable<SpaceTimelineItem["agentStreamState"]>["toolParts"]
	> = []
): SpaceTimelineItem {
	return {
		actorAgentControllerRef: null,
		actorAvatarImageUrl: null,
		actorControllerDisplay: null,
		actorName: "Runner",
		actorOwnerDisplay: null,
		actorOwnerName: null,
		actorOwnerUserId: null,
		actorProfileId: "agt_runner",
		actorProfileKind: "agent",
		actorProfileName: "Runner",
		actorRuntimeDeviceDisplayName: null,
		agentControllerConversationId: null,
		agentStreamState: {
			reasonCode: null,
			sequence: 1,
			status: "streaming",
			streamId: "local-agent:dispatch-1:attempt-1",
			toolParts,
		},
		agentWorkspace: null,
		attachments: [],
		clientMessageId: null,
		createdAtMs: 1_800_000_000_000,
		deliveryState: "sent",
		id: "stream:local-agent",
		newMessagesDuringComposition: null,
		replyPreviewText: null,
		replyToProfileName: null,
		replyToSignalId: null,
		signalType: "signal.text",
		spaceId: "space-1",
		systemNoticeType: null,
		text: "",
		transientActivityPurpose: null,
		wakeClientMessageId: null,
		wakeSourceSignalId: null,
		wakeTargetProfileIds: [],
	};
}
