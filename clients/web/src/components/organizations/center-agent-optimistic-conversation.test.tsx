import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CenterAgentOptimisticConversation } from "./center-agent-optimistic-conversation";

describe("CenterAgentOptimisticConversation", () => {
	afterEach(cleanup);

	it("keeps its shell full width and constrains only messages and the composer", () => {
		render(
			<CenterAgentOptimisticConversation
				composerText=""
				onComposerChange={vi.fn()}
				onSend={vi.fn()}
				pendingMessage={null}
				presentation="compact"
			/>
		);

		const conversation = screen.getByTestId(
			"center-agent-conversation-skeleton"
		);
		const conversationLog = screen.getByRole("log", {
			name: "Center Agent conversation",
		});
		const contentRails = conversation.querySelectorAll(
			"[data-space-conversation-content-width]"
		);

		expect(conversation.dataset.spaceConversationPresentation).toBe("compact");
		expect(
			conversation.hasAttribute("data-space-conversation-content-width")
		).toBe(false);
		expect(
			conversationLog.hasAttribute("data-space-conversation-content-width")
		).toBe(false);
		expect(contentRails).toHaveLength(2);
		expect(
			conversationLog.querySelector("[data-space-conversation-content-width]")
		).toBeTruthy();
		expect(
			screen
				.getByRole("textbox", { name: "Message Center Agent" })
				.closest("[data-space-conversation-content-width]")
		).toBeTruthy();
	});

	it("shows the Center Agent thinking while a route-level message is queued", () => {
		render(
			<CenterAgentOptimisticConversation
				composerText=""
				onComposerChange={vi.fn()}
				onSend={vi.fn()}
				pendingMessage={{
					clientMessageId: "client-message-1",
					createdAtMs: Date.UTC(2026, 6, 16, 10),
					text: "Prepare my weekly update.",
				}}
			/>
		);

		const optimisticReply = screen.getByTestId("center-agent-optimistic-reply");
		const status = within(optimisticReply).getByRole("status", {
			name: "Sending to Agent…",
		});

		expect(screen.queryByText("Sending…")).toBeNull();
		expect(screen.getByRole("button", { name: "Sending…" })).toBeTruthy();
		expect(within(optimisticReply).getByText("Center Agent")).toBeTruthy();
		expect(status.textContent).toBe("Sending to Agent…");
		expect(
			status.querySelector('[data-space-agent-orb-state="connecting"]')
		).toBeTruthy();
	});
});
