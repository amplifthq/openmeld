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
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceAgentInteractionCard } from "./space-agent-interaction-card";

const SECRET_COMMAND_PATTERN = /git push/i;
const PLAN_CONTENT_PATTERN = /1\. Update the contract/;

describe("SpaceAgentInteractionCard", () => {
	afterEach(() => {
		cleanup();
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
			await screen.findByText("@runner is resuming this Wake.")
		).toBeTruthy();
	});

	it("lets the owner edit future Agent permissions without resolving the current request", () => {
		const onEditAgentProfile = vi.fn();
		const onRespond = vi.fn().mockResolvedValue(undefined);
		render(
			<SpaceAgentInteractionCard
				item={createWakeProgressItem({
					canRespond: true,
					request: {
						expiresAtMs: Date.UTC(2026, 6, 29),
						interactionId: "interaction-permission-settings",
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
				onEditAgentProfile={onEditAgentProfile}
				onRespond={onRespond}
			/>
		);

		expect(
			screen.getByText(
				"This changes future work only. Respond to this request separately to continue the current Wake."
			)
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Edit Agent permissions" })
		);

		expect(onEditAgentProfile).toHaveBeenCalledWith("agent-runner");
		expect(onRespond).not.toHaveBeenCalled();
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
	kind?: AgentInteractionPendingSummary["kind"];
	request: AgentInteractionRequest | null;
}): WakeProgressItem {
	const interactionId = input.request?.interactionId ?? "interaction-private";
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
