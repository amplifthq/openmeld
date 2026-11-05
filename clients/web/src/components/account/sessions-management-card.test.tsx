import { accountSessionSchema } from "@openmeld/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import type { openMeldAuthClient } from "#/lib/auth-client";
import { userQueryKeys } from "#/query/query-keys";
import { SessionsManagementCard } from "./sessions-management-card";

const revokeSession = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
// Better Auth captures fetch when the client is created.
const fetchSessions = vi.hoisted(() => {
	const fetch = vi.fn<typeof globalThis.fetch>();
	vi.stubGlobal("fetch", fetch);
	return fetch;
});
const CURRENT_SESSION_PATTERN = /\(Current\)/;
const LOG_OUT_PATTERN = /log out/i;
const SESSION_COUNT_PATTERN = /Connected sessions/;
const currentAccount = accountSessionSchema.parse({
	user: {
		id: "account",
		email: "account@example.com",
		name: "Account",
		image: null,
		emailVerified: true,
		createdAt: "2024-01-02T00:00:00.000Z",
	},
	session: { id: "current" },
});
// Vendor-typed list records retain their independent management credentials.
const sessions = ["other", "current"].map((id) => ({
	id,
	userId: "account",
	token: `credential-${id}`,
	createdAt: new Date("2024-01-02T00:00:00.000Z"),
	updatedAt: new Date("2024-01-02T00:00:00.000Z"),
	expiresAt: new Date("2024-01-03T00:00:00.000Z"),
	ipAddress: null,
	userAgent: null,
})) satisfies (typeof openMeldAuthClient.$Infer.Session.session)[];
vi.mock("#/query/auth-query", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/query/auth-query")>()),
	revokeSessionByToken: revokeSession,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));
afterEach(() => {
	cleanup();
	fetchSessions.mockReset();
	revokeSession.mockClear();
});
afterAll(() => vi.unstubAllGlobals());

it("asks for fresh sign-in when session management is forbidden and shows the current session after verification", async () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retryDelay: 0 } },
	});
	client.setQueryData(userQueryKeys.session, currentAccount);
	const originalPath = window.location.href;
	const settingsPath = "/o/test/spaces?appSettings=account";
	window.history.replaceState(null, "", settingsPath);
	// Captured from the production list-sessions endpoint on an older, valid session.
	fetchSessions.mockImplementation(() =>
		Promise.resolve(
			Response.json(
				{ code: "SESSION_NOT_FRESH", message: "Session is not fresh" },
				{ status: 403 }
			)
		)
	);
	const openSettings = () =>
		render(
			<QueryClientProvider client={client}>
				<SessionsManagementCard />
			</QueryClientProvider>
		);
	try {
		const settings = openSettings();
		const signIn = await screen.findByRole("link", { name: "Sign in again" });
		const href = new URL((signIn as HTMLAnchorElement).href);
		expect(href.pathname).toBe("/login");
		expect(href.searchParams.get("intent")).toBe("add-account");
		expect(href.searchParams.get("redirect")).toBe(settingsPath);
		expect(screen.queryByText("Connected sessions (0)")).toBeNull();
		expect(screen.queryByText("No active sessions found.")).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Revoke other sessions" })
		).toBeNull();
		expect(fetchSessions).toHaveBeenCalledTimes(1);

		fetchSessions.mockImplementation(() =>
			Promise.resolve(Response.json(sessions))
		);
		settings.unmount();
		openSettings();
		expect(await screen.findByText(CURRENT_SESSION_PATTERN)).toBeTruthy();
		expect(screen.getByText("Connected sessions (2)")).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Sign in again" })).toBeNull();
	} finally {
		client.clear();
		window.history.replaceState(null, "", originalPath);
	}
});

it("offers regular sign-in when the session list reports an expired session", async () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retryDelay: 0 } },
	});
	client.setQueryData(userQueryKeys.session, currentAccount);
	const originalPath = window.location.href;
	const settingsPath = "/o/test/spaces?appSettings=account";
	window.history.replaceState(null, "", settingsPath);
	fetchSessions.mockImplementation(() =>
		Promise.resolve(
			Response.json(
				{ code: "UNAUTHORIZED", message: "Unauthorized" },
				{ status: 401 }
			)
		)
	);

	try {
		render(
			<QueryClientProvider client={client}>
				<SessionsManagementCard />
			</QueryClientProvider>
		);

		const signIn = await screen.findByRole("link", { name: "Sign in again" });
		const href = new URL((signIn as HTMLAnchorElement).href);
		expect(href.pathname).toBe("/login");
		expect(href.searchParams.get("redirect")).toBe(settingsPath);
		expect(href.searchParams.has("intent")).toBe(false);
		expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
		expect(fetchSessions).toHaveBeenCalledTimes(1);
	} finally {
		client.clear();
		window.history.replaceState(null, "", originalPath);
	}
});

it("identifies the current session by its safe ID and revokes another session with its separate vendor token", async () => {
	const client = new QueryClient({
		defaultOptions: {
			queries: { staleTime: Number.POSITIVE_INFINITY, enabled: false },
			mutations: { retry: false },
		},
	});
	client.setQueryData(userQueryKeys.session, currentAccount);
	client.setQueryData(userQueryKeys.listSessions, sessions);
	render(
		<QueryClientProvider client={client}>
			<SessionsManagementCard />
		</QueryClientProvider>
	);
	expect(screen.getByText(CURRENT_SESSION_PATTERN)).toBeTruthy();
	expect(
		screen.getByRole("link", { name: LOG_OUT_PATTERN }).getAttribute("href")
	).toBe("/logout");
	fireEvent.click(screen.getByRole("button", { name: "Terminate" }));
	await waitFor(() =>
		expect(revokeSession).toHaveBeenCalledWith(
			"credential-other",
			expect.anything()
		)
	);
	client.clear();
});

it("hides cached management controls after a failed refresh and retries to a confirmed empty list", async () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retryDelay: 0 } },
	});
	client.setQueryData(userQueryKeys.session, currentAccount);
	client.setQueryData(userQueryKeys.listSessions, sessions, { updatedAt: 0 });
	fetchSessions.mockImplementation(() =>
		Promise.resolve(
			Response.json(
				{ code: "INTERNAL_SERVER_ERROR", message: "Internal Server Error" },
				{ status: 500 }
			)
		)
	);

	render(
		<QueryClientProvider client={client}>
			<SessionsManagementCard />
		</QueryClientProvider>
	);

	const retry = await screen.findByRole("button", { name: "Try again" });
	expect(screen.queryByText(SESSION_COUNT_PATTERN)).toBeNull();
	expect(screen.queryByText("No active sessions found.")).toBeNull();
	expect(screen.queryByRole("button", { name: "Terminate" })).toBeNull();

	fetchSessions.mockImplementation(() => Promise.resolve(Response.json([])));
	fireEvent.click(retry);

	await waitFor(() =>
		expect(screen.getByText("No active sessions found.")).toBeTruthy()
	);
	expect(screen.getByText(SESSION_COUNT_PATTERN).textContent).toContain("(0)");
	expect(screen.queryByRole("alert")).toBeNull();
	client.clear();
});
