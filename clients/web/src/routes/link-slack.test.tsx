import { isRedirect } from "@tanstack/react-router";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { LinkSlackCard, Route } from "./link-slack";

const consumeSlackIdentityLinkMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const previewSlackIdentityLinkMock = vi.hoisted(() => vi.fn());
const useAuthSessionMock = vi.hoisted(() => vi.fn());

vi.mock("#/hooks/auth.hooks", () => ({
	useAuthSession: useAuthSessionMock,
}));

vi.mock("#/lib/auth-session", () => ({
	getSession: getSessionMock,
}));

vi.mock("#/lib/organizations/center-agent", async () => {
	const actual = await vi.importActual<
		typeof import("#/lib/organizations/center-agent")
	>("#/lib/organizations/center-agent");
	return {
		...actual,
		consumeSlackIdentityLink: consumeSlackIdentityLinkMock,
		previewSlackIdentityLink: previewSlackIdentityLinkMock,
	};
});

describe("link-slack route", () => {
	beforeEach(() => {
		getSessionMock.mockReset().mockResolvedValue(null);
	});

	it.each([
		{
			href: "/link-slack?token=slacklink_original_token",
			search: { token: "slacklink_original_token" },
		},
		{
			href: "/link-slack",
			search: {},
		},
	])("redirects an unauthenticated request for $href to login with a string return URL", async ({
		href,
		search,
	}) => {
		const parsedSearch = Object.assign(Object.create(null), search);
		let thrown: unknown;
		try {
			await Route.options.beforeLoad?.({
				location: {
					href,
					pathname: "/link-slack",
					search: parsedSearch,
				},
			} as never);
		} catch (error) {
			thrown = error;
		}

		expect(String((thrown as Error | undefined)?.message ?? "")).not.toContain(
			"Cannot convert object to primitive value"
		);
		expect(isRedirect(thrown)).toBe(true);
		const options = (
			thrown as {
				options: { search: { redirect: unknown }; to: string };
			}
		).options;
		expect(options.to).toBe("/login");
		expect(typeof options.search.redirect).toBe("string");
		expect(options.search.redirect).toBe(href);
	});
});

