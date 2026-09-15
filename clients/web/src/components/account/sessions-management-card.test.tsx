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
import { afterEach, expect, it, vi } from "vitest";
import type { openMeldAuthClient } from "#/lib/auth-client";
import { userQueryKeys } from "#/query/query-keys";
import { SessionsManagementCard } from "./sessions-management-card";

const revokeSession = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const CURRENT_SESSION_PATTERN = /\(Current\)/;
const LOG_OUT_PATTERN = /log out/i;
vi.mock("#/query/auth-query", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/query/auth-query")>()),
	revokeSessionByToken: revokeSession,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));
afterEach(cleanup);

it("identifies the current session by its safe ID and revokes another session with its separate vendor token", async () => {
	const client = new QueryClient({
		defaultOptions: {
			queries: { staleTime: Number.POSITIVE_INFINITY, enabled: false },
			mutations: { retry: false },
		},
	});
	client.setQueryData(
		userQueryKeys.session,
		accountSessionSchema.parse({
			user: {
				id: "account",
				email: "account@example.com",
				name: "Account",
				image: null,
				emailVerified: true,
				createdAt: "2024-01-02T00:00:00.000Z",
			},
			session: { id: "current" },
		})
	);
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
