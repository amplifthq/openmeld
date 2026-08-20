import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	GITHUB_APP,
	LARK_CHANNEL_IDENTITY,
	SLACK_CHANNEL_IDENTITY,
} from "#/components/organizations/app-catalog";
import { AppLogo } from "#/components/organizations/app-logo";

describe("AppLogo", () => {
	it("gives the raw Slack mark more room without changing the outer logo size", () => {
		const { container } = render(
			<>
				<AppLogo app={SLACK_CHANNEL_IDENTITY} size="md" />
				<AppLogo app={GITHUB_APP} size="md" />
			</>
		);
		const { getByTestId } = within(container);

		const slackFrame = getByTestId("app-logo-slack").parentElement;
		const githubFrame = getByTestId("app-logo-github").parentElement;

		expect(slackFrame?.classList.contains("size-10")).toBe(true);
		expect(githubFrame?.classList.contains("size-10")).toBe(true);
		expect(slackFrame?.classList.contains("p-1")).toBe(true);
		expect(githubFrame?.classList.contains("p-2")).toBe(true);
	});

	it("uses a quieter theme-aware surface for Message Channel logos", () => {
		const { container } = render(
			<>
				<AppLogo app={SLACK_CHANNEL_IDENTITY} size="md" />
				<AppLogo app={LARK_CHANNEL_IDENTITY} size="md" />
				<AppLogo app={GITHUB_APP} size="md" />
			</>
		);
		const { getByTestId } = within(container);

		const slackFrame = getByTestId("app-logo-slack").parentElement;
		const larkFrame = getByTestId("app-logo-lark").parentElement;
		const githubFrame = getByTestId("app-logo-github").parentElement;

		for (const channelFrame of [slackFrame, larkFrame]) {
			expect(channelFrame?.classList.contains("dark:bg-muted/50")).toBe(true);
			expect(channelFrame?.classList.contains("dark:border-white/10")).toBe(
				true
			);
		}
		expect(githubFrame?.classList.contains("dark:bg-muted/50")).toBe(false);
	});
});
