import type { AccountSession } from "@openmeld/schemas";
import {
	focusManager,
	onlineManager,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userQueryKeys } from "#/query/query-keys";
import { sessionQueryOptionsClient } from "#/query/query-options";
import { AccountSessionObserver } from "./account-session-observer";

vi.mock("@tanstack/react-start", () => ({
	createIsomorphicFn: () => ({
		client: (client: (...args: unknown[]) => unknown) => ({
			server: () => client,
		}),
	}),
}));

const session: AccountSession = {
	user: {
		id: "account-a",
		email: "member@example.com",
		name: "Member",
		image: null,
		emailVerified: true,
		createdAt: "2026-04-19T00:00:00.000Z",
	},
	session: { id: "session-a" },
};
const fetchSession = vi.fn<typeof fetch>();
const queryClients = new Set<QueryClient>();

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-10-20T00:00:00.000Z"));
	vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
	fetchSession
		.mockReset()
		.mockImplementation(async () => Response.json(session));
	vi.stubGlobal("fetch", fetchSession);
	focusManager.setFocused(true);
	onlineManager.setOnline(true);
});

afterEach(() => {
	cleanup();
	for (const queryClient of queryClients) {
		queryClient.clear();
	}
	queryClients.clear();
	focusManager.setFocused(undefined);
	onlineManager.setOnline(true);
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function renderSessionObserver(queryClient = new QueryClient()) {
	queryClients.add(queryClient);
	const root = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<AccountSessionObserver />
				<Outlet />
			</QueryClientProvider>
		),
	});
	const spaces = createRoute({
		getParentRoute: () => root,
		path: "/spaces",
		component: () => <p>Spaces page</p>,
	});
	const inbox = createRoute({
		getParentRoute: () => root,
		path: "/inbox",
		component: () => <p>Inbox page</p>,
	});
	const router = createRouter({
		routeTree: root.addChildren([spaces, inbox]),
		history: createMemoryHistory({ initialEntries: ["/spaces"] }),
		defaultPendingMinMs: 0,
	});
	await router.load();
	const view = render(<RouterProvider router={router} />);
	return { queryClient, router, view };
}

describe("AccountSessionObserver", () => {
	it.each([
		"navigation",
		"focus",
		"reconnect",
	] as const)("renews the existing session query on %s only when stale", async (trigger) => {
		const { queryClient, router } = await renderSessionObserver();
		await waitFor(() =>
			expect(queryClient.getQueryData(userQueryKeys.session)).toEqual(session)
		);
		expect(fetchSession).toHaveBeenCalledTimes(1);
		expect(String(fetchSession.mock.calls[0]?.[0])).toContain(
			"/v1/account/session"
		);
		const refresh = async () => {
			await act(async () => {
				if (trigger === "navigation") {
					await router.navigate({
						href:
							router.state.location.pathname === "/spaces"
								? "/inbox"
								: "/spaces",
					});
				} else if (trigger === "focus") {
					focusManager.setFocused(false);
					focusManager.setFocused(true);
				} else {
					onlineManager.setOnline(false);
					onlineManager.setOnline(true);
				}
			});
		};

		await refresh();
		expect(fetchSession).toHaveBeenCalledTimes(1);
		vi.setSystemTime(Date.now() + 30_001);
		await refresh();
		await waitFor(() => expect(fetchSession).toHaveBeenCalledTimes(2));
		await waitFor(() =>
			expect(
				queryClient.getQueryState(userQueryKeys.session)?.fetchStatus
			).toBe("idle")
		);
		expect(screen.getByText("Spaces page")).toBeTruthy();
		expect(queryClient.getQueryData(userQueryKeys.session)).toEqual(session);
	});

	it("shares an in-flight account read with mount, navigation, and focus refreshes", async () => {
		let resolveSession!: (response: Response) => void;
		const pending = new Promise<Response>((resolve) => {
			resolveSession = resolve;
		});
		fetchSession.mockReturnValueOnce(pending);
		const queryClient = new QueryClient();
		const entryRead = queryClient.prefetchQuery(sessionQueryOptionsClient());
		const { router } = await renderSessionObserver(queryClient);

		expect(screen.getByText("Spaces page")).toBeTruthy();
		await act(async () => {
			await router.navigate({ href: "/inbox" });
			focusManager.setFocused(false);
			focusManager.setFocused(true);
		});
		expect(screen.getByText("Inbox page")).toBeTruthy();
		expect(fetchSession).toHaveBeenCalledTimes(1);

		await act(async () => {
			resolveSession(Response.json(session));
			await entryRead;
		});
		expect(queryClient.getQueryData(userQueryKeys.session)).toEqual(session);
		expect(fetchSession).toHaveBeenCalledTimes(1);
	});

	it.each([
		"unmount",
		"account change",
	] as const)("aborts the pending HTTP read on %s", async (reason) => {
		let requestSignal: AbortSignal | null | undefined;
		fetchSession.mockImplementationOnce(
			(_resource, init) =>
				new Promise<Response>((_resolve, reject) => {
					requestSignal = init?.signal;
					requestSignal?.addEventListener("abort", () => {
						reject(requestSignal?.reason);
					});
				})
		);
		const { queryClient, view } = await renderSessionObserver();
		await waitFor(() => expect(fetchSession).toHaveBeenCalledTimes(1));
		expect(requestSignal?.aborted).toBe(false);

		await act(async () => {
			if (reason === "unmount") {
				view.unmount();
			} else {
				await queryClient.cancelQueries({ queryKey: userQueryKeys.session });
			}
		});

		expect(requestSignal?.aborted).toBe(true);
		expect(queryClient.getQueryData(userQueryKeys.session)).toBeUndefined();
	});
});
