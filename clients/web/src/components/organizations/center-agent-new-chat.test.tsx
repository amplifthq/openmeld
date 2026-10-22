import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readCenterAgentPendingMessage } from "#/lib/organizations/center-agent-pending-message";
import type { ComposerFileDraft } from "#/lib/spaces/composer-file-drafts";
import { CenterAgentNewChat } from "./center-agent-new-chat";

const SHOW_AROUND = /Show me around/;
const CONNECT_COMPUTER = /Connect my computer/;

// jsdom File is not preserved by Node structuredClone; use the storage boundary
// here. The IndexedDB adapter has its own tests and browser smoke covers bytes.
const fileDrafts = vi.hoisted(() => new Map<string, ComposerFileDraft>());
const draftStoreFailure = vi.hoisted(() => ({ read: null as Error | null }));
vi.mock("#/lib/spaces/composer-file-drafts", () => ({
	isComposerFileDraftRetired: () => false,
	readComposerFileDraftCleanup: () => [],
	retryComposerFileDraftCleanup: async () => undefined,
	subscribeComposerFileDrafts: () => () => undefined,
	saveComposerFileDraft: (draft: ComposerFileDraft) => {
		fileDrafts.set(draft.id, draft);
		return Promise.resolve();
	},
	readComposerFileDrafts: (scope: string) => {
		if (draftStoreFailure.read) {
			return Promise.reject(draftStoreFailure.read);
		}
		return Promise.resolve(
			[...fileDrafts.values()].filter((draft) => draft.scope === scope)
		);
	},
	readComposerFileDraftsByIds: (ids: string[]) => {
		if (draftStoreFailure.read) {
			return Promise.reject(draftStoreFailure.read);
		}
		return Promise.resolve(
			[...fileDrafts.values()].filter((draft) => ids.includes(draft.id))
		);
	},
	removeComposerFileDraft: (id: string) => {
		fileDrafts.delete(id);
		return Promise.resolve();
	},
	saveComposerFileDraftUpload: async () => undefined,
}));

const { createSession, createBoardTask, navigate, save } = vi.hoisted(() => ({
	createSession: vi.fn(),
	createBoardTask: vi.fn(async () => ({})),
	navigate: vi.fn(),
	save: vi.fn(),
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
vi.mock("#/lib/spaces/api", () => ({
	createOrganizationScopedWebSpaceApi: () => ({ createTask: createBoardTask }),
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
		defaultHumanProfile: {
			openMeldProfileId: "human-1",
			profileName: "Jordan Rivera",
		},
	}),
}));
vi.mock("#/components/app/use-sidebar-preferences", () => ({
	useSidebarPreferences: () => ({
		preferences: undefined,
		disabled: true,
		updateAsync: (update: (value: unknown) => unknown) =>
			save(
				update({
					pinned: { sort: "manual", spaceIds: [] },
					spaces: { sort: "recent", spaceIds: [] },
					groups: [],
				})
			),
	}),
}));

beforeEach(() => {
	fileDrafts.clear();
	draftStoreFailure.read = null;
	vi.stubGlobal(
		"URL",
		Object.assign(URL, {
			createObjectURL: vi.fn(() => "blob:test"),
			revokeObjectURL: vi.fn(),
		})
	);
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
	save.mockResolvedValue(undefined);
	navigate.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("keeps a title-only task draft local, then includes it in the first-message handoff", async () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<CenterAgentNewChat />
		</QueryClientProvider>
	);
	expect(createSession).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Add" }));
	fireEvent.click(screen.getByRole("menuitem", { name: "Create task" }));
	expect(screen.getByRole("button", { name: "Create task" })).toHaveProperty(
		"disabled",
		true
	);
	fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
		target: { value: "Review private work" },
	});
	expect(createSession).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Create task" }));
	await waitFor(() => expect(navigate).toHaveBeenCalled());
	expect(createSession).toHaveBeenCalledOnce();
	expect(
		readCenterAgentPendingMessage(client, {
			organizationId: "org-1",
			organizationSlug: "acme",
			sessionId: "chat-1",
		})
	).toMatchObject({
		text: "Review private work",
		taskDraft: { title: "Review private work" },
	});
});
it("creates a task from the new-chat board without a composer or message handoff", async () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<CenterAgentNewChat view="tasks" />
		</QueryClientProvider>
	);
	expect(
		screen.queryByRole("textbox", { name: "Message Center Agent" })
	).toBeNull();
	expect(screen.queryByRole("log")).toBeNull();
	expect(createSession).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "New task" }));
	fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
		target: { value: "Board task" },
	});
	expect(createSession).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Create task" }));
	await waitFor(() => expect(createBoardTask).toHaveBeenCalledOnce());
	await waitFor(() =>
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({ to: expect.stringContaining("view=tasks") })
		)
	);
	expect(screen.queryByRole("log")).toBeNull();
	expect(
		readCenterAgentPendingMessage(client, {
			organizationId: "org-1",
			organizationSlug: "acme",
			sessionId: "chat-1",
		})
	).toBeFalsy();
});
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
			to: "/o/acme/chats/center-agent?session=chat-1",
			replace: true,
		})
	);
	expect(createSession).toHaveBeenCalledTimes(2);
	expect(createSession.mock.calls[1]).toEqual(createSession.mock.calls[0]);
});

