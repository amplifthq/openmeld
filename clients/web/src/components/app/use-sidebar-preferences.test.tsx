import type { AccountSidebarPreferences } from "@openmeld/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
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

function MoveProbe({ id }: { id: string }) {
	const sidebar = useSidebarPreferences("organization-a");
	return (
		<>
			<button
				onClick={() =>
					sidebar.update((current) => ({
						...current,
						pinned: {
							sort: "manual",
							spaceIds: [
								id,
								...current.pinned.spaceIds.filter((value) => value !== id),
							],
						},
					}))
				}
				type="button"
			>
				Move {id}
			</button>
			<output aria-label={`Order ${id}`}>
				{sidebar.preferences?.pinned.spaceIds.join(",")}
			</output>
		</>
	);
}

it("shows moves from both surfaces immediately and saves each against the last accepted revision", async () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	let acceptFirst:
		| ((response: {
				ok: boolean;
				revision: number;
				preferences: AccountSidebarPreferences;
		  }) => void)
		| undefined;
	const writes: { revision: number; preferences: AccountSidebarPreferences }[] =
		[];
	state.requestJson.mockImplementation(
		(request: { method?: string; body?: string }) => {
			if (request.method !== "PUT") {
				return Promise.resolve(sidebarResponse("Account A"));
			}
			const body = JSON.parse(request.body ?? "");
			writes.push(body);
			return writes.length === 1
				? new Promise((resolve) => {
						acceptFirst = resolve;
					})
				: Promise.resolve({
						ok: true,
						revision: body.revision + 1,
						preferences: body.preferences,
					});
		}
	);
	render(
		<QueryClientProvider client={client}>
			<MoveProbe id="alpha" />
			<MoveProbe id="beta" />
		</QueryClientProvider>
	);
	await waitFor(() => expect(state.requestJson).toHaveBeenCalledOnce());
	fireEvent.click(screen.getByRole("button", { name: "Move alpha" }));
	await waitFor(() => expect(writes).toHaveLength(1));
	fireEvent.click(screen.getByRole("button", { name: "Move beta" }));
	await waitFor(() =>
		expect(screen.getByLabelText("Order alpha").textContent).toBe("beta,alpha")
	);
	expect(screen.getByLabelText("Order beta").textContent).toBe("beta,alpha");
	expect(writes).toHaveLength(1);
	await act(async () => {
		acceptFirst?.({
			ok: true,
			revision: 2,
			preferences: writes[0].preferences,
		});
		await Promise.resolve();
	});
	await waitFor(() => expect(writes).toHaveLength(2));
	expect(writes[1].revision).toBe(2);
	expect(writes[1].preferences.pinned.spaceIds).toEqual(["beta", "alpha"]);
	await waitFor(() =>
		expect(screen.getByLabelText("Order beta").textContent).toBe("beta,alpha")
	);
	client.clear();
});

afterEach(() => {
	cleanup();
	state.currentUserId = "account-a";
	state.requestJson.mockReset();
});

it("refreshes after a rejected save and keeps the next queued move without overwriting another device", async () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const initial = sidebarResponse("Account A");
	let rejectFirst: ((error: Error) => void) | undefined;
	let reads = 0;
	const writes: { revision: number; preferences: AccountSidebarPreferences }[] =
		[];
	state.requestJson.mockImplementation(
		(request: { method?: string; body?: string }) => {
			if (request.method !== "PUT") {
				reads += 1;
				return Promise.resolve(
					reads === 1
						? initial
						: {
								...initial,
								revision: 7,
								preferences: {
									...initial.preferences,
									pinned: { sort: "manual", spaceIds: ["another-device"] },
								},
							}
				);
			}
			const body = JSON.parse(request.body ?? "");
			writes.push(body);
			return writes.length === 1
				? new Promise((_resolve, reject) => {
						rejectFirst = reject;
					})
				: Promise.resolve({
						ok: true,
						revision: 8,
						preferences: body.preferences,
					});
		}
	);
	const consoleError = vi
		.spyOn(console, "error")
		.mockImplementation(() => undefined);
	render(
		<QueryClientProvider client={client}>
			<MoveProbe id="alpha" />
			<MoveProbe id="beta" />
		</QueryClientProvider>
	);
	await waitFor(() => expect(reads).toBe(1));
	fireEvent.click(screen.getByRole("button", { name: "Move alpha" }));
	await waitFor(() => expect(writes).toHaveLength(1));
	fireEvent.click(screen.getByRole("button", { name: "Move beta" }));
	await waitFor(() =>
		expect(screen.getByLabelText("Order beta").textContent).toBe("beta,alpha")
	);
	await act(async () => {
		rejectFirst?.(new Error("Revision changed"));
		await Promise.resolve();
	});
	await waitFor(() => expect(writes).toHaveLength(2));
	expect(writes[1].revision).toBe(7);
	expect(writes[1].preferences.pinned.spaceIds).toEqual([
		"beta",
		"another-device",
	]);
	await waitFor(() =>
		expect(screen.getByLabelText("Order alpha").textContent).toBe(
			"beta,another-device"
		)
	);
	consoleError.mockRestore();
	client.clear();
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
