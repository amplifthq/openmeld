import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	GITHUB_APP,
	SLACK_CHANNEL_IDENTITY,
} from "#/components/organizations/app-catalog";
import { AppLogo } from "#/components/organizations/app-logo";

describe("AppLogo", () => {
	it("gives the raw Slack mark more room without changing the outer logo size", () => {
		render(
			<>
				<AppLogo app={SLACK_CHANNEL_IDENTITY} size="md" />
				<AppLogo app={GITHUB_APP} size="md" />
			</>
		);

		const slackFrame = screen.getByTestId("app-logo-slack").parentElement;
		const githubFrame = screen.getByTestId("app-logo-github").parentElement;

		expect(slackFrame?.classList.contains("size-10")).toBe(true);
		expect(githubFrame?.classList.contains("size-10")).toBe(true);
		expect(slackFrame?.classList.contains("p-1")).toBe(true);
		expect(githubFrame?.classList.contains("p-2")).toBe(true);
	});
});