it("returns a failed local attachment handoff to an editable new chat", async () => {
	mount();
	fireEvent.change(
		screen.getByRole("textbox", { name: "Message Center Agent" }),
		{ target: { value: "Keep this draft" } }
	);
	const file = new File(["image"], "screen.png", { type: "image/png" });
	fireEvent.paste(
		screen.getByRole("textbox", { name: "Message Center Agent" }),
		{ clipboardData: { items: [{ kind: "file", getAsFile: () => file }] } }
	);
	await screen.findByRole("button", { name: "Remove screen.png" });
	draftStoreFailure.read = new Error("Database connection is closing");
	fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	await waitFor(() =>
		expect(screen.getByRole("alert").textContent).toContain(
			"Couldn't restore your attachment drafts. Retry to continue."
		)
	);
	expect(createSession).not.toHaveBeenCalled();
	expect(
		(
			screen.getByRole("textbox", {
				name: "Message Center Agent",
			}) as HTMLTextAreaElement
		).value
	).toBe("Keep this draft");
	expect(
		screen.getByRole("button", { name: "Send message" })
	).not.toHaveProperty("disabled", true);
	draftStoreFailure.read = null;
	fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	await waitFor(() => expect(createSession).toHaveBeenCalledOnce());
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
			to: "/o/acme/chats/center-agent?session=chat-1",
			replace: true,
		})
	);
	expect(createSession).toHaveBeenCalledTimes(1);
	expect(save).not.toHaveBeenCalled();
});

it("does not clear a newer draft when an earlier navigation finishes", async () => {
	const view = mount();
	let finishNavigation: () => void = () => undefined;
	navigate.mockImplementationOnce(() => {
		view.unmount();
		return new Promise<void>((resolve) => {
			finishNavigation = resolve;
		});
	});
	fireEvent.change(
		screen.getByRole("textbox", { name: "Message Center Agent" }),
		{
			target: { value: "First message" },
		}
	);
	fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	await waitFor(() => expect(navigate).toHaveBeenCalled());
	mount();
	fireEvent.change(
		screen.getByRole("textbox", { name: "Message Center Agent" }),
		{
			target: { value: "Keep my next draft" },
		}
	);
	finishNavigation();
	await waitFor(() => expect(sessionStorage.length).toBe(0));
	cleanup();
	mount();
	expect(
		(
			screen.getByRole("textbox", {
				name: "Message Center Agent",
			}) as HTMLTextAreaElement
		).value
	).toBe("Keep my next draft");
});

it("opens computer setup without creating an empty chat", () => {
	mount();
	fireEvent.click(screen.getByRole("button", { name: CONNECT_COMPUTER }));
	expect(createSession).not.toHaveBeenCalled();
	expect(navigate).toHaveBeenCalledWith({
		to: "/o/acme/connect?profileId=human-1",
	});
});

