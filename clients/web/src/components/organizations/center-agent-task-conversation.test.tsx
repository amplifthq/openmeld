import type { CenterAgentTaskDetail } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
	CenterAgentTaskConversation,
	useCenterAgentTaskConversation,
} from "./center-agent-task-conversation";

const TASK_DETAIL: CenterAgentTaskDetail = {
	attempts: [],
	events: [],
	task: {
		activeAttemptGeneration: null,
		createdAt: "2026-08-08T01:00:00.000Z",
		finishedAt: "2026-08-08T01:01:00.000Z",
		goal: "Keep a follow-up draft.",
		id: "task-1",
		organizationId: "organization-1",
		origin: { kind: "open_meld" },
		outcome: "completed",
		phase: null,
		requesterUserId: "account-1",
		state: "finished",
		status: "succeeded",
		title: "Draft persistence",
		updatedAt: "2026-08-08T01:01:00.000Z",
		version: 1,
	},
};

describe("useCenterAgentTaskConversation", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("restores an unsent Task draft after the conversation remounts", () => {
		const queryClient = new QueryClient();
		const wrapper = ({ children }: PropsWithChildren) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);
		const firstComposer = renderHook(
			() =>
				useCenterAgentTaskConversation({
					detail: TASK_DETAIL,
					organizationId: "organization-1",
					taskId: "task-1",
				}),
			{ wrapper }
		);

		act(() => {
			firstComposer.result.current.setComposerText(
				"Keep this Task follow-up after refresh"
			);
		});
		firstComposer.unmount();

		const restoredComposer = renderHook(
			() =>
				useCenterAgentTaskConversation({
					detail: TASK_DETAIL,
					organizationId: "organization-1",
					taskId: "task-1",
				}),
			{ wrapper }
		);

		expect(restoredComposer.result.current.composerText).toBe(
			"Keep this Task follow-up after refresh"
		);
	});

	it("uses the shared self-message surface for requester messages", () => {
		render(
			<CenterAgentTaskConversation
				detail={{
					...TASK_DETAIL,
					events: [
						{
							actor: "requester",
							attemptGeneration: 1,
							id: "event-requester-message",
							kind: "requester_message",
							occurredAt: "2026-08-08T01:00:30.000Z",
							taskId: "task-1",
							text: "Keep this message easy to read.",
						},
					],
				}}
			/>
		);

		const message = screen
			.getByText("Keep this message easy to read.")
			.closest('[data-slot="message"]');
		const bubble = screen
			.getByText("Keep this message easy to read.")
			.closest('[data-slot="bubble-content"]');

		expect(message?.getAttribute("data-space-self-message")).toBe("true");
		expect(bubble?.className).toContain("bg-muted/35");
		expect(bubble?.className).toContain("rounded-md");
		expect(bubble?.className).toContain("text-start");
		expect(bubble?.className).not.toContain("text-right");
	});
});
