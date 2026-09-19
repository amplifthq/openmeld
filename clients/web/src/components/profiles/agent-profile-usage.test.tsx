import type {
	GetAgentExecutionReadinessResponse,
	OrganizationAgentRuntimeOverviewResponse,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { AgentConfigurationGrid } from "./agent-configuration-card";
import { AgentProfileUsage } from "./agent-profile-usage";

const state = vi.hoisted(() => ({ read: vi.fn(), organizationId: "org-a" }));
vi.mock("#/lib/organizations/organization-directory", () => ({
	readCurrentOrganizationAgentRuntimeOverview: state.read,
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({
		currentOrganization: { id: state.organizationId },
	}),
}));

// The already-validated reader is the boundary. Fixture fields are typed from
// the public Core contract; this suite is not a replacement for schema tests.
function snapshot(
	organizationId = "org-a",
	profileId = "agent-a",
	usedPercent = 75
) {
	const readiness = {
		agentControllerRef: "builtin:codex",
		usageLimits: [
			{
				key: "weekly",
				label: "Weekly usage",
				status: "available",
				usedPercent,
				observedAt: "2026-09-18T12:00:00.000Z",
				resetsAt: "2026-09-21T12:00:00.000Z",
			},
		],
	} satisfies Pick<
		GetAgentExecutionReadinessResponse,
		"agentControllerRef" | "usageLimits"
	>;
	return {
		organizationId,
		generatedAt: "2026-09-18T12:00:00.000Z",
		agentProfiles: [{ profileId, readiness }],
	} satisfies Pick<
		OrganizationAgentRuntimeOverviewResponse,
		"organizationId" | "generatedAt"
	> & { agentProfiles: { profileId: string; readiness: typeof readiness }[] };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

function renderUsage() {
	const client = new QueryClient({
		defaultOptions: { queries: { retryDelay: 0 } },
	});
	const tree = (profileId: string, agentControllerRef = "builtin:codex") => (
		<QueryClientProvider client={client}>
			<label>
				Unsaved setting
				<input aria-label="Unsaved setting" defaultValue="Original" />
			</label>
			<AgentConfigurationGrid>
				<AgentProfileUsage
					agentControllerRef={agentControllerRef}
					profileId={profileId}
					variant="card"
				/>
			</AgentConfigurationGrid>
			<AgentProfileUsage
				agentControllerRef={agentControllerRef}
				profileId={profileId}
			/>
		</QueryClientProvider>
	);
	const result = render(tree("agent-a"));
	return {
		client,
		rerender: (profileId = "agent-a", controllerRef?: string) =>
			result.rerender(tree(profileId, controllerRef)),
	};
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	state.organizationId = "org-a";
});

describe("Agent usage dashboard", () => {
	it("resolves the card independently, shares the runtime read, and retains neighboring work", async () => {
		const response = deferred<ReturnType<typeof snapshot>>();
		state.read.mockReturnValue(response.promise);
		const { client } = renderUsage();
		const card = screen.getByRole("region", { name: "Usage limits" });
		expect(
			within(card).getByRole("status", { name: "Loading usage limits" })
		).toBeTruthy();
		expect(screen.queryByRole("meter")).toBeNull();
		const field = screen.getByRole("textbox", { name: "Unsaved setting" });
		fireEvent.change(field, { target: { value: "My unsaved draft" } });
		field.focus();
		await act(async () => response.resolve(snapshot()));
		expect(
			(await screen.findByRole("meter")).getAttribute("aria-valuenow")
		).toBe("25");
		expect(state.read).toHaveBeenCalledTimes(1);
		expect(
			within(card).queryByRole("button", { name: "Edit Usage limits" })
		).toBeNull();
		expect((field as HTMLInputElement).value).toBe("My unsaved draft");
		expect(document.activeElement).toBe(field);
		client.clear();
	});

	it("keeps last-known usage during a refresh failure, but removes it on access revocation", async () => {
		state.read.mockResolvedValue(snapshot());
		const { client } = renderUsage();
		await screen.findByRole("meter");
		const key = organizationQueryKeys.agentRuntimeOverview("org-a");
		const next = deferred<ReturnType<typeof snapshot>>();
		state.read.mockReturnValue(next.promise);
		act(() => {
			client.invalidateQueries({ queryKey: key }).catch(console.error);
		});
		expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("25");
		expect(
			within(screen.getByRole("region", { name: "Usage limits" })).queryByRole(
				"status",
				{ name: "Loading usage limits" }
			)
		).toBeNull();
		await act(async () => next.resolve(snapshot()));
		state.read.mockRejectedValue({
			code: "gateway.upstream_error",
			status: 503,
			message: "Unavailable",
		});
		await act(async () => {
			await client.invalidateQueries({ queryKey: key });
		});
		await screen.findByText("Last-known usage. Refresh failed.");
		expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("25");
		state.read.mockRejectedValue({
			code: "organization.membership_required",
			status: 403,
			message: "Access revoked",
		});
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await waitFor(() => expect(screen.queryByRole("meter")).toBeNull());
		client.clear();
	});

	it("never reuses another Agent, Organization, or Controller's quota", async () => {
		state.read.mockResolvedValue(snapshot());
		const { client, rerender } = renderUsage();
		await screen.findByRole("meter");
		rerender("agent-b");
		expect(screen.queryByRole("meter")).toBeNull();
		rerender("agent-a", "builtin:claude-code");
		expect(screen.queryByRole("meter")).toBeNull();
		const next = deferred<ReturnType<typeof snapshot>>();
		state.read.mockReturnValue(next.promise);
		state.organizationId = "org-b";
		rerender();
		expect(screen.queryByRole("meter")).toBeNull();
		await act(async () => next.resolve(snapshot("org-b", "agent-a", 40)));
		expect(
			(await screen.findByRole("meter")).getAttribute("aria-valuenow")
		).toBe("60");
		client.clear();
	});
});
