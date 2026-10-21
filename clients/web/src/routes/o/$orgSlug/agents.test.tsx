import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "./agents";

const state = vi.hoisted(() => ({
	read: vi.fn(),
	navigate: vi.fn(),
	peoplePage: vi.fn(),
	resolveMemberAgent: vi.fn(),
	search: {} as { profileId?: string; memberAgentId?: string },
}));
vi.mock("#/query/organizations/member-agents", () => ({
	memberAgentProfilesQueryOptions: (input: {
		enabled: boolean;
		memberAgentId: string;
	}) => ({
		enabled: input.enabled,
		queryFn: () => state.resolveMemberAgent(input.memberAgentId),
		queryKey: ["member-agent-profiles", input.memberAgentId],
		retry: false,
	}),
}));
vi.mock("#/lib/organizations/organization-directory", () => ({
	readCurrentOrganizationProfileDirectory: state.read,
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: { id: "org-a", slug: "acme" },
		currentUserId: "owner-a",
	}),
}));
vi.mock("#/components/profiles/people-and-agents-page", () => ({
	PeopleAndAgentsPage: (props: object) => {
		state.peoplePage(props);
		return null;
	},
}));
vi.mock("#/components/app/app-full-width-layout", () => ({
	AppFullWidthLayout: ({
		children,
		mainSidebar,
	}: {
		children: ReactNode;
		mainSidebar?: { content: ReactNode };
	}) => (
		<>
			{mainSidebar?.content}
			<main>{children}</main>
		</>
	),
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: object) => ({
		options,
		useLoaderData: () => ({ sidebarStates: {} }),
		useSearch: () => state.search,
	}),
	Navigate: (props: object) => {
		state.navigate(props);
		return null;
	},
	useNavigate: () => state.navigate,
	redirect: vi.fn(),
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	state.search = { profileId: "agent-a" };
});
state.search = { profileId: "agent-a" };

function renderRoute() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const Component = Route.options.component as () => ReactNode;
	render(
		<QueryClientProvider client={client}>
			<Component />
		</QueryClientProvider>
	);
	return client;
}

describe("legacy Agent entry", () => {
	it("keeps Team navigation during a cold lookup and resolves the real owner's canonical path", async () => {
		let resolve!: (value: unknown) => void;
		const promise = new Promise<unknown>((complete) => {
			resolve = complete;
		});
		const response = { promise, resolve };
		state.read.mockReturnValue(response.promise);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const Component = Route.options.component as () => ReactNode;
		render(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>
		);
		expect(screen.getByRole("link", { name: "Back to Team" })).toBeTruthy();
		expect(screen.queryByRole("navigation", { name: "People" })).toBeNull();
		expect(
			screen.getByRole("status", { name: "Loading Agent details" })
		).toBeTruthy();
		expect(state.navigate).not.toHaveBeenCalled();
		await act(async () =>
			response.resolve({
				organizationId: "org-a",
				members: [
					{ userId: "owner-a", memberId: "membership-a", humanProfile: null },
				],
				agentProfiles: [{ profileId: "agent-a", ownerUserId: "owner-a" }],
			})
		);
		await vi.waitFor(() =>
			expect(state.navigate).toHaveBeenCalledWith({
				replace: true,
				search: { from: "agents" },
				to: "/o/acme/people/member%3Amembership-a/agents/agent-a",
			})
		);
		client.clear();
	});

	it("keeps a retry and a safe exit when the directory fails", async () => {
		state.read.mockRejectedValue({ message: "Unavailable", status: 503 });
		const client = new QueryClient({
			defaultOptions: { queries: { retryDelay: 0 } },
		});
		const Component = Route.options.component as () => ReactNode;
		render(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>
		);
		await screen.findByRole("alert");
		state.read.mockResolvedValue({
			organizationId: "org-a",
			members: [],
			agentProfiles: [],
		});
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await screen.findByText("Agent not found in this workspace.");
		expect(screen.getByRole("link", { name: "Back to Team" })).toBeTruthy();
		expect(state.navigate).not.toHaveBeenCalled();
		client.clear();
	});
});

describe("MemberAgent link", () => {
	const resolved = (ownerUserId: string) => ({
		ok: true,
		organizationId: "org-a",
		memberAgentId: "ma-1",
		ownerUserId,
		harnessKind: "codex",
		defaultProfileId: "agent-b",
		profileIds: ["agent-c", "agent-b"],
	});

	it("opens a teammate's Agent at its default Profile", async () => {
		state.search = { memberAgentId: "ma-1" };
		state.resolveMemberAgent.mockResolvedValue(resolved("teammate-b"));

		const client = renderRoute();

		await vi.waitFor(() =>
			expect(state.navigate).toHaveBeenCalledWith({
				replace: true,
				search: { profileId: "agent-b" },
				to: "/o/acme/agents",
			})
		);
		expect(state.resolveMemberAgent).toHaveBeenCalledWith("ma-1");
		expect(state.peoplePage).not.toHaveBeenCalled();
		client.clear();
	});

	it("keeps the member's own Agent on the Agents page", async () => {
		state.search = { memberAgentId: "ma-1" };
		state.resolveMemberAgent.mockResolvedValue(resolved("owner-a"));

		const client = renderRoute();

		await vi.waitFor(() =>
			expect(state.peoplePage).toHaveBeenCalledWith(
				expect.objectContaining({ focusMemberAgentId: "ma-1" })
			)
		);
		expect(state.navigate).not.toHaveBeenCalled();
		client.clear();
	});

	it("shows the Agents page for a link that resolves to nothing", async () => {
		state.search = { memberAgentId: "ma-other-org" };
		state.resolveMemberAgent.mockRejectedValue({ status: 404 });

		const client = renderRoute();

		await vi.waitFor(() =>
			expect(state.peoplePage).toHaveBeenCalledWith(
				expect.objectContaining({ focusMemberAgentId: "ma-other-org" })
			)
		);
		expect(state.navigate).not.toHaveBeenCalled();
		client.clear();
	});
});
