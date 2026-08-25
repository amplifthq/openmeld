import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	type InboxVisibleConversation,
	InboxVisibleConversationProvider,
	useInboxVisibleConversation,
	usePublishInboxVisibleConversation,
} from "./inbox-visible-conversation";

describe("InboxVisibleConversationProvider", () => {
	afterEach(cleanup);

	it("projects the exact rendered Space thread and clears non-message views", () => {
		const view = renderConversation({
			kind: "space",
			spaceId: "space-123",
			threadRootSignalId: "root-signal-123",
		});

		expect(screen.getByTestId("visible-conversation").textContent).toBe(
			"space-123:root-signal-123"
		);

		view.rerender(
			<InboxVisibleConversationProvider>
				<Reporter conversation={null} />
				<Observer />
			</InboxVisibleConversationProvider>
		);

		expect(screen.getByTestId("visible-conversation").textContent).toBe("none");
	});
});

function renderConversation(conversation: InboxVisibleConversation | null) {
	return render(
		<InboxVisibleConversationProvider>
			<Reporter conversation={conversation} />
			<Observer />
		</InboxVisibleConversationProvider>
	);
}

function Reporter(input: { conversation: InboxVisibleConversation | null }) {
	usePublishInboxVisibleConversation(input.conversation);
	return null;
}

function Observer() {
	const conversation = useInboxVisibleConversation();
	return (
		<span data-testid="visible-conversation">
			{conversation
				? `${conversation.spaceId}:${conversation.threadRootSignalId ?? "main"}`
				: "none"}
		</span>
	);
}