describe("LinkSlackCard", () => {
	beforeEach(() => {
		previewSlackIdentityLinkMock.mockReset().mockResolvedValue({
			alreadyMember: false,
			continuesRequest: true,
			expiresAt: "2026-07-09T12:15:00.000Z",
			organizationId: "org_1",
			organizationName: "OpenMeld Labs",
			slackAccountEmail: null,
			slackDisplayName: "ari",
			slackTeamId: "T123",
			slackUserId: "U123",
			slackWorkspaceLabel: "Acme HQ",
			openMeldAccountEmail: "ari@example.test",
			replacesExistingLink: false,
		});
		consumeSlackIdentityLinkMock.mockReset().mockResolvedValue({
			continuationRetryable: false,
			continued: true,
			joinedOrganization: true,
			linked: true,
			openMeldProfileId: "human-1",
			organizationId: "org_1",
			organizationName: "OpenMeld Labs",
			organizationSlug: "acme",
			slackDisplayName: "ari",
			slackTeamId: "T123",
			slackThreadPermalink:
				"https://acme.slack.com/archives/C123/p1710000000000100",
			slackUserId: "U123",
			replacedExistingLink: false,
			openMeldUserId: "user_member",
		});
		useAuthSessionMock.mockReturnValue({
			data: { user: { email: "ari@example.test" } },
		});
	});

	afterEach(cleanup);

	it("joins the organization, links Slack, and continues the original request", async () => {
		render(
			<TestQueryClientProvider>
				<LinkSlackCard token="slacklink_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" />
			</TestQueryClientProvider>
		);

		expect(await screen.findByText("@ari")).toBeTruthy();
		expect(screen.getByText("Workspace Acme HQ")).toBeTruthy();
		expect(screen.getByText("ari@example.test")).toBeTruthy();
		expect(screen.getByText("OpenMeld Labs")).toBeTruthy();
		expect(
			screen.getByText(
				"Join OpenMeld Labs as ari@example.test, connect Slack account @ari, and continue your request."
			)
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Join and continue" }));

		await waitFor(() => {
			expect(consumeSlackIdentityLinkMock).toHaveBeenCalledWith({
				includeReturnTarget: true,
				token:
					"slacklink_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			});
		});
		expect(await screen.findByText("You're ready.")).toBeTruthy();
		expect(
			screen.getByText(
				"I'm continuing your original request in the same Slack thread now."
			)
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Open Slack thread" })
				.getAttribute("href")
		).toBe("https://acme.slack.com/archives/C123/p1710000000000100");
		expect(
			screen
				.getByRole("link", { name: "View my OpenMeld profile" })
				.getAttribute("href")
		).toBe("/o/acme/people?profileId=human-1");
	});

	it("shows the verified Slack email returned by the direct authorization flow", async () => {
		previewSlackIdentityLinkMock.mockResolvedValueOnce({
			alreadyMember: true,
			continuesRequest: false,
			expiresAt: "2026-07-09T12:15:00.000Z",
			organizationId: "org_1",
			organizationName: "OpenMeld Labs",
			slackAccountEmail: "felix@amplift.ai",
			slackDisplayName: "felix@amplift.ai",
			slackTeamId: "T123",
			slackUserId: "U123",
			slackWorkspaceLabel: "Acme HQ",
			openMeldAccountEmail: "felix@openmeld.ai",
			replacesExistingLink: false,
		});

		render(
			<TestQueryClientProvider>
				<LinkSlackCard token={`slacklink_${"f".repeat(64)}`} />
			</TestQueryClientProvider>
		);

		expect(await screen.findByText("felix@amplift.ai")).toBeTruthy();
		expect(
			screen.getByText(
				"Connect Slack account felix@amplift.ai to felix@openmeld.ai."
			)
		).toBeTruthy();
	});

	it("connects an existing member without saying they need to join again", async () => {
		previewSlackIdentityLinkMock.mockResolvedValueOnce({
			alreadyMember: true,
			continuesRequest: true,
			expiresAt: "2026-07-09T12:15:00.000Z",
			organizationId: "org_1",
			organizationName: "OpenMeld Labs",
			slackDisplayName: "ari",
			slackTeamId: "T123",
			slackUserId: "U123",
			slackWorkspaceLabel: "Acme HQ",
			openMeldAccountEmail: "ari@example.test",
			replacesExistingLink: false,
		});

		render(
			<TestQueryClientProvider>
				<LinkSlackCard token="slacklink_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" />
			</TestQueryClientProvider>
		);

		expect(await screen.findByText("Connect your Slack account")).toBeTruthy();
		expect(
			screen.getByText(
				"Connect Slack account @ari to ari@example.test and continue your request."
			)
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Connect my account and continue" })
		).toBeTruthy();
	});

	it("gives one honest recovery step for an older setup link", async () => {
		consumeSlackIdentityLinkMock.mockResolvedValueOnce({
			continuationRetryable: false,
			continued: false,
			joinedOrganization: true,
			linked: true,
			organizationId: "org_1",
			organizationName: "OpenMeld Labs",
			slackDisplayName: "ari",
			slackTeamId: "T123",
			slackUserId: "U123",
			replacedExistingLink: false,
			openMeldUserId: "user_member",
		});

		render(
			<TestQueryClientProvider>
				<LinkSlackCard token="slacklink_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" />
			</TestQueryClientProvider>
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Join and continue" })
		);
		expect(
			await screen.findByText(
				"Your Slack account is connected. This older setup link cannot continue the request. Return to the original Slack thread and ask for a new setup button—you do not need to repeat your request."
			)
		).toBeTruthy();
	});

	it("keeps a clear retry action when continuation could not start", async () => {
		consumeSlackIdentityLinkMock
			.mockResolvedValueOnce({
				continuationRetryable: true,
				continued: false,
				joinedOrganization: true,
				linked: true,
				organizationId: "org_1",
				organizationName: "OpenMeld Labs",
				slackDisplayName: "ari",
				slackTeamId: "T123",
				slackUserId: "U123",
				replacedExistingLink: false,
				openMeldUserId: "user_member",
			})
			.mockResolvedValueOnce({
				continuationRetryable: false,
				continued: true,
				joinedOrganization: false,
				linked: true,
				organizationId: "org_1",
				organizationName: "OpenMeld Labs",
				slackDisplayName: "ari",
				slackTeamId: "T123",
				slackUserId: "U123",
				replacedExistingLink: false,
				openMeldUserId: "user_member",
			});

		render(
			<TestQueryClientProvider>
				<LinkSlackCard token="slacklink_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" />
			</TestQueryClientProvider>
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Join and continue" })
		);
		expect(
			await screen.findByText(
				"Your Slack account is connected, but I couldn't continue the request yet. Try continuing again."
			)
		).toBeTruthy();

		fireEvent.click(
			screen.getByRole("button", { name: "Try continuing again" })
		);
		expect(
			await screen.findByText(
				"I'm continuing your original request in the same Slack thread now."
			)
		).toBeTruthy();
		expect(consumeSlackIdentityLinkMock).toHaveBeenCalledTimes(2);
	});

	it("fails closed when the Slack link token is missing", () => {
		render(
			<TestQueryClientProvider>
				<LinkSlackCard token={null} />
			</TestQueryClientProvider>
		);

		expect(
			screen.getByText(
				"This setup link is incomplete. Return to the original Slack thread and ask the Center Agent for a new setup button. You do not need to repeat your request."
			)
		).toBeTruthy();
		expect(previewSlackIdentityLinkMock).not.toHaveBeenCalled();
	});

	it("clearly confirms before moving Slack from another profile", async () => {
		previewSlackIdentityLinkMock.mockResolvedValueOnce({
			alreadyMember: true,
			continuesRequest: false,
			expiresAt: "2026-07-09T12:15:00.000Z",
			organizationId: "org_1",
			organizationName: "OpenMeld Labs",
			slackDisplayName: "ari",
			slackTeamId: "T123",
			slackUserId: "U123",
			slackWorkspaceLabel: "Acme HQ",
			openMeldAccountEmail: "ari@example.test",
			replacesExistingLink: true,
		});
		consumeSlackIdentityLinkMock.mockResolvedValueOnce({
			continuationRetryable: false,
			continued: false,
			joinedOrganization: false,
			linked: true,
			organizationId: "org_1",
			organizationName: "OpenMeld Labs",
			slackDisplayName: "ari",
			slackTeamId: "T123",
			slackUserId: "U123",
			replacedExistingLink: true,
			openMeldUserId: "user_member",
		});

		render(
			<TestQueryClientProvider>
				<LinkSlackCard token={`slacklink_${"e".repeat(64)}`} />
			</TestQueryClientProvider>
		);

		expect(await screen.findByText("Move your Slack account")).toBeTruthy();
		expect(
			screen.getByText(
				"Slack account @ari is connected to another OpenMeld profile. Continue to move it to ari@example.test; the previous profile will lose this connection."
			)
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Move to my account" }));
		expect(
			await screen.findByText(
				"Your Slack account was moved and is now connected here. You can return to Slack now."
			)
		).toBeTruthy();
	});
});
