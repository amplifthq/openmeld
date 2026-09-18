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

const state = vi.hoisted(() => ({ read: vi.fn(), navigate: vi.fn() }));
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
	PeopleAndAgentsPage: () => null,
}));
vi.mock("#/components/directory/team-people-sidebar", () => ({
	TeamPeopleSidebar: () => (
		<nav aria-label="People">
			<a href="/o/acme/people">Team directory</a>
		</nav>
	),
}));
vi.mock("#/components/app/app-full-width-layout", () => ({
	AppFullWidthLayout: ({
		children,
		mainSidebarContent,
	}: {
		children: ReactNode;
		mainSidebarContent: ReactNode;
	}) => (
		<>
			{mainSidebarContent}
			<main>{children}</main>
		</>
	),
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: object) => ({
		options,
		useLoaderData: () => ({ sidebarStates: {} }),
		useSearch: () => ({ profileId: "agent-a" }),
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
});

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
		expect(screen.getByRole("navigation", { name: "People" })).toBeTruthy();
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
