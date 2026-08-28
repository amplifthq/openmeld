import type {
	AgentInteractionPendingSummary,
	AgentInteractionRequest,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	resolveSpacePermissionModeShortcut,
	SpacePendingAgentActions,
} from "./space-pending-agent-actions";

const APPROVE_ALL_PATTERN = /approve all/i;
const ACTION_NEEDS_YOU_PATTERN = /action needs you/i;

describe("SpacePendingAgentActions", () => {
	afterEach(() => {
		cleanup();
	});

	it("shows a quiet owner-only reminder without opening or moving focus", () => {
		const trigger = document.createElement("button");
		document.body.appendChild(trigger);
		trigger.focus();

		render(
			<SpacePendingAgentActions
				items={[
					createPermissionItem({
						interactionId: "interaction-owner",
					}),
					createPermissionItem({
						canRespond: false,
						interactionId: "interaction-other-owner",
						request: null,
					}),
				]}
				onRespond={vi.fn().mockResolvedValue(undefined)}
			/>
		);

		expect(
			screen
				.getByRole("button", { name: "1 action needs you" })
				.getAttribute("aria-expanded")
		).toBe("false");
		expect(screen.queryByText("Allow this command?")).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("opens one request at a time and supports explicit previous and next navigation", () => {
		render(
			<SpacePendingAgentActions
				items={[
					createPermissionItem({
						interactionId: "interaction-first",
						targetLabel: "@Runner",
						title: "Allow the first command?",
					}),
					createPermissionItem({
						interactionId: "interaction-second",
						targetLabel: "@Reviewer",
						title: "Allow the second command?",
					}),
				]}
				onRespond={vi.fn().mockResolvedValue(undefined)}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "2 actions need you" }));
		expect(screen.getByText("Action 1 of 2")).toBeTruthy();
		expect(screen.getByText("Allow the first command?")).toBeTruthy();
		expect(screen.queryByText("Allow the second command?")).toBeNull();
		expect(
			screen.queryByRole("button", { name: APPROVE_ALL_PATTERN })
		).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Next action" }));
		expect(screen.getByText("Action 2 of 2")).toBeTruthy();
		expect(screen.getByText("Allow the second command?")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Previous action" }));
		expect(screen.getByText("Allow the first command?")).toBeTruthy();
	});

	it("closes on Escape and returns focus to its trigger", () => {
		render(
			<SpacePendingAgentActions
				items={[createPermissionItem({ interactionId: "interaction-escape" })]}
				onRespond={vi.fn().mockResolvedValue(undefined)}
			/>
		);

		const trigger = screen.getByRole("button", { name: "1 action needs you" });
		fireEvent.click(trigger);
		const choice = screen.getByRole("radio", { name: "Allow once" });
		choice.focus();
		fireEvent.keyDown(choice, { key: "Escape" });

		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(document.activeElement).toBe(trigger);
	});

	it("resumes the Wake before starting the optional background permission-mode save", async () => {
		let resolveApproval!: () => void;
		const approval = new Promise<void>((resolve) => {
			resolveApproval = resolve;
		});
		const onRespond = vi.fn(() => approval);
		const onPermissionModeUpdate = vi.fn();

		render(
			<SpacePendingAgentActions
				items={[createPermissionItem({ interactionId: "interaction-mode" })]}
				onPermissionModeUpdate={onPermissionModeUpdate}
				onRespond={onRespond}
				permissionModeShortcutsByProfileId={
					new Map([
						[
							"agent-runner",
							{
								description:
									"Let Claude Code automatically run actions it considers safe.",
								label: "Auto mode",
								permissionMode: "claude-code:auto" as const,
							},
						],
					])
				}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "1 action needs you" }));
		fireEvent.click(screen.getByRole("radio", { name: "Allow once" }));
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: "Also use Auto mode for future requests",
			})
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Approve and continue" })
		);

		expect(onRespond).toHaveBeenCalledTimes(1);
		expect(onPermissionModeUpdate).not.toHaveBeenCalled();
		resolveApproval();

		expect(
			await screen.findByText("@Runner is resuming this Wake.")
		).toBeTruthy();
		expect(onPermissionModeUpdate).toHaveBeenCalledWith({
			permissionMode: "claude-code:auto",
			profileId: "agent-runner",
		});
	});

	it("returns focus to the supplied fallback when authoritative state clears", async () => {
		const returnFocusRef = createRef<HTMLButtonElement>();
		const item = createPermissionItem({ interactionId: "interaction-cleared" });
		const view = render(
			<>
				<button ref={returnFocusRef} type="button">
					Composer fallback
				</button>
				<SpacePendingAgentActions
					items={[item]}
					onRespond={vi.fn().mockResolvedValue(undefined)}
					returnFocusRef={returnFocusRef}
				/>
			</>
		);

		fireEvent.click(screen.getByRole("button", { name: "1 action needs you" }));
		const allowChoice = screen.getByRole("radio", { name: "Allow once" });
		allowChoice.focus();
		expect(document.activeElement).toBe(allowChoice);

		view.rerender(
			<>
				<button ref={returnFocusRef} type="button">
					Composer fallback
				</button>
				<SpacePendingAgentActions
					items={[]}
					onRespond={vi.fn().mockResolvedValue(undefined)}
					returnFocusRef={returnFocusRef}
				/>
			</>
		);

		await waitFor(() => {
			expect(document.activeElement).toBe(returnFocusRef.current);
		});
		expect(
			screen.queryByRole("button", { name: ACTION_NEEDS_YOU_PATTERN })
		).toBeNull();
	});
});

