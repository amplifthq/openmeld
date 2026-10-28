import { FluidCardGroup } from "@openmeld/ui/fluid/card";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentDesk } from "./team-desks-page";

const readRuntime = vi.hoisted(() => vi.fn());
vi.mock("#/lib/organizations/organization-directory", () => ({
	readCurrentOrganizationAgentRuntimeOverview: readRuntime,
}));
vi.mock("#/components/app/app-full-width-layout", () => ({
	AppFullWidthLayout: () => null,
}));
vi.mock("./team-header", () => ({ TeamHeader: () => null }));
vi.mock("#/components/agents/agent-profile-controller-avatar", () => ({
	AgentProfileControllerAvatar: () => <span>Avatar</span>,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		search,
		...props
	}: {
		children: ReactNode;
		to: string;
		search?: Record<string, string>;
	}) => (
		<a
			href={`${to}${search ? `?${new URLSearchParams(search)}` : ""}`}
			{...props}
		>
			{children}
		</a>
	),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("Agent desk catch-up", () => {
	it.each([
		"click",
		"hover",
	])("reads work only after opening the desk with %s", async (interaction) => {
		readRuntime.mockResolvedValue({
			organizationId: "org",
			generatedAt: new Date().toISOString(),
			agentProfiles: [
				{
					profileId: "agent",
					workload: {
						status: "ready",
						items: [
							{
								id: "task",
								kind: "active",
								text: "Running integration tests",
								location: { spaceId: "space", spaceName: "Product" },
							},
						],
					},
				},
			],
		});
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<FluidCardGroup>
					<AgentDesk
						agent={{
							profileId: "agent",
							profileName: "Monica Codex",
							agentControllerRef: "codex",
						}}
						organizationId="org"
						organizationSlug="acme"
						owner="Monica"
						state="working"
					/>
				</FluidCardGroup>
			</QueryClientProvider>
		);
		expect(readRuntime).not.toHaveBeenCalled();
		const trigger = screen.getByRole("button", {
			name: "Monica Codex, Monica: Working",
		});
		if (interaction === "hover") {
			fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
			fireEvent.mouseEnter(trigger);
			fireEvent.mouseMove(trigger);
		} else {
			fireEvent.click(trigger);
		}
		await waitFor(() =>
			expect(screen.getByText("Running integration tests")).toBeTruthy()
		);
		expect(readRuntime).toHaveBeenCalledTimes(1);
		expect(readRuntime).toHaveBeenCalledWith(
			expect.objectContaining({
				workloadProfileId: "agent",
				organizationId: "org",
			})
		);
		expect(
			screen.getByRole("link", { name: "Open Agent" }).getAttribute("href")
		).toBe("/o/acme/agents?profileId=agent");
		client.clear();
	});

	it("does not expose cached progress when the overview has become unavailable", async () => {
		readRuntime.mockResolvedValue({
			organizationId: "org",
			generatedAt: new Date().toISOString(),
			agentProfiles: [
				{
					profileId: "agent",
					workload: {
						status: "ready",
						items: [
							{
								id: "task",
								kind: "active",
								text: "Outdated progress",
								location: { spaceId: "space", spaceName: "Product" },
							},
						],
					},
				},
			],
		});
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<FluidCardGroup>
					<AgentDesk
						agent={{
							profileId: "agent",
							profileName: "Monica Codex",
							agentControllerRef: "codex",
						}}
						organizationId="org"
						organizationSlug="acme"
						owner="Monica"
						state="unknown"
					/>
				</FluidCardGroup>
			</QueryClientProvider>
		);
		fireEvent.click(
			screen.getByRole("button", {
				name: "Monica Codex, Monica: Status unavailable",
			})
		);
		await waitFor(() => expect(readRuntime).toHaveBeenCalledOnce());
		expect(screen.queryByText("Outdated progress")).toBeNull();
		expect(screen.getByText("Current activity is unavailable.")).toBeTruthy();
		client.clear();
	});
});
