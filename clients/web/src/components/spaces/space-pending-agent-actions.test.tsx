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
	resolveSpacePendingAgentActionSurfacePlacement,
	resolveSpacePermissionModeShortcut,
} from "./space-pending-agent-action-model";
import { SpacePendingAgentActions } from "./space-pending-agent-actions";

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

	it("keeps each request form fresh while moving between pending actions", () => {
		render(
			<SpacePendingAgentActions
				items={[
					createPermissionItem({
						interactionId: "interaction-first",
						title: "Allow the first command?",
					}),
					createPermissionItem({
						interactionId: "interaction-second",
						title: "Allow the second command?",
					}),
				]}
				onRespond={vi.fn().mockResolvedValue(undefined)}
				permissionModeShortcutsByProfileId={createPermissionModeShortcuts()}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "2 actions need you" }));
		fireEvent.click(screen.getByRole("radio", { name: "Allow once" }));
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: "Also use Auto mode for future requests",
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Next action" }));

		expect(screen.getByText("Allow the second command?")).toBeTruthy();
		expect(
			screen
				.getByRole("radio", { name: "Allow once" })
				.getAttribute("aria-checked")
		).toBe("false");
		expect(
			screen.queryByRole("checkbox", {
				name: "Also use Auto mode for future requests",
			})
		).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Previous action" }));
		expect(
			screen
				.getByRole("radio", { name: "Allow once" })
				.getAttribute("aria-checked")
		).toBe("false");
	});

	it("does not carry a question draft into another request", () => {
		render(
			<SpacePendingAgentActions
				items={[
					createPermissionItem({
						interactionId: "question-first",
						request: createQuestionRequest({
							interactionId: "question-first",
							prompt: "What should the first Wake do?",
							title: "Answer the first Wake",
						}),
					}),
					createPermissionItem({
						interactionId: "question-second",
						request: createQuestionRequest({
							interactionId: "question-second",
							prompt: "What should the second Wake do?",
							title: "Answer the second Wake",
						}),
					}),
				]}
				onRespond={vi.fn().mockResolvedValue(undefined)}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "2 actions need you" }));
		fireEvent.click(screen.getByRole("radio", { name: "Other" }));
		fireEvent.change(screen.getByLabelText("Your answer"), {
			target: { value: "Keep this draft with the first Wake" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Next action" }));

		expect(screen.getByText("Answer the second Wake")).toBeTruthy();
		expect(screen.queryByLabelText("Your answer")).toBeNull();
		expect(
			screen.getByRole("radio", { name: "Other" }).getAttribute("aria-checked")
		).toBe("false");
		fireEvent.click(screen.getByRole("radio", { name: "Other" }));
		expect(
			(screen.getByLabelText("Your answer") as HTMLInputElement).value
		).toBe("");
	});

	it("keeps two Wakes with the same provider interaction id separately actionable", () => {
		render(
			<SpacePendingAgentActions
				items={[
					createPermissionItem({
						interactionId: "provider-interaction",
						runtimeCoordinatorExecutionId: "execution-first",
						title: "Allow the first Wake?",
					}),
					createPermissionItem({
						interactionId: "provider-interaction",
						runtimeCoordinatorExecutionId: "execution-second",
						title: "Allow the second Wake?",
					}),
				]}
				onRespond={vi.fn().mockResolvedValue(undefined)}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "2 actions need you" }));
		expect(screen.getByText("Allow the first Wake?")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Next action" }));
		expect(screen.getByText("Allow the second Wake?")).toBeTruthy();
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

	it("keeps the next request actionable after the previous request was submitted", async () => {
		const onRespond = vi.fn().mockResolvedValue(undefined);

		render(
			<SpacePendingAgentActions
				items={[
					createPermissionItem({
						interactionId: "interaction-submitted",
						title: "Allow the submitted command?",
					}),
					createPermissionItem({
						interactionId: "interaction-next",
						title: "Allow the next command?",
					}),
				]}
				onRespond={onRespond}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "2 actions need you" }));
		fireEvent.click(screen.getByRole("radio", { name: "Allow once" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Approve and continue" })
		);
		expect(
			await screen.findByText("@Runner is resuming this Wake.")
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Next action" }));
		expect(screen.getByText("Allow the next command?")).toBeTruthy();
		expect(screen.getByRole("radio", { name: "Allow once" })).toBeTruthy();
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

	it("does not reclaim focus after the user manually collapses the surface", async () => {
		const scenario = renderFocusScenario("interaction-collapsed-before-clear");

		const trigger = screen.getByRole("button", { name: "1 action needs you" });
		fireEvent.click(trigger);
		const allowChoice = screen.getByRole("radio", { name: "Allow once" });
		allowChoice.focus();
		fireEvent.click(trigger);
		scenario.outsideFocusRef.current?.focus();
		scenario.clearRequest();

		await waitFor(() => {
			expect(document.activeElement).toBe(scenario.outsideFocusRef.current);
		});
	});

	it("does not reclaim focus after the user moves outside the open surface", async () => {
		const scenario = renderFocusScenario("interaction-unfocused-before-clear");

		fireEvent.click(screen.getByRole("button", { name: "1 action needs you" }));
		const allowChoice = screen.getByRole("radio", { name: "Allow once" });
		allowChoice.focus();
		scenario.outsideFocusRef.current?.focus();
		scenario.clearRequest();

		await waitFor(() => {
			expect(document.activeElement).toBe(scenario.outsideFocusRef.current);
		});
	});

	it("returns focus when the focused request clears but another request remains", async () => {
		const returnFocusRef = createRef<HTMLButtonElement>();
		const firstItem = createPermissionItem({
			interactionId: "interaction-cleared-first",
			title: "Allow the first command?",
		});
		const secondItem = createPermissionItem({
			interactionId: "interaction-cleared-second",
			title: "Allow the second command?",
		});
		const view = render(
			<>
				<button ref={returnFocusRef} type="button">
					Composer fallback
				</button>
				<SpacePendingAgentActions
					items={[firstItem, secondItem]}
					onRespond={vi.fn().mockResolvedValue(undefined)}
					returnFocusRef={returnFocusRef}
				/>
			</>
		);

		fireEvent.click(screen.getByRole("button", { name: "2 actions need you" }));
		const allowChoice = screen.getByRole("radio", { name: "Allow once" });
		fireEvent.click(allowChoice);
		allowChoice.focus();

		view.rerender(
			<>
				<button ref={returnFocusRef} type="button">
					Composer fallback
				</button>
				<SpacePendingAgentActions
					items={[secondItem]}
					onRespond={vi.fn().mockResolvedValue(undefined)}
					returnFocusRef={returnFocusRef}
				/>
			</>
		);

		await waitFor(() => {
			expect(document.activeElement).toBe(returnFocusRef.current);
		});
		expect(
			screen.getByText("@Runner is waiting for your response")
		).toBeTruthy();
		expect(screen.queryByText("Allow the second command?")).toBeNull();
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

describe("resolveSpacePendingAgentActionSurfacePlacement", () => {
	it("uses exactly the panel whose composer is currently visible", () => {
		expect(
			resolveSpacePendingAgentActionSurfacePlacement({ hasActiveThread: false })
		).toBe("conversation");
		expect(
			resolveSpacePendingAgentActionSurfacePlacement({ hasActiveThread: true })
		).toBe("thread");
	});
});

function renderFocusScenario(interactionId: string) {
	const returnFocusRef = createRef<HTMLButtonElement>();
	const outsideFocusRef = createRef<HTMLButtonElement>();
	const renderScenario = (items: readonly WakeProgressItem[]) => (
		<>
			<button ref={returnFocusRef} type="button">
				Composer fallback
			</button>
			<button ref={outsideFocusRef} type="button">
				Outside focus
			</button>
			<SpacePendingAgentActions
				items={items}
				onRespond={vi.fn().mockResolvedValue(undefined)}
				returnFocusRef={returnFocusRef}
			/>
		</>
	);
	const view = render(
		renderScenario([createPermissionItem({ interactionId })])
	);

	return {
		clearRequest: () => view.rerender(renderScenario([])),
		outsideFocusRef,
	};
}

function createPermissionItem(input: {
	canRespond?: boolean;
	interactionId: string;
	request?: AgentInteractionRequest | null;
	runtimeCoordinatorExecutionId?: string;
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
		runtimeCoordinatorExecutionId:
			input.runtimeCoordinatorExecutionId ?? `rce-${input.interactionId}`,
		sourceSignalId: `signal-${input.interactionId}`,
		targetLabel: input.targetLabel ?? "@Runner",
		targetProfileId: "agent-runner",
		terminal: false,
		updatedAtMs: Date.UTC(2026, 7, 29),
	};
}

function createPermissionModeShortcuts() {
	return new Map([
		[
			"agent-runner",
			{
				description:
					"Let Claude Code automatically run actions it considers safe.",
				label: "Auto mode",
				permissionMode: "claude-code:auto" as const,
			},
		],
	]);
}

function createQuestionRequest(input: {
	interactionId: string;
	prompt: string;
	title: string;
}): AgentInteractionRequest {
	return {
		expiresAtMs: Date.UTC(2026, 7, 30),
		interactionId: input.interactionId,
		kind: "question",
		questions: [
			{
				allowOther: true,
				header: "Direction",
				multiple: false,
				options: [],
				prompt: input.prompt,
				questionId: "direction",
			},
		],
		requestedAtMs: Date.UTC(2026, 7, 29),
		title: input.title,
		v: 1,
	};
}
