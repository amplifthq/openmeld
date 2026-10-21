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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
	usedPercent = 85,
	status: "available" | "exhausted" = "available"
) {
	const readiness = {
		agentControllerRef: "builtin:codex",
		usageLimits: [
			{
				key: "weekly",
				label: "Weekly usage",
				status,
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
			<div data-testid="summary">
				<AgentProfileUsage
					agentControllerRef={agentControllerRef}
					profileId={profileId}
				/>
			</div>
			<div data-testid="popover">
				<AgentProfileUsage
					agentControllerRef={agentControllerRef}
					profileId={profileId}
					variant="popover"
				/>
			</div>
		</QueryClientProvider>
	);
	const result = render(tree("agent-a"));
	return {
		client,
		rerender: (profileId = "agent-a", controllerRef?: string) =>
			result.rerender(tree(profileId, controllerRef)),
	};
}

beforeEach(() => {
	// Only the clock moves: the fixture's observation stays fresh.
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-18T12:05:00.000Z"));
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.useRealTimers();
	state.organizationId = "org-a";
});

const PERCENT_TEXT = /\d+(\.\d+)?%/;
const USAGE_LIMIT_TEXT = /usage limit/i;

function showsUsagePercent() {
	return Boolean(
		screen.queryByRole("meter") ||
			screen.queryByRole("progressbar") ||
			PERCENT_TEXT.test(document.body.textContent ?? "")
	);
}

describe("Agent usage dashboard", () => {
	it("shows nothing about usage while the Agent has room, and retains neighboring work", async () => {
		const response = deferred<ReturnType<typeof snapshot>>();
		state.read.mockReturnValue(response.promise);
		const { client } = renderUsage();
		expect(screen.queryByRole("region", { name: "Usage limits" })).toBeNull();
		const field = screen.getByRole("textbox", { name: "Unsaved setting" });
		fireEvent.change(field, { target: { value: "My unsaved draft" } });
		field.focus();
		await act(async () => response.resolve(snapshot("org-a", "agent-a", 75)));
		await waitFor(() => expect(state.read).toHaveBeenCalledTimes(1));
		expect(screen.queryByRole("region", { name: "Usage limits" })).toBeNull();
		expect(screen.getByTestId("summary").textContent).toBe("");
		expect(screen.getByTestId("popover").textContent).toBe("");
		expect(showsUsagePercent()).toBe(false);
		expect((field as HTMLInputElement).value).toBe("My unsaved draft");
		expect(document.activeElement).toBe(field);
		client.clear();
	});

	it("warns near the limit in every team-facing place, without a percent", async () => {
		state.read.mockResolvedValue(snapshot());
		const { client } = renderUsage();
		const card = await screen.findByRole("region", { name: "Usage limits" });
		expect(within(card).getByText("Near usage limit")).toBeTruthy();
		expect(screen.getByTestId("summary").textContent).toBe("Near usage limit");
		expect(screen.getByTestId("popover").textContent).toBe("Near usage limit");
		expect(state.read).toHaveBeenCalledTimes(1);
		expect(showsUsagePercent()).toBe(false);
		client.clear();
	});

	it("reports a reached limit with its reset distance", async () => {
		state.read.mockResolvedValue(
			snapshot("org-a", "agent-a", 100, "exhausted")
		);
		const { client } = renderUsage();
		const card = await screen.findByRole("region", { name: "Usage limits" });
		expect(
			within(card).getByText("Usage limit reached · resets in 3 days")
		).toBeTruthy();
		expect(screen.getByTestId("summary").textContent).toBe(
			"Usage limit reached · resets in 3 days"
		);
		expect(showsUsagePercent()).toBe(false);
		client.clear();
	});

	it("keeps a last-known warning during a refresh failure, but removes it on access revocation", async () => {
		state.read.mockResolvedValue(snapshot());
		const { client } = renderUsage();
		await screen.findByRole("region", { name: "Usage limits" });
		const key = organizationQueryKeys.agentRuntimeOverview("org-a");
		state.read.mockRejectedValue({
			code: "gateway.upstream_error",
			status: 503,
			message: "Unavailable",
		});
		await act(async () => {
			await client.invalidateQueries({ queryKey: key });
		});
		await screen.findByText("Last-known usage. Refresh failed.");
		expect(screen.getAllByText("Near usage limit").length).toBeGreaterThan(0);
		state.read.mockRejectedValue({
			code: "organization.membership_required",
			status: 403,
			message: "Access revoked",
		});
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await waitFor(() =>
			expect(screen.queryByText("Near usage limit")).toBeNull()
		);
		client.clear();
	});

	it("never reuses another Agent, Organization, or Controller's quota", async () => {
		state.read.mockResolvedValue(snapshot());
		const { client, rerender } = renderUsage();
		await screen.findByRole("region", { name: "Usage limits" });
		rerender("agent-b");
		expect(screen.queryByText("Near usage limit")).toBeNull();
		rerender("agent-a", "builtin:claude-code");
		expect(screen.queryByText("Near usage limit")).toBeNull();
		const next = deferred<ReturnType<typeof snapshot>>();
		state.read.mockReturnValue(next.promise);
		state.organizationId = "org-b";
		rerender();
		expect(screen.queryByText(USAGE_LIMIT_TEXT)).toBeNull();
		await act(async () =>
			next.resolve(snapshot("org-b", "agent-a", 100, "exhausted"))
		);
		expect(
			await screen.findAllByText("Usage limit reached · resets in 3 days")
		).toHaveLength(3);
		client.clear();
	});
});
