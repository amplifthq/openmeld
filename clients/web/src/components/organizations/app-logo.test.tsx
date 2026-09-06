import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppLogo } from "#/components/organizations/app-logo";
import {
	GITHUB_PLUGIN,
	LARK_CHANNEL_IDENTITY,
	SLACK_CHANNEL_IDENTITY,
} from "#/components/organizations/plugin-catalog";

describe("AppLogo", () => {
	it("gives Message Channel marks consistent room without changing the outer logo size", () => {
		const { container } = render(
			<>
				<AppLogo app={SLACK_CHANNEL_IDENTITY} size="md" />
				<AppLogo app={LARK_CHANNEL_IDENTITY} size="md" />
				<AppLogo app={GITHUB_PLUGIN} size="md" />
			</>
		);
		const { getByTestId } = within(container);

		const slackFrame = getByTestId("app-logo-slack").parentElement;
		const larkFrame = getByTestId("app-logo-lark").parentElement;
		const githubFrame = getByTestId("app-logo-github").parentElement;

		expect(slackFrame?.classList.contains("size-10")).toBe(true);
		expect(larkFrame?.classList.contains("size-10")).toBe(true);
		expect(githubFrame?.classList.contains("size-10")).toBe(true);
		expect(slackFrame?.classList.contains("p-1")).toBe(true);
		expect(larkFrame?.classList.contains("p-1")).toBe(true);
		expect(githubFrame?.classList.contains("p-2")).toBe(true);
	});

	it("removes the Message Channel logo surface in dark mode", () => {
		const { container } = render(
			<>
				<AppLogo app={SLACK_CHANNEL_IDENTITY} size="md" />
				<AppLogo app={LARK_CHANNEL_IDENTITY} size="md" />
				<AppLogo app={GITHUB_PLUGIN} size="md" />
			</>
		);
		const { getByTestId } = within(container);

		const slackFrame = getByTestId("app-logo-slack").parentElement;
		const larkFrame = getByTestId("app-logo-lark").parentElement;
		const githubFrame = getByTestId("app-logo-github").parentElement;

		for (const channelFrame of [slackFrame, larkFrame]) {
			expect(channelFrame?.classList.contains("dark:bg-transparent")).toBe(
				true
			);
			expect(channelFrame?.classList.contains("dark:border-0")).toBe(true);
			expect(channelFrame?.classList.contains("dark:shadow-none")).toBe(true);
		}
		expect(githubFrame?.classList.contains("dark:bg-transparent")).toBe(false);
		expect(githubFrame?.classList.contains("dark:border-0")).toBe(false);
		expect(githubFrame?.classList.contains("dark:shadow-none")).toBe(false);
	});
});
