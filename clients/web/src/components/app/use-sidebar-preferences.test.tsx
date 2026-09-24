import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSidebarPreferences } from "./use-sidebar-preferences";

const state = vi.hoisted(() => ({
	currentUserId: "account-a",
	requestJson: vi.fn(),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({ currentUserId: state.currentUserId }),
}));

vi.mock("#/lib/openmeld-api/client", () => ({
	createUnscopedWebOpenMeldApiFoundation: () => ({
		requestJson: state.requestJson,
	}),
}));

function SidebarProbe() {
	const sidebar = useSidebarPreferences("organization-a");
	return (
		<p>
			{sidebar.isPending
				? "Waiting for this account"
				: (sidebar.preferences?.people?.groups[0]?.name ?? "No group")}
		</p>
	);
}

afterEach(() => {
	cleanup();
	state.currentUserId = "account-a";
	state.requestJson.mockReset();
});

it("keeps sidebar layout scoped to the signed-in account across switches", async () => {
	state.requestJson
		.mockResolvedValueOnce(sidebarResponse("Account A"))
		.mockResolvedValueOnce(sidebarResponse("Account B"));
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const view = render(
		<QueryClientProvider client={client}>
			<SidebarProbe />
		</QueryClientProvider>
	);
	await screen.findByText("Account A");
	state.currentUserId = "account-b";
	view.rerender(
		<QueryClientProvider client={client}>
			<SidebarProbe />
		</QueryClientProvider>
	);
	await screen.findByText("Account B");
	state.currentUserId = "account-a";
	view.rerender(
		<QueryClientProvider client={client}>
			<SidebarProbe />
		</QueryClientProvider>
	);
	expect(screen.getByText("Account A")).toBeTruthy();
	expect(state.requestJson).toHaveBeenCalledTimes(2);
	client.clear();
});

function sidebarResponse(name: string) {
	return {
		ok: true,
		preferences: {
			pinned: { sort: "priority", spaceIds: [] },
			spaces: { sort: "priority", spaceIds: [] },
			groups: [],
			people: {
				starred: { sort: "priority", itemIds: [] },
				people: { sort: "priority", itemIds: [] },
				groups: [
					{
						id: crypto.randomUUID(),
						name,
						sort: "priority",
						itemIds: [],
					},
				],
			},
		},
		revision: 1,
	};
}
