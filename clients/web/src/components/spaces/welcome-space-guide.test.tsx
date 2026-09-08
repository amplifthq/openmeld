import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { WelcomeSpaceGuide } from "./welcome-space-guide";
import { saveWelcomeSpace } from "./welcome-space-state";

beforeEach(() => localStorage.clear());

it("keeps adding agents available after the retired shortcut advanced the tutorial", () => {
	saveWelcomeSpace("account", "space", "send");
	const onAddAgents = vi.fn();
	render(
		<WelcomeSpaceGuide
			hasDraft={false}
			hasRecipients={false}
			onAddAgents={onAddAgents}
			onPrepareConversation={vi.fn()}
			scope="account"
			spaceId="space"
		/>
	);
	fireEvent.click(screen.getByRole("button", { name: "Add your first agent" }));
	expect(onAddAgents).toHaveBeenCalledOnce();
	expect(
		screen.queryByRole("button", { name: "Try a task with Center Agent" })
	).toBeNull();
});

it("restores the conversation action when the user clears a draft without filling it automatically", () => {
	saveWelcomeSpace("account", "space", "send");
	const onPrepareConversation = vi.fn();
	const props = {
		scope: "account",
		spaceId: "space",
		hasRecipients: true,
		onPrepareConversation,
	};
	const { rerender } = render(<WelcomeSpaceGuide {...props} hasDraft />);
	expect(
		screen.queryByRole("button", { name: "Start a conversation" })
	).toBeNull();
	rerender(<WelcomeSpaceGuide {...props} hasDraft={false} />);
	expect(onPrepareConversation).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Start a conversation" }));
	expect(onPrepareConversation).toHaveBeenCalledOnce();
});
