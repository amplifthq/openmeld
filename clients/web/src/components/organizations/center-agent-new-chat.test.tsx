import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CenterAgentNewChat } from "./center-agent-new-chat";

const SHOW_AROUND = /Show me around/;
const CONNECT_COMPUTER = /Connect my computer/;

const { createSession, navigate, saveAsync } = vi.hoisted(() => ({
	createSession: vi.fn(),
	navigate: vi.fn(),
	saveAsync: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (original) => ({
	...(await original<typeof import("@tanstack/react-router")>()),
	useNavigate: () => navigate,
	useRouterState: ({
		select,
	}: {
		select: (state: { location: { searchStr: string } }) => unknown;
	}) => select({ location: { searchStr: "?draft=new" } }),
}));
vi.mock("@openmeld/api-client", async (original) => ({
	...(await original<typeof import("@openmeld/api-client")>()),
	createCenterAgentApi: () => ({ createSession }),
}));
vi.mock("#/lib/openmeld-api/client", () => ({
	createOrganizationScopedWebOpenMeldApiFoundation: () => ({}),
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({
		currentOrganization: { id: "org-1", slug: "acme", name: "Acme" },
	}),
	useAppOrganization: () => ({
		currentOrganization: { id: "org-1", slug: "acme" },
	}),
}));
vi.mock("#/components/app/start-flow-state", () => ({
	useStartFlowState: () => ({ storageScope: "account-1" }),
}));
vi.mock("#/lib/profiles/use-default-human-profile", () => ({
	useDefaultHumanProfile: () => ({
		defaultHumanProfile: { openMeldProfileId: "human-1" },
	}),
}));
vi.mock("#/components/app/use-sidebar-preferences", () => ({
	useSidebarPreferences: () => ({
		preferences: {
			pinned: { sort: "manual", spaceIds: [] },
			spaces: { sort: "recent", spaceIds: [] },
			groups: [],
		},
		disabled: false,
		saveAsync,
	}),
}));

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	vi.clearAllMocks();
	createSession.mockResolvedValue({
		organizationId: "org-1",
		centerAgentProfileId: "agent-1",
		memberProfileId: "human-1",
		spaceId: "chat-1",
		created: true,
	});
	saveAsync.mockResolvedValue(undefined);
	navigate.mockResolvedValue(undefined);
});
afterEach(cleanup);
function mount() {
	return render(
		<QueryClientProvider
			client={
				new QueryClient({
					defaultOptions: {
						queries: { retry: false },
						mutations: { retry: false },
					},
				})
			}
		>
			<CenterAgentNewChat />
		</QueryClientProvider>
	);
}
it("opens and edits a local draft without creating a session", () => {
	const view = mount();
	expect(
		screen.getByRole("heading", { name: "What should we work on in Acme?" })
	).toBeTruthy();
	expect(
		screen.getByRole("group", { name: "Suggested starting points" })
	).toBeTruthy();
	fireEvent.change(
		screen.getByRole("textbox", { name: "Message Center Agent" }),
		{ target: { value: "A saved draft" } }
	);
	expect(createSession).not.toHaveBeenCalled();
	view.unmount();
	mount();
	expect(
		(
			screen.getByRole("textbox", {
				name: "Message Center Agent",
			}) as HTMLTextAreaElement
		).value
	).toBe("A saved draft");
	expect(createSession).not.toHaveBeenCalled();
});
it("reuses the creation identity after an uncertain failure and submits only on Send", async () => {
	createSession.mockRejectedValueOnce(new Error("Connection lost"));
	mount();
	fireEvent.change(
		screen.getByRole("textbox", { name: "Message Center Agent" }),
		{ target: { value: "Prepare launch notes" } }
	);
	fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
	fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	await waitFor(() =>
		expect(navigate).toHaveBeenCalledWith({
			to: "/o/acme?session=chat-1",
			replace: true,
		})
	);
	expect(createSession).toHaveBeenCalledTimes(2);
	expect(createSession.mock.calls[1]).toEqual(createSession.mock.calls[0]);
});

it("clears the sent draft even when navigation unmounts the composer", async () => {
	const view = mount();
	navigate.mockImplementationOnce(() => {
		view.unmount();
		return Promise.resolve();
	});
	fireEvent.change(
		screen.getByRole("textbox", { name: "Message Center Agent" }),
		{
			target: { value: "Send this once" },
		}
	);
	fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	await waitFor(() => expect(sessionStorage.length).toBe(0));
	await waitFor(() => expect(navigate).toHaveBeenCalled());
	mount();
	expect(
		(
			screen.getByRole("textbox", {
				name: "Message Center Agent",
			}) as HTMLTextAreaElement
		).value
	).toBe("");
});

it("starts a conversation from the shared starter card", async () => {
	mount();
	fireEvent.click(screen.getByRole("button", { name: SHOW_AROUND }));
	await waitFor(() =>
		expect(navigate).toHaveBeenCalledWith({
			to: "/o/acme?session=chat-1",
			replace: true,
		})
	);
	expect(createSession).toHaveBeenCalledTimes(1);
	expect(saveAsync.mock.calls[0][0].chats.titles["chat-1"]).toContain(
		"I'm new to OpenMeld."
	);
});

it("opens computer setup without creating an empty chat", () => {
	mount();
	fireEvent.click(screen.getByRole("button", { name: CONNECT_COMPUTER }));
	expect(createSession).not.toHaveBeenCalled();
	expect(navigate).toHaveBeenCalledWith({
		to: "/o/acme/connect?profileId=human-1",
	});
});

it("preserves a manually named draft across reopening and first-message naming", async () => {
	const view = mount();
	fireEvent.click(screen.getByRole("button", { name: "Rename chat" }));
	fireEvent.change(screen.getByRole("textbox", { name: "Chat name" }), {
		target: { value: "My launch plan" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(createSession).not.toHaveBeenCalled();
	view.unmount();
	mount();
	expect(screen.getByRole("heading", { name: "My launch plan" })).toBeTruthy();
	fireEvent.change(
		screen.getByRole("textbox", { name: "Message Center Agent" }),
		{ target: { value: "A different automatic title" } }
	);
	fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	await waitFor(() => expect(saveAsync).toHaveBeenCalled());
	expect(saveAsync.mock.calls[0][0].chats.titles["chat-1"]).toBe(
		"My launch plan"
	);
});
