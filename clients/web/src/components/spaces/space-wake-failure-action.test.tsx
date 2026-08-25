import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SpaceWakeFailureActionControl } from "./space-wake-failure-action";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));

describe("SpaceWakeFailureActionControl", () => {
	it("opens Computers instead of restarting setup for a Local Agent update", () => {
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
			/>
		);

		expect(
			screen
				.getByRole("link", { name: "Update or change local agent" })
				.getAttribute("href")
		).toBe("/o/amplift/computers");
	});
});
