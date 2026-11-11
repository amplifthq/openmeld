import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChatHeaderMenu } from "./chat-header-menu";

const { personalToggle, sessionToggle } = vi.hoisted(() => ({
	personalToggle: vi.fn(async () => true),
	sessionToggle: vi.fn(async () => true),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("./use-chat-archive", () => ({
	useChatArchive: () => ({
		archived: false,
		disabled: false,
		label: "Archive conversation",
		toggle: personalToggle,
	}),
}));
vi.mock("#/components/member-agents/member-agent-chat-history", () => ({
	useMemberAgentSessionArchive: () => ({
		archived: false,
		disabled: false,
		label: "Archive conversation",
		confirmDescription: "Session archive description.",
		toggle: sessionToggle,
	}),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

async function archiveFromMenu() {
	fireEvent.click(screen.getByRole("button", { name: "Chat menu" }));
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Archive conversation" })
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Archive conversation" })
	);
}

it("archives a personal chat from the existing chat menu", async () => {
	render(
		<ChatHeaderMenu onOpenConversationInformation={vi.fn()} spaceId="s" />
	);
	await archiveFromMenu();
	await waitFor(() => expect(personalToggle).toHaveBeenCalledTimes(1));
	expect(sessionToggle).not.toHaveBeenCalled();
});

it("archives a MemberAgent Session through the same item and confirmation", async () => {
	render(
		<ChatHeaderMenu
			onOpenConversationInformation={vi.fn()}
			sessionAgentProfileId="colleague-agent"
			spaceId="s"
		/>
	);
	fireEvent.click(screen.getByRole("button", { name: "Chat menu" }));
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Archive conversation" })
	);
	expect(await screen.findByText("Session archive description.")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Archive conversation" }));
	await waitFor(() => expect(sessionToggle).toHaveBeenCalledTimes(1));
	expect(personalToggle).not.toHaveBeenCalled();
});
