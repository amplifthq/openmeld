import type {
	AgentInteractionPendingSummary,
	AgentInteractionRequest,
	PluginActionRequestView,
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
	partitionSpacePendingAgentActions,
	resolveSpacePermissionModeOptions,
} from "./space-pending-agent-action-model";
import { SpacePendingAgentActions } from "./space-pending-agent-actions";

const APPROVE_ALL_PATTERN = /approve all/i;
const ACTION_NEEDS_YOU_PATTERN = /action needs you/i;
const WAITING_TO_CONTINUE_PATTERN = /to continue\./;

describe("SpacePendingAgentActions", () => {
	it("keeps Plugin Thread requests in the same tray as Local Agent actions", () => {
		const onOpen = vi.fn();
		const plugin: PluginActionRequestView = {
			requestId: "11111111-1111-4111-8111-111111111111",
			inboxItemId: "approval",
			state: "pending",
			service: "github",
			actionId: "create_issue",
			effect: "write",
			accountName: "Team GitHub",
			accountScope: "shared",
			actorProfileId: "agent",
			inputFieldCount: 1,
			targets: [],
			createdAtMs: 0,
			expiresAtMs: Date.now() + 60_000,
			sourceSignalId: "offscreen",
			sourceThreadId: "thread-one",
		};
		const { rerender } = render(
			<SpacePendingAgentActions
				items={[createPermissionItem({ interactionId: "local" })]}
				onOpenPluginRequestThread={onOpen}
				onRespond={vi.fn().mockResolvedValue(undefined)}
				pluginRequests={[plugin]}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "2 actions need you" }));
		fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
		expect(onOpen).toHaveBeenCalledWith(plugin);
		fireEvent.click(screen.getByRole("button", { name: "Next action" }));
		expect(screen.getByText("Allow this command?")).toBeTruthy();
		rerender(
			<SpacePendingAgentActions
				items={[createPermissionItem({ interactionId: "local" })]}
				onOpenPluginRequestThread={onOpen}
				onRespond={vi.fn().mockResolvedValue(undefined)}
				pluginRequests={[]}
			/>
		);
		expect(
			screen.getByRole("button", { name: "1 action needs you" })
		).toBeTruthy();
		expect(screen.getByText("Allow this command?")).toBeTruthy();
	});
	afterEach(() => {
		cleanup();
	});

	it("never changes the mode when the card was already handled elsewhere", async () => {
		const onPermissionModeUpdate = vi.fn();
		const onResolve = vi
			.fn()
			.mockRejectedValue(new Error("This suggestion was already handled."));
		render(
			<SpacePendingAgentActions
				editableAgentProfileIds={new Set(["agt-owned"])}
				items={[]}
				onPermissionModeUpdate={onPermissionModeUpdate}
				onResolvePermissionModeSuggestion={onResolve}
				permissionModeSuggestions={[
					{
						agentProfileId: "agt-owned",
						currentPermissionMode: "claude-code:default",
						offeredAtMs: 1,
						spaceId: "space",
						suggestedPermissionMode: "claude-code:acceptEdits",
						suggestionId: "suggestion-2",
						waitingApprovalCount: 3,
					},
				]}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "1 action needs you" }));
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toContain("already handled")
		);
		expect(onPermissionModeUpdate).not.toHaveBeenCalled();
	});

	it("shows a permission-mode suggestion only to an owner who can edit that Agent", async () => {
		const suggestion = {
			agentProfileId: "agt-owned",
			currentPermissionMode: "claude-code:default" as const,
			offeredAtMs: 1,
			spaceId: "space",
			suggestedPermissionMode: "claude-code:acceptEdits" as const,
			suggestionId: "suggestion-1",
			waitingApprovalCount: 4,
		};
		const onPermissionModeUpdate = vi.fn().mockResolvedValue({
			bindingId: "binding",
			mode: "claude-code:acceptEdits",
		});
		const onResolve = vi.fn().mockResolvedValue(undefined);
		const { rerender } = render(
			<SpacePendingAgentActions
				editableAgentProfileIds={new Set(["agt-someone-else"])}
				items={[]}
				onPermissionModeUpdate={onPermissionModeUpdate}
				onResolvePermissionModeSuggestion={onResolve}
				permissionModeSuggestions={[suggestion]}
			/>
		);
		// A viewer who cannot edit that Agent (not its owner) sees nothing.
		expect(screen.queryByText(ACTION_NEEDS_YOU_PATTERN)).toBeNull();

		rerender(
			<SpacePendingAgentActions
				editableAgentProfileIds={new Set(["agt-owned"])}
				items={[]}
				onPermissionModeUpdate={onPermissionModeUpdate}
				onResolvePermissionModeSuggestion={onResolve}
				permissionModeSuggestions={[suggestion]}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "1 action needs you" }));
		expect(screen.getByText("Switch to Accept edits?")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		await waitFor(() =>
			expect(onPermissionModeUpdate).toHaveBeenCalledWith({
				permissionMode: "claude-code:acceptEdits",
				profileId: "agt-owned",
			})
		);
		expect(onResolve).toHaveBeenCalledWith({
			resolution: "applied",
			suggestionId: "suggestion-1",
		});
		expect(onResolve.mock.invocationCallOrder[0]).toBeLessThan(
			onPermissionModeUpdate.mock.invocationCallOrder[0] ?? 0
		);
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
				onPermissionModeUpdate={vi.fn()}
				onRespond={vi.fn().mockResolvedValue(undefined)}
				permissionModeOptionsByProfileId={createPermissionModeOptions()}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "2 actions need you" }));
		fireEvent.click(screen.getByRole("radio", { name: "Allow once" }));
		fireEvent.click(
			screen.getByRole("radio", {
				name: "Auto mode",
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
			screen.queryByRole("radio", {
				name: "Auto mode",
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

	it("saves the mode before releasing approval and sends its canonical Binding reference", async () => {
		let resolveSave!: (value: {
			bindingId: string;
			mode: "claude-code:auto";
		}) => void;
		const saved = new Promise<{
			bindingId: string;
			mode: "claude-code:auto";
		}>((resolve) => {
			resolveSave = resolve;
		});
		const onRespond = vi.fn().mockResolvedValue(undefined);
		const onPermissionModeUpdate = vi.fn(() => saved);

		render(
			<SpacePendingAgentActions
				items={[createPermissionItem({ interactionId: "interaction-mode" })]}
				onPermissionModeUpdate={onPermissionModeUpdate}
				onRespond={onRespond}
				permissionModeOptionsByProfileId={
					new Map([
						[
							"agent-runner",
							[
								{
									description:
										"Let Claude Code automatically run actions it considers safe.",
									label: "Auto mode",
									permissionMode: "claude-code:auto" as const,
								},
							],
						],
					])
				}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "1 action needs you" }));
		fireEvent.click(screen.getByRole("radio", { name: "Allow once" }));
		fireEvent.click(
			screen.getByRole("radio", {
				name: "Auto mode",
			})
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Approve and continue" })
		);

		expect(onRespond).not.toHaveBeenCalled();
		expect(onPermissionModeUpdate).toHaveBeenCalledTimes(1);
		const reference = {
			bindingId: "binding-1",
			mode: "claude-code:auto" as const,
		};
		resolveSave(reference);

		await waitFor(() => {
			expect(
				screen.queryByRole("button", { name: ACTION_NEEDS_YOU_PATTERN })
			).toBeNull();
		});
		expect(onRespond).toHaveBeenCalledWith(
			expect.objectContaining({
				response: {
					kind: "permission",
					optionId: "allow-once",
					permissionModeUpdate: reference,
				},
			})
		);
		expect(onPermissionModeUpdate).toHaveBeenCalledWith({
			permissionMode: "claude-code:auto",
			profileId: "agent-runner",
		});
	});

	it("requires Full access confirmation and keeps approval pending when saving fails", async () => {
		const onRespond = vi.fn();
		const onPermissionModeUpdate = vi
			.fn()
			.mockRejectedValue(new Error("Permission settings could not be saved."));
		render(
			<SpacePendingAgentActions
				items={[createPermissionItem({ interactionId: "full-access" })]}
				onPermissionModeUpdate={onPermissionModeUpdate}
				onRespond={onRespond}
				permissionModeOptionsByProfileId={
					new Map([
						[
							"agent-runner",
							[
								{
									label: "Full access",
									permissionMode: "codex:fullAccess",
									description: "Applies to the next task.",
									requiresExplicitConfirmation: true,
								},
							],
						],
					])
				}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "1 action needs you" }));
		fireEvent.click(screen.getByRole("radio", { name: "Allow once" }));
		fireEvent.click(screen.getByRole("radio", { name: "Full access" }));
		const submit = screen.getByRole("button", { name: "Approve and continue" });
		expect((submit as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: "I trust this Agent to use Full access.",
			})
		);
		fireEvent.click(submit);
		expect(
			await screen.findByText("Permission settings could not be saved.")
		).toBeTruthy();
		expect(onRespond).not.toHaveBeenCalled();
		expect((submit as HTMLButtonElement).disabled).toBe(false);
	});

	it.each([
		"older Service",
		"missing edit handler",
	])("does not offer mode updates for %s", (reason) => {
		const item = createPermissionItem({ interactionId: "legacy-service" });
		if (
			reason === "older Service" &&
			item.pendingInteraction?.request?.kind === "permission"
		) {
			item.pendingInteraction.request.supportsPermissionModeUpdate = undefined;
		}
		render(
			<SpacePendingAgentActions
				items={[item]}
				onPermissionModeUpdate={
					reason === "missing edit handler" ? undefined : vi.fn()
				}
				onRespond={vi.fn()}
				permissionModeOptionsByProfileId={createPermissionModeOptions()}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "1 action needs you" }));
		fireEvent.click(screen.getByRole("radio", { name: "Allow once" }));
		expect(screen.queryByRole("radio", { name: "Auto mode" })).toBeNull();
		expect(
			(
				screen.getByRole("button", {
					name: "Approve and continue",
				}) as HTMLButtonElement
			).disabled
		).toBe(false);
	});

	it("moves straight to the next request after the previous request was submitted", async () => {
		const onRespond = vi.fn().mockResolvedValue(undefined);
		const submittedItem = createPermissionItem({
			interactionId: "interaction-submitted",
			title: "Allow the submitted command?",
		});
		const nextItem = createPermissionItem({
			interactionId: "interaction-next",
			title: "Allow the next command?",
		});
		const view = render(
			<SpacePendingAgentActions
				items={[submittedItem, nextItem]}
				onRespond={onRespond}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "2 actions need you" }));
		fireEvent.click(screen.getByRole("radio", { name: "Allow once" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Approve and continue" })
		);

		expect(await screen.findByText("Allow the next command?")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "1 action needs you" })
		).toBeTruthy();
		expect(screen.queryByText("Action 1 of 2")).toBeNull();
		expect(screen.getByRole("radio", { name: "Allow once" })).toBeTruthy();

		// The answered request clears once its Agent resumes; the surface stays
		// on the request that still needs the user.
		view.rerender(
			<SpacePendingAgentActions items={[nextItem]} onRespond={onRespond} />
		);
		expect(screen.getByText("Allow the next command?")).toBeTruthy();
	});

	it("removes every answered request at once and closes when none remain", async () => {
		let resolveFirst: () => void = () => undefined;
		const onRespond = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<void>((resolve) => {
						resolveFirst = resolve;
					})
			)
			.mockResolvedValue(undefined);
		render(
			<SpacePendingAgentActions
				items={[
					createPermissionItem({
						interactionId: "interaction-first-answered",
						targetLabel: "@Runner",
						title: "Allow the first command?",
					}),
					createPermissionItem({
						interactionId: "interaction-second-answered",
						targetLabel: "@Reviewer",
						title: "Allow the second command?",
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

		// The first answer is still in flight, yet it has already left the tray.
		expect(await screen.findByText("Allow the second command?")).toBeTruthy();
		expect(screen.queryByText("Allow the first command?")).toBeNull();
		expect(screen.queryByText("Sending response…")).toBeNull();
		resolveFirst();

		fireEvent.click(screen.getByRole("radio", { name: "Allow once" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Approve and continue" })
		);

		await waitFor(() => {
			expect(
				screen.queryByRole("button", { name: ACTION_NEEDS_YOU_PATTERN })
			).toBeNull();
		});
		expect(screen.queryByText(WAITING_TO_CONTINUE_PATTERN)).toBeNull();
		expect(onRespond).toHaveBeenCalledTimes(2);
	});

	it("stays closed when a new request arrives after every request was answered", async () => {
		const onRespond = vi.fn().mockResolvedValue(undefined);
		const answered = createPermissionItem({
			interactionId: "interaction-answered-last",
			title: "Allow the answered command?",
		});
		const view = render(
			<SpacePendingAgentActions items={[answered]} onRespond={onRespond} />
		);

		fireEvent.click(screen.getByRole("button", { name: "1 action needs you" }));
		fireEvent.click(screen.getByRole("radio", { name: "Allow once" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Approve and continue" })
		);
		await waitFor(() => {
			expect(
				screen.queryByRole("button", { name: ACTION_NEEDS_YOU_PATTERN })
			).toBeNull();
		});

		view.rerender(
			<SpacePendingAgentActions
				items={[
					answered,
					createPermissionItem({
						interactionId: "interaction-arrives-later",
						title: "Allow the later command?",
					}),
				]}
				onRespond={onRespond}
			/>
		);

		const trigger = screen.getByRole("button", { name: "1 action needs you" });
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText("Allow the later command?")).toBeNull();
	});

	it("puts a request back with its error when the answer fails to send", async () => {
		const onRespond = vi
			.fn()
			.mockRejectedValue(new Error("OpenMeld couldn't reach your computer."));
		render(
			<SpacePendingAgentActions
				items={[
					createPermissionItem({
						interactionId: "interaction-send-fails",
						title: "Allow the failing command?",
					}),
				]}
				onRespond={onRespond}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "1 action needs you" }));
		fireEvent.click(screen.getByRole("radio", { name: "Allow once" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Approve and continue" })
		);

		expect((await screen.findByRole("alert")).textContent).toBe(
			"OpenMeld couldn't reach your computer."
		);
		expect(screen.getByText("Allow the failing command?")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "1 action needs you" })
		).toBeTruthy();
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
		expect(screen.getByText("@Runner")).toBeTruthy();
		expect(screen.queryByText("Allow the second command?")).toBeNull();
	});
});

describe("resolveSpacePermissionModeOptions", () => {
	it("uses the controller-native low-interruption mode and skips an already-saved mode", () => {
		expect(
			resolveSpacePermissionModeOptions({
				agentControllerPermissionMode: "claude-code:default",
				agentControllerRef: "builtin:claude-code",
			})
		).toMatchObject([
			{
				label: "Auto mode",
				permissionMode: "claude-code:auto",
			},
		]);
		expect(
			resolveSpacePermissionModeOptions({
				agentControllerPermissionMode: "claude-code:auto",
				agentControllerRef: "builtin:claude-code",
			})
		).toEqual([]);
	});

	it("does not invent a generic permission mode for OpenCode or unknown controllers", () => {
		expect(
			resolveSpacePermissionModeOptions({
				agentControllerPermissionMode: undefined,
				agentControllerRef: "builtin:opencode",
			})
		).toEqual([]);
		expect(
			resolveSpacePermissionModeOptions({
				agentControllerPermissionMode: undefined,
				agentControllerRef: "builtin:future-controller",
			})
		).toEqual([]);
	});
});

describe("pending action thread navigation", () => {
	it("keeps unrelated requests in main and opens the requested thread before showing its card", () => {
		const main = createPermissionItem({ interactionId: "main" });
		const threaded = {
			...createPermissionItem({ interactionId: "threaded" }),
			sourceContext: {
				profileId: "human",
				profileKind: "human" as const,
				profileName: "Reviewer",
				messagePreview: null,
				threadId: "thread-a",
			},
		};
		const items = [main, threaded];
		expect(
			partitionSpacePendingAgentActions(items, "unrelated").thread
		).toEqual([]);
		const onOpen = vi.fn();
		const view = render(
			<SpacePendingAgentActions
				items={[threaded]}
				onOpenRequestThread={onOpen}
				onRespond={vi.fn()}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "1 action needs you" }));
		expect(screen.queryByText("Allow this command?")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
		expect(onOpen).toHaveBeenCalledWith(threaded);
		view.unmount();
		const panels = partitionSpacePendingAgentActions(items, "thread-a");
		expect(panels.conversation).toEqual([main]);
		expect(panels.thread).toEqual([threaded]);
		render(
			<SpacePendingAgentActions
				initialInteractionIdentity={JSON.stringify([
					threaded.runtimeCoordinatorExecutionId,
					"threaded",
				])}
				items={panels.thread}
				onRespond={vi.fn()}
			/>
		);
		expect(screen.getByText("Allow this command?")).toBeTruthy();
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
					supportsPermissionModeUpdate: true,
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

function createPermissionModeOptions() {
	return new Map([
		[
			"agent-runner",
			[
				{
					description:
						"Let Claude Code automatically run actions it considers safe.",
					label: "Auto mode",
					permissionMode: "claude-code:auto" as const,
				},
			],
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
