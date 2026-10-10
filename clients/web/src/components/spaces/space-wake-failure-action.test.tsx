import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceAgentRecoveryActionControl } from "./space-agent-recovery-action";
import { SpaceWakeFailureActionControl } from "./space-wake-failure-action";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));

afterEach(cleanup);

describe("SpaceWakeFailureActionControl", () => {
	it("opens the exact Agent for model recovery instead of the general directory", () => {
		render(
			<SpaceWakeFailureActionControl
				display={{
					actionTarget: "agents",
					body: "Model no longer offered.",
					primaryActionId: "change_model",
					primaryActionLabel: "Change model",
				}}
				orgSlug="amplift"
				targetProfileId="research-agent"
			/>
		);
		expect(
			screen.getByRole("link", { name: "Change model" }).getAttribute("href")
		).toBe("/o/amplift/agents?profileId=research-agent");
	});

	it("does not offer an unscoped model edit when the failed Agent is unknown", () => {
		render(
			<SpaceWakeFailureActionControl
				display={{
					actionTarget: "agents",
					body: "Model unavailable.",
					primaryActionId: "change_model",
					primaryActionLabel: "Change model",
				}}
				orgSlug="amplift"
			/>
		);
		expect(screen.queryByRole("link", { name: "Change model" })).toBeNull();
		expect(
			screen.getByText("Ask this agent's owner to change its model.")
		).toBeTruthy();
	});

	it("opens the affected Agent Profile instead of an unrelated current Computer", () => {
		render(
			<SpaceWakeFailureActionControl
				display={{
					actionTarget: "computer",
					body: "Update the Local Agent.",
					primaryActionId: "manage_local_agent",
					primaryActionLabel: "Update or change local agent",
				}}
				orgSlug="amplift"
				prepareSetupHref="/o/amplift/connect?session=fresh"
				targetProfileId="agent-profile-1"
			/>
		);

		expect(
			screen
				.getByRole("link", { name: "Update or change local agent" })
				.getAttribute("href")
		).toBe("/o/amplift/agents?profileId=agent-profile-1");
	});

	it.each([
		"controller.client.upgrade_required",
		"execution_context.mcp_server_namespace_conflict",
		"claim_eligibility.runtime_missing",
	])("keeps Local Agent recovery scoped to the affected Agent Profile for %s", (recoveryReasonCode) => {
		render(
			<SpaceAgentRecoveryActionControl
				isPending={false}
				onAction={vi.fn()}
				orgSlug="amplift"
				plan={{
					body: "Claude Code needs an update on its bound Computer.",
					kind: "prepare_agent_profile",
					primaryActionId: "manage_local_agent",
					primaryActionLabel: "Update or change local agent",
					profileId: "agent-profile-1",
					profileName: "Claude Code",
					recoveryReasonCode,
					secondaryLabel: "Update required",
					title: "Claude Code needs an update",
				}}
			/>
		);

		expect(
			screen
				.getByRole("link", { name: "Update or change local agent" })
				.getAttribute("href")
		).toBe("/o/amplift/agents?profileId=agent-profile-1");
	});

	it("keeps a Computer status action available when the plan requests it", () => {
		render(
			<SpaceAgentRecoveryActionControl
				allowComputerAction
				isPending={false}
				onAction={vi.fn()}
				orgSlug="amplift"
				plan={{
					body: "Check the bound Computer's current status.",
					kind: "review_computer",
					primaryActionId: "check_status",
					primaryActionLabel: "Check status",
					profileId: "agent-profile-1",
					profileName: "Claude Code",
					recoveryReasonCode: "claim_eligibility.runtime_unavailable",
					secondaryLabel: "Needs attention",
					title: "Computer status is unavailable",
				}}
			/>
		);
		expect(
			screen.getByRole("link", { name: "Check status" }).getAttribute("href")
		).toBe("/o/amplift/computers");
	});
});
