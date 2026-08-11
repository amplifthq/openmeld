import type { OrganizationDirectoryResponse } from "@openmeld/schemas/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CenterAgentAboutPopover } from "./center-agent-about-control";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));

afterEach(cleanup);

describe("CenterAgentAboutPopover", () => {
	it("shows the Center Agent identity, model, connection, and management link to admins", () => {
		render(
			<CenterAgentAboutPopover
				canManage
				modelDisplayName="DeepSeek V4 Flash"
				organizationSlug="acme"
				profile={buildCenterAgentProfile()}
			/>
		);

		const aboutButton = screen.getByRole("button", { name: "About" });
		expect(
			aboutButton.querySelector('[data-icon="inline-start"]')
		).toBeTruthy();
		fireEvent.click(aboutButton);

		expect(screen.getByText("Operations Center Agent")).toBeTruthy();
		expect(screen.getByText("@operations-center-agent")).toBeTruthy();
		expect(screen.getByText("DeepSeek V4 Flash")).toBeTruthy();
		expect(screen.queryByText("claude-sonnet-4-5 · high")).toBeNull();
		expect(screen.getByText("Available")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Manage →" }).getAttribute("href")
		).toBe("/o/acme/center-agent/settings");
	});

	it("keeps the management link hidden from members", () => {
		render(
			<CenterAgentAboutPopover
				canManage={false}
				modelDisplayName="Grok 4.5"
				organizationSlug="acme"
				profile={buildCenterAgentProfile()}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "About" }));

		expect(screen.queryByRole("link", { name: "Manage →" })).toBeNull();
	});
});

function buildCenterAgentProfile(): OrganizationDirectoryResponse["agentProfiles"][number] {
	return {
		avatarUrl: undefined,
		createdAt: "2026-07-13T00:00:00.000Z",
		createdByUserId: "user-1",
		creatorProfileId: null,
		isCenterAgent: true,
		isDefault: false,
		lastUsedAt: null,
		managedRole: "center_agent",
		organizationId: "org-acme",
		ownerName: "Felix",
		ownerUserId: "user-1",
		profileHandle: "operations-center-agent",
		profileId: "agt_11111111-1111-4111-8111-111111111111",
		profileKind: "agent",
		profileName: "Operations Center Agent",
		readiness: {
			agentWakeAvailability: { badgeLabel: "Available" },
			primaryBinding: {
				modelSelection: {
					modelId: "claude-sonnet-4-5",
					reasoningLevel: "high",
				},
			},
		} as OrganizationDirectoryResponse["agentProfiles"][number]["readiness"],
		source: "managed",
		status: "active",
		updatedAt: "2026-07-13T00:00:00.000Z",
	};
}
