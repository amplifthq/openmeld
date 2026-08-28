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

	it("keeps Local Agent recovery scoped to the affected Agent Profile", () => {
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
					recoveryReasonCode: "controller.client.upgrade_required",
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
});
