import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CenterAgentSlackChannelsShortcut } from "./center-agent-slack-channels-shortcut";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));

afterEach(cleanup);

describe("CenterAgentSlackChannelsShortcut", () => {
	it("sends disconnected Slack management to Center Agent Channels", () => {
		render(<CenterAgentSlackChannelsShortcut organizationSlug="acme" />);

		const trigger = screen.getByRole("button", { name: "Connect Slack" });
		expect(trigger.querySelector('[data-icon="inline-start"]')).toBeTruthy();
		expect(screen.getByText("Connect Slack").className).toContain(
			"@min-[28rem]/app-main-header:inline"
		);
		fireEvent.click(trigger);

		expect(screen.getByRole("heading", { name: "Connect Slack" })).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Open Channels" }).getAttribute("href")
		).toBe("/o/acme/center-agent/channels");
		expect(screen.queryByRole("link", { name: "Add to Slack" })).toBeNull();
	});

	it("keeps a connected Slack shortcut and sends management to Channels", () => {
		render(
			<CenterAgentSlackChannelsShortcut
				organizationSlug="acme"
				slackConnection={{
					connected: true,
					slackTeamId: "T123",
					workspaceName: "Acme HQ",
				}}
			/>
		);

		const trigger = screen.getByRole("button", { name: "Slack connected" });
		expect(trigger.querySelector('[data-icon="inline-start"]')).toBeTruthy();
		fireEvent.click(trigger);

		expect(
			screen.getByRole("heading", { name: "Slack connected" })
		).toBeTruthy();
		expect(screen.getByText("Connected to Acme HQ")).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Manage in Channels" })
				.getAttribute("href")
		).toBe("/o/acme/center-agent/channels");
		expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
	});
});