it.each([
	"pending",
	"failed",
])("sends with unavailable sidebar preferences and %s naming", async (naming) => {
	let finishCreation!: (value: unknown) => void;
	createSession.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finishCreation = resolve;
			})
	);
	if (naming === "failed") {
		save.mockRejectedValue(new Error("Sidebar unavailable"));
	} else {
		save.mockReturnValue(
			new Promise(() => {
				/* Sidebar persistence stays pending. */
			})
		);
	}
	mount();
	fireEvent.click(screen.getByRole("button", { name: "Rename chat" }));
	fireEvent.change(screen.getByRole("textbox", { name: "Chat name" }), {
		target: { value: "My chat" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	fireEvent.change(
		screen.getByRole("textbox", { name: "Message Center Agent" }),
		{ target: { value: "Slow connection draft" } }
	);
	fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	await screen.findByText("Slow connection draft");
	expect(navigate).not.toHaveBeenCalled();
	finishCreation({
		organizationId: "org-1",
		centerAgentProfileId: "agent-1",
		memberProfileId: "human-1",
		spaceId: "chat-slow",
		created: true,
	});
	await waitFor(() => expect(navigate).toHaveBeenCalled());
	expect(createSession).toHaveBeenCalledTimes(1);
	expect(save).toHaveBeenCalledTimes(1);
	expect(screen.queryByRole("alert")).toBeNull();
});

it("stops a new chat before creation returns and preserves the draft for a new attempt", async () => {
	let finishCreation: ((value: unknown) => void) | undefined;
	createSession.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finishCreation = resolve;
			})
	);
	mount();
	fireEvent.change(
		screen.getByRole("textbox", { name: "Message Center Agent" }),
		{
			target: { value: "Keep this draft" },
		}
	);
	fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	await waitFor(() => expect(createSession).toHaveBeenCalledOnce());
	fireEvent.click(screen.getByRole("button", { name: "Stop Center Agent" }));
	expect(screen.getByText("Stopped", { exact: true })).toBeTruthy();
	expect(
		(
			screen.getByRole("textbox", {
				name: "Message Center Agent",
			}) as HTMLTextAreaElement
		).value
	).toBe("Keep this draft");
	finishCreation?.({ spaceId: "cancelled-chat" });
	await Promise.resolve();
	expect(navigate).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
	expect(createSession).toHaveBeenCalledTimes(2);
	expect(navigate.mock.calls[0]?.[0].to).not.toContain("cancelled-chat");
});

it("does not navigate back after the user leaves during creation", async () => {
	let finishCreation!: (value: unknown) => void;
	createSession.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finishCreation = resolve;
			})
	);
	const view = mount();
	fireEvent.change(
		screen.getByRole("textbox", { name: "Message Center Agent" }),
		{ target: { value: "Keep this draft" } }
	);
	fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	await waitFor(() => expect(createSession).toHaveBeenCalled());
	view.unmount();
	finishCreation({ spaceId: "late-chat" });
	await Promise.resolve();
	expect(navigate).not.toHaveBeenCalled();
	mount();
	expect(
		(
			screen.getByRole("textbox", {
				name: "Message Center Agent",
			}) as HTMLTextAreaElement
		).value
	).toBe("Keep this draft");
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
	await waitFor(() => expect(save).toHaveBeenCalled());
	expect(save.mock.calls[0][0].chats.titles["chat-1"]).toBe("My launch plan");
});

it("restores pasted attachments after leaving and uses the shared preview and removal tray", async () => {
	const view = mount();
	const file = new File(["image"], "screen.png", { type: "image/png" });
	fireEvent.paste(
		screen.getByRole("textbox", { name: "Message Center Agent" }),
		{ clipboardData: { items: [{ kind: "file", getAsFile: () => file }] } }
	);
	await screen.findByRole("button", { name: "Remove screen.png" });
	await waitFor(() =>
		expect(
			screen.getByRole("img", { name: "screen.png" }).getAttribute("src")
		).toBe("blob:test")
	);
	view.unmount();
	mount();
	const remove = await screen.findByRole("button", {
		name: "Remove screen.png",
	});
	expect(createSession).not.toHaveBeenCalled();
	fireEvent.click(remove);
	await waitFor(() =>
		expect(
			screen.queryByRole("button", { name: "Remove screen.png" })
		).toBeNull()
	);
});
