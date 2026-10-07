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

	it("uses the same attachment rail before a Center Agent Space exists", () => {
		const view = render(
			<CenterAgentOptimisticConversation
				composerText=""
				onComposerChange={vi.fn()}
				onSend={vi.fn()}
				pendingMessage={{
					clientMessageId: "pending-files",
					createdAtMs: Date.UTC(2026, 8, 26),
					text: "",
					files: [
						new File(["report"], "report.pdf", { type: "application/pdf" }),
						new File(["archive"], "sources.zip", { type: "application/zip" }),
					],
				}}
			/>
		);
		const rail = screen.getByRole("group", { name: "Message attachments" });
		expect(within(rail).getByRole("img", { name: "report.pdf" })).toBeTruthy();
		expect(within(rail).getByRole("img", { name: "sources.zip" })).toBeTruthy();
		expect(rail.closest("[data-slot='space-message-text-surface']")).toBeNull();
		expect(
			view.container.querySelector("[data-slot='space-message-text-surface']")
				?.childElementCount
		).toBe(0);
	});

	it("keeps the intro mounted above the queued message and sending status", () => {
		const intro = <h2>What should we work on?</h2>;
		const view = render(
			<CenterAgentOptimisticConversation
				composerText="Prepare my weekly update."
				empty
				emptyContent={intro}
				onComposerChange={vi.fn()}
				onSend={vi.fn()}
				pendingMessage={null}
			/>
		);
		const originalIntro = screen.getByRole("heading", {
			name: "What should we work on?",
		});
		view.rerender(
			<CenterAgentOptimisticConversation
				composerText=""
				empty
				emptyContent={intro}
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
		expect(
			screen.getByRole("heading", { name: "What should we work on?" })
		).toBe(originalIntro);
		expect(
			originalIntro.compareDocumentPosition(
				screen.getByText("Prepare my weekly update.")
			)
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		const status = within(optimisticReply).getByRole("status");

		expect(screen.queryByText("Sending…")).toBeNull();
		expect(screen.getByRole("button", { name: "Sending…" })).toBeTruthy();
		expect(status.textContent).toContain("Center Agent · Working…");
		expect(
			within(optimisticReply).getByTestId(
				"space-center-agent-profile-avatar-center-agent"
			)
		).toBeTruthy();
		expect(optimisticReply.querySelector("canvas")).toBeTruthy();
	});
});
