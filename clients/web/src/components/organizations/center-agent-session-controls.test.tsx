import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CenterAgentSessionControls } from "./center-agent-session-controls";

const FIRST_CHAT_NAME = /first/;
const SECOND_CHAT_NAME = /second/;

const { createSession, listSessions, navigate } = vi.hoisted(() => ({
	createSession: vi.fn(),
	listSessions: vi.fn(),
	navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@openmeld/api-client", async (importOriginal) => ({
	...(await importOriginal<typeof import("@openmeld/api-client")>()),
	createCenterAgentApi: () => ({ createSession, listSessions }),
}));
vi.mock("#/lib/openmeld-api/client", () => ({
	createOrganizationScopedWebOpenMeldApiFoundation: () => ({}),
}));

function session(spaceId: string) {
	return {
		spaceId,
		name: spaceId,
		createdAt: "2026-09-06T00:00:00.000Z",
		centerAgentProfileId: "agent-1",
		memberProfileId: "human-1",
		organizationId: "org-1",
		kind: "center_agent_direct_message_space" as const,
		isCenterAgentDirectMessageSpace: true as const,
	};
}
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
			<CenterAgentSessionControls
				memberProfileId="human-1"
				organizationId="org-1"
				organizationSlug="acme"
				spaceId="first"
			/>
		</QueryClientProvider>
	);
}
describe("Center Agent session controls", () => {
	beforeEach(() => {
		createSession.mockReset();
		listSessions
			.mockReset()
			.mockResolvedValue({ sessions: [], nextCursor: null });
		navigate.mockReset().mockResolvedValue(undefined);
	});
	afterEach(cleanup);
	it("reuses the creation ID after an uncertain failure and opens the exact returned chat", async () => {
		createSession
			.mockRejectedValueOnce(new Error("Temporary failure"))
			.mockResolvedValueOnce({ spaceId: "created-chat" });
		mount();
		fireEvent.click(screen.getByRole("button", { name: "New chat" }));
		await screen.findByRole("alert");
		fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
		await waitFor(() =>
			expect(
				(screen.getByRole("button", { name: "New chat" }) as HTMLButtonElement)
					.disabled
			).toBe(false)
		);
		fireEvent.click(screen.getByRole("button", { name: "New chat" }));
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				to: "/o/acme?session=created-chat",
			})
		);
		expect(createSession).toHaveBeenCalledTimes(2);
		expect(createSession.mock.calls[1][0].creationId).toBe(
			createSession.mock.calls[0][0].creationId
		);
	});
	it("loads the next page without replacing earlier chats and selects an exact chat", async () => {
		listSessions
			.mockResolvedValueOnce({
				sessions: [session("first")],
				nextCursor: "second-page",
			})
			.mockResolvedValueOnce({
				sessions: [session("second")],
				nextCursor: null,
			});
		mount();
		fireEvent.click(screen.getByRole("button", { name: "Chats" }));
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Load older chats" })
		);
		const second = await screen.findByRole("menuitem", {
			name: SECOND_CHAT_NAME,
		});
		expect(
			screen.getByRole("menuitem", { name: FIRST_CHAT_NAME }).textContent
		).toContain("first");
		expect(listSessions).toHaveBeenLastCalledWith(
			expect.objectContaining({ cursor: "second-page" })
		);
		fireEvent.click(second);
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({ to: "/o/acme?session=second" })
		);
	});
});