describe("resolveSpacePermissionModeShortcut", () => {
	it("uses the controller-native low-interruption mode and skips an already-saved mode", () => {
		expect(
			resolveSpacePermissionModeShortcut({
				agentControllerPermissionMode: "claude-code:default",
				agentControllerRef: "builtin:claude-code",
			})
		).toMatchObject({
			label: "Auto mode",
			permissionMode: "claude-code:auto",
		});
		expect(
			resolveSpacePermissionModeShortcut({
				agentControllerPermissionMode: "claude-code:auto",
				agentControllerRef: "builtin:claude-code",
			})
		).toBeNull();
	});

	it("does not invent a generic permission mode for OpenCode or unknown controllers", () => {
		expect(
			resolveSpacePermissionModeShortcut({
				agentControllerPermissionMode: undefined,
				agentControllerRef: "builtin:opencode",
			})
		).toBeNull();
		expect(
			resolveSpacePermissionModeShortcut({
				agentControllerPermissionMode: undefined,
				agentControllerRef: "builtin:future-controller",
			})
		).toBeNull();
	});
});

function createPermissionItem(input: {
	canRespond?: boolean;
	interactionId: string;
	request?: AgentInteractionRequest | null;
	targetLabel?: string;
	title?: string;
}): WakeProgressItem {
	const request =
		input.request === undefined
			? ({
					expiresAtMs: Date.UTC(2026, 7, 30),
					interactionId: input.interactionId,
					kind: "permission",
					options: [
						{
							intent: "allow_once",
							label: "Allow once",
							optionId: "allow-once",
						},
						{
							intent: "deny",
							label: "Deny",
							optionId: "deny",
						},
					],
					requestedAtMs: Date.UTC(2026, 7, 29),
					subject: {
						command: "pnpm test",
						type: "command",
					},
					title: input.title ?? "Allow this command?",
					v: 1,
				} satisfies AgentInteractionRequest)
			: input.request;
	const pendingKind: AgentInteractionPendingSummary["kind"] =
		request?.kind ?? "permission";
	return {
		clientMessageId: `client-${input.interactionId}`,
		dispatchId: `dispatch-${input.interactionId}`,
		failureReasonCode: null,
		message: "The Agent is waiting for your response.",
		pendingInteraction: {
			canRespond: input.canRespond ?? true,
			expiresAtMs: request?.expiresAtMs ?? Date.UTC(2026, 7, 30),
			interactionId: input.interactionId,
			kind: pendingKind,
			request,
			requestedAtMs: request?.requestedAtMs ?? Date.UTC(2026, 7, 29),
		},
		phase: "running",
		runtimeCoordinatorExecutionId: `rce-${input.interactionId}`,
		sourceSignalId: `signal-${input.interactionId}`,
		targetLabel: input.targetLabel ?? "@Runner",
		targetProfileId: "agent-runner",
		terminal: false,
		updatedAtMs: Date.UTC(2026, 7, 29),
	};
}
