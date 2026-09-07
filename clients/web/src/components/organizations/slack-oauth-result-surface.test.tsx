import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { resolveVisibleChannelsSlackOAuthResult } from "#/lib/organizations/slack-oauth-result";
import { SlackOAuthResultSurface } from "./slack-oauth-result-surface";

describe("SlackOAuthResultSurface", () => {
	it("shows a successful connection result on the Channels page", () => {
		render(
			<SlackOAuthResultSurface
				canManage
				organizationName="Acme"
				organizationSlug="acme"
				result={{ status: "connected" }}
			/>
		);

		expect(screen.getByRole("status")).toBeTruthy();
		expect(screen.getByText("Slack connected")).toBeTruthy();
	});

	it("keeps the informed move confirmation and restarts OAuth", async () => {
		render(
			<SlackOAuthResultSurface
				canManage
				organizationName="New Org"
				organizationSlug="new-org"
				result={{
					fromOrganizationId: "org-existing",
					fromOrganizationName: "Previous Org",
					status: "move_required",
				}}
			/>
		);

		expect(screen.getByText("Move Slack workspace?")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Move workspace" }).getAttribute("href")
		).toBe(
			"/slack/oauth/start?organization_slug=new-org&move_from=org-existing"
		);
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() =>
			expect(screen.queryByText("Move Slack workspace?")).toBeNull()
		);
	});

	it("does not trust a success query until Core reports Slack connected", () => {
		expect(
			resolveVisibleChannelsSlackOAuthResult({
				result: { status: "connected" },
				slackConnected: false,
			})
		).toBeUndefined();
		expect(
			resolveVisibleChannelsSlackOAuthResult({
				result: { error: "access_denied", status: "error" },
				slackConnected: false,
			})
		).toEqual({ error: "access_denied", status: "error" });
	});
});
