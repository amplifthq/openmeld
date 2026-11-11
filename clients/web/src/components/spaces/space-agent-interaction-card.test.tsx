import type {
	AgentInteractionPendingSummary,
	AgentInteractionRequest,
	AgentInteractionResponse,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceAgentInteractionCard } from "./space-agent-interaction-card";

const SECRET_COMMAND_PATTERN = /git push/i;
const PLAN_CONTENT_PATTERN = /Update the contract/;

describe("SpaceAgentInteractionCard", () => {
	afterEach(() => {
		cleanup();
	});

	it.each([
		[
			"start_new_conversation",
			"Start a new conversation",
			"Continue task",
			"Response sent",
		],
		["leave_task", "Stop this task", "Stop task", "Stop requested"],
	])("submits the explicit folder choice %s without claiming task completion", async (optionId, label, button, acknowledgement) => {
		const onRespond = vi.fn().mockResolvedValue(undefined);
		render(
			<SpaceAgentInteractionCard
				item={createWakeProgressItem({
					canRespond: true,
					request: {
						v: 1,
						interactionId: "folder-choice",
						requestedAtMs: 1000,
						expiresAtMs: 2000,
						kind: "question",
						title: "Choose where to continue",
						questions: [
							{
								questionId: "working_folder_recovery",
								prompt: "Which conversation should this task use?",
								multiple: false,
								allowOther: false,
								options: [
									{
										optionId: "start_new_conversation",
										label: "Start a new conversation",
									},
									{ optionId: "leave_task", label: "Stop this task" },
								],
							},
						],
					},
				})}
				onRespond={onRespond}
			/>
		);
		expect(onRespond).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("radio", { name: label }));
		fireEvent.click(screen.getByRole("button", { name: button }));
		await screen.findByText(acknowledgement);
		expect(onRespond).toHaveBeenCalledOnce();
		expect(onRespond).toHaveBeenCalledWith({
			interactionId: "folder-choice",
			runtimeCoordinatorExecutionId: "rce_interaction",
			response: {
				kind: "question",
				answers: [
					{ questionId: "working_folder_recovery", values: [optionId] },
				],
			},
		});
		expect(screen.queryByText("Task completed")).toBeNull();
	});

	it("shows permission context and submits the selected permission option", async () => {
		const onRespond = vi.fn().mockResolvedValue(undefined);
		render(
			<SpaceAgentInteractionCard
				item={createWakeProgressItem({
					canRespond: true,
					request: {
						description:
							"Codex wants to run a command outside its current sandbox.",
						expiresAtMs: Date.UTC(2026, 6, 29),
						interactionId: "interaction-permission",
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
						requestedAtMs: Date.UTC(2026, 6, 28),
						subject: {
							command: "git push origin feature",
							cwd: "/workspace/project",
							type: "command",
						},
						title: "Allow this command?",
						v: 1,
					},
				})}
				onRespond={onRespond}
			/>
		);

		expect(screen.getByText("git push origin feature")).toBeTruthy();
		expect(screen.getByText("/workspace/project")).toBeTruthy();
		fireEvent.click(screen.getByRole("radio", { name: "Allow once" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Approve and continue" })
		);

		await waitFor(() => {
			expect(onRespond).toHaveBeenCalledWith({
				interactionId: "interaction-permission",
				response: {
					kind: "permission",
					optionId: "allow-once",
				},
				runtimeCoordinatorExecutionId: "rce_interaction",
			});
		});
		expect(
			await screen.findByText("Waiting for @runner to continue.")
		).toBeTruthy();
	});

	it("supports multi-select answers with an Other value", async () => {
		const onRespond = vi.fn().mockResolvedValue(undefined);
		render(
			<SpaceAgentInteractionCard
				item={createWakeProgressItem({
					canRespond: true,
					request: {
						expiresAtMs: Date.UTC(2026, 6, 29),
						interactionId: "interaction-question",
						kind: "question",
						questions: [
							{
								allowOther: true,
								header: "Validation",
								multiple: true,
								options: [
									{
										description: "Run the focused test suite.",
										label: "Tests",
										optionId: "tests",
									},
									{
										label: "Typecheck",
										optionId: "typecheck",
									},
								],
								prompt: "Which checks should I run?",
								questionId: "checks",
							},
						],
						requestedAtMs: Date.UTC(2026, 6, 28),
						title: "Choose validation",
						v: 1,
					},
				})}
				onRespond={onRespond}
			/>
		);

		fireEvent.click(screen.getByRole("checkbox", { name: "Tests" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "Other" }));
		fireEvent.change(screen.getByPlaceholderText("Type your answer"), {
			target: { value: "localhost smoke" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));

		await waitFor(() => {
			expect(onRespond).toHaveBeenCalledWith({
				interactionId: "interaction-question",
				response: {
					answers: [
						{
							questionId: "checks",
							values: ["tests", "localhost smoke"],
						},
					],
					kind: "question",
				},
				runtimeCoordinatorExecutionId: "rce_interaction",
			});
		});
	});

	it("keeps sensitive free-text answers masked while the user types", () => {
		render(
			<SpaceAgentInteractionCard
				item={createWakeProgressItem({
					canRespond: true,
					request: {
						expiresAtMs: Date.UTC(2026, 6, 29),
						interactionId: "interaction-secret-question",
						kind: "question",
						questions: [
							{
								allowOther: true,
								header: "Credential",
								multiple: false,
								options: [],
								prompt: "Enter the temporary access token.",
								questionId: "token",
								secret: true,
							},
						],
						requestedAtMs: Date.UTC(2026, 6, 28),
						title: "Codex needs your input",
						v: 1,
					},
				})}
				onRespond={vi.fn().mockResolvedValue(undefined)}
			/>
		);

		fireEvent.click(screen.getByRole("radio", { name: "Other" }));
		const input = screen.getByLabelText("Your answer") as HTMLInputElement;
		expect(input.type).toBe("password");
		expect(input.autocomplete).toBe("off");
	});

	it("requires feedback before sending a plan change request", async () => {
		const onRespond = vi.fn().mockResolvedValue(undefined);
		render(
			<SpaceAgentInteractionCard
				item={createWakeProgressItem({
					canRespond: true,
					request: {
						allowFeedback: true,
						expiresAtMs: Date.UTC(2026, 6, 29),
						interactionId: "interaction-plan",
						kind: "plan_review",
						plan: "1. Update the contract\n2. Add behavior tests",
						requestedAtMs: Date.UTC(2026, 6, 28),
						title: "Review the implementation plan",
						v: 1,
					},
				})}
				onRespond={onRespond}
			/>
		);

		expect(screen.getByText(PLAN_CONTENT_PATTERN)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
		const sendFeedback = screen.getByRole("button", { name: "Send feedback" });
		expect((sendFeedback as HTMLButtonElement).disabled).toBe(true);
		fireEvent.change(
			screen.getByPlaceholderText(
				"Describe the changes you want the agent to make"
			),
			{
				target: { value: "Add a reconnect test." },
			}
		);
		fireEvent.click(sendFeedback);

		await waitFor(() => {
			expect(onRespond).toHaveBeenCalledWith({
				interactionId: "interaction-plan",
				response: {
					action: "request_changes",
					feedback: "Add a reconnect test.",
					kind: "plan_review",
				},
				runtimeCoordinatorExecutionId: "rce_interaction",
			});
		});
	});

	it("requires a fresh decision when a new plan replaces an answered request", async () => {
		const onRespond = vi.fn().mockResolvedValue(undefined);
		const plan = (interactionId: string, title: string) =>
			createWakeProgressItem({
				canRespond: true,
				request: {
					v: 1,
					kind: "plan_review",
					interactionId,
					title,
					requestedAtMs: Date.now(),
					expiresAtMs: Date.now() + 60_000,
					plan: title,
					allowFeedback: false,
				},
			});
		const { rerender } = render(
			<SpaceAgentInteractionCard
				item={plan("first-plan", "Review the first plan")}
				onRespond={onRespond}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
		await screen.findByText("Response sent");
		rerender(
			<SpaceAgentInteractionCard
				item={plan("revised-plan", "Review the revised plan")}
				onRespond={onRespond}
			/>
		);
		expect(screen.queryByText("Response sent")).toBeNull();
		expect(onRespond).toHaveBeenCalledTimes(1);
		expect(
			(
				screen.getByRole("button", {
					name: "Approve plan",
				}) as HTMLButtonElement
			).disabled
		).toBe(false);
	});

	it("keeps request details private from people who do not own the local agent", () => {
		render(
			<SpaceAgentInteractionCard
				item={createWakeProgressItem({
					canRespond: false,
					kind: "permission",
					request: null,
				})}
			/>
		);

		expect(screen.getByText("Waiting for the local agent owner")).toBeTruthy();
		expect(
			screen.getByText(
				"This Wake is paused until the person who owns this local agent responds. You can keep using this Space while it waits."
			)
		).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.queryByText(SECRET_COMMAND_PATTERN)).toBeNull();
	});

	it.each([
		"network.timeout",
		"network.request_failed",
	])("keeps an unconfirmed %s response neutral and retries the same answer", async (code) => {
		const permissionModeUpdate = {
			bindingId: "binding-1",
			mode: "codex:approveForMe",
		} satisfies NonNullable<
			Extract<
				AgentInteractionResponse,
				{ kind: "permission" }
			>["permissionModeUpdate"]
		>;
		const onPermissionModeUpdate = vi
			.fn()
			.mockResolvedValue(permissionModeUpdate);
		const onRespond = vi
			.fn()
			.mockRejectedValueOnce(
				Object.assign(new Error("transport failed"), { code })
			)
			.mockResolvedValue(undefined);
		const card = (
			<SpaceAgentInteractionCard
				item={createWakeProgressItem({
					canRespond: true,
					request: {
						v: 1,
						interactionId: "unconfirmed",
						kind: "permission",
						requestedAtMs: 1000,
						expiresAtMs: 2000,
						title: "Use this tool?",
						supportsPermissionModeUpdate: true,
						subject: { type: "tool" },
						options: [
							{
								intent: "allow_once",
								label: "Allow once",
								optionId: "allow-once",
							},
						],
					},
				})}
				onPermissionModeUpdate={onPermissionModeUpdate}
				onRespond={onRespond}
				permissionModeOptions={[
					{
						permissionMode: "codex:approveForMe",
						label: "Approve for me",
						description: "Use the Agent's approval review.",
					},
				]}
			/>
		);
		const { rerender } = render(card);
		expect(
			screen
				.getByRole("radio", { name: "Keep current permissions" })
				.getAttribute("aria-checked")
		).toBe("true");
		fireEvent.click(screen.getByRole("radio", { name: "Approve for me" }));
		expect(onPermissionModeUpdate).not.toHaveBeenCalled();
		expect(onRespond).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("radio", { name: "Allow once" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Approve and continue" })
		);
		await screen.findByText("Response not confirmed");
		expect(screen.queryByRole("alert")).toBeNull();
		expect(screen.queryByText("Response sent")).toBeNull();
		rerender(
			<SpaceAgentInteractionCard
				item={createWakeProgressItem({
					canRespond: false,
					interactionId: "unconfirmed",
					request: null,
				})}
				onRespond={onRespond}
			/>
		);
		expect(screen.getByText("Waiting for the local agent owner")).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
		rerender(card);
		fireEvent.click(screen.getByRole("button", { name: "Check response" }));
		await screen.findByText("Response sent");
		expect(onRespond).toHaveBeenCalledTimes(2);
		expect(onRespond.mock.calls[1]).toEqual(onRespond.mock.calls[0]);
		expect(onRespond.mock.calls[0]?.[0].response.permissionModeUpdate).toEqual(
			permissionModeUpdate
		);
		expect(onPermissionModeUpdate).toHaveBeenCalledOnce();
	});

	it("keeps the request actionable when sending the response fails", async () => {
		const onRespond = vi
			.fn()
			.mockRejectedValue(
				new Error("The local agent is reconnecting. Try again.")
			);
		render(
			<SpaceAgentInteractionCard
				item={createWakeProgressItem({
					canRespond: true,
					request: {
						expiresAtMs: Date.UTC(2026, 6, 29),
						interactionId: "interaction-retry",
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
				})}
				onRespond={onRespond}
			/>
		);

		fireEvent.click(screen.getByRole("radio", { name: "Allow once" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Approve and continue" })
		);

		expect(
			await screen.findByText("The local agent is reconnecting. Try again.")
		).toBeTruthy();
		expect(
			(
				screen.getByRole("button", {
					name: "Approve and continue",
				}) as HTMLButtonElement
			).disabled
		).toBe(false);
	});
});

function createWakeProgressItem(input: {
	canRespond: boolean;
	interactionId?: string;
	kind?: AgentInteractionPendingSummary["kind"];
	request: AgentInteractionRequest | null;
}): WakeProgressItem {
	const interactionId =
		input.interactionId ??
		input.request?.interactionId ??
		"interaction-private";
	return {
		clientMessageId: "client-message-1",
		dispatchId: "dispatch-1",
		failureReasonCode: null,
		message: "@runner is waiting for your response.",
		pendingInteraction: {
			canRespond: input.canRespond,
			expiresAtMs: input.request?.expiresAtMs ?? Date.UTC(2026, 6, 29),
			interactionId,
			kind: input.request?.kind ?? input.kind ?? "question",
			request: input.request,
			requestedAtMs: input.request?.requestedAtMs ?? Date.UTC(2026, 6, 28),
		},
		phase: "running",
		runtimeCoordinatorExecutionId: "rce_interaction",
		sourceSignalId: "sig-source",
		targetLabel: "@runner",
		targetProfileId: "agent-runner",
		terminal: false,
		updatedAtMs: Date.UTC(2026, 6, 28),
	};
}
