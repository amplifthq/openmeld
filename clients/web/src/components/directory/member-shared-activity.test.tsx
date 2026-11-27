import type {
	AgentActivityInventorySession,
	AgentActivitySessionInventoryResponse,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
	MemberSharedActivity,
	MemberSharedActivityReadout,
} from "./member-shared-activity";

const api = vi.hoisted(() => ({
	readCurrentAgentActivitySessions: vi.fn(),
	readCurrentAgentActivitySnapshot: vi.fn(),
}));
vi.mock("#/lib/organizations/agent-activity", () => api);
vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({
		currentUserId: "viewer",
		currentOrganization: { id: "org" },
	}),
}));

afterEach(() => {
	cleanup();
	vi.resetAllMocks();
});

const now = 1_795_551_300_000;
const organization = { id: "org", name: "OpenMeld" };
const session: AgentActivityInventorySession = {
	boundAgentProfileId: null,
	bindingState: "unbound",
	canFork: false,
	canResume: false,
	computer: {
		id: "computer",
		lastSeenAtMs: now,
		name: "Grace’s Mac",
		state: "online",
	},
	dataState: "current",
	inventoryUpdatedAtMs: now,
	lastActiveAtMs: now - 1000,
	localAgent: {
		agentControllerRef: "builtin:codex",
		name: "Codex",
		provider: "codex",
	},
	nativeSessionId: "session-1",
	nativeSessionTitle: "Verify onboarding",
	organization,
	origin: "openmeld",
	owner: { userId: "grace", name: "Grace" },
	project: { id: "project-1", name: "Release checklist", slug: "release" },
	startedAtMs: null,
	status: "working",
};
const inventory = {
	asOfMs: now,
	coverage: [],
	nextCursor: null,
	organization,
	sessions: [],
} satisfies AgentActivitySessionInventoryResponse;

it("reads only the authenticated member-scoped Session Inventory, never the legacy snapshot", async () => {
	api.readCurrentAgentActivitySessions.mockResolvedValueOnce({
		...inventory,
		sessions: [session],
	});
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<MemberSharedActivity
				memberUserId="grace"
				nowMs={now}
				organizationId="org"
			/>
		</QueryClientProvider>
	);
	expect(await screen.findByText("Verify onboarding")).toBeTruthy();
	expect(api.readCurrentAgentActivitySessions).toHaveBeenCalledWith(
		expect.objectContaining({
			organizationId: "org",
			memberUserId: "grace",
			limit: 12,
		})
	);
	expect(api.readCurrentAgentActivitySnapshot).not.toHaveBeenCalled();
	expect(screen.queryByRole("region", { name: "Activity" })).toBeNull();
});

it("shows the subject's authorized inventory but no mismatched member or Organization", () => {
	render(
		<MemberSharedActivityReadout
			inventory={{
				...inventory,
				sessions: [
					session,
					{
						...session,
						nativeSessionId: "other-member",
						nativeSessionTitle: "Another member's session",
						owner: { userId: "other", name: "Other" },
					},
					{
						...session,
						nativeSessionId: "other-org",
						nativeSessionTitle: "Another workspace's session",
						organization: { id: "other-org", name: "Other" },
					},
				],
			}}
			memberUserId="grace"
			nowMs={now}
		/>
	);
	expect(
		within(screen.getByRole("region", { name: "Current focus" })).getByText(
			"Release checklist"
		)
	).toBeTruthy();
	expect(
		within(screen.getByRole("region", { name: "Recent sessions" })).getByText(
			"Verify onboarding"
		)
	).toBeTruthy();
	expect(screen.queryByText("Another member's session")).toBeNull();
	expect(screen.queryByText("Another workspace's session")).toBeNull();
});

it("does not present stale, inactive or offline observations as current focus", () => {
	render(
		<MemberSharedActivityReadout
			inventory={{
				...inventory,
				sessions: [
					{ ...session, dataState: "stale" },
					{ ...session, nativeSessionId: "old", lastActiveAtMs: now - 301_000 },
					{ ...session, nativeSessionId: "ended", status: "ended" },
					{
						...session,
						nativeSessionId: "offline",
						computer: { ...session.computer, state: "offline" },
					},
				],
			}}
			memberUserId="grace"
			nowMs={now}
		/>
	);
	expect(screen.queryByRole("region", { name: "Current focus" })).toBeNull();
	expect(screen.getByRole("region", { name: "Recent sessions" })).toBeTruthy();
});
