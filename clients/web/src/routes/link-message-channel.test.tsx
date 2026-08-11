import { isRedirect } from "@tanstack/react-router";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { LinkMessageChannelCard, Route } from "./link-message-channel";

const consumeMessageChannelIdentityLinkMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const previewMessageChannelIdentityLinkMock = vi.hoisted(() => vi.fn());
const useAuthSessionMock = vi.hoisted(() => vi.fn());

vi.mock("#/hooks/auth.hooks", () => ({
	useAuthSession: useAuthSessionMock,
}));

vi.mock("#/lib/auth-session", () => ({
	getSession: getSessionMock,
}));

vi.mock("#/lib/organizations/message-channels", async () => {
	const actual = await vi.importActual<
		typeof import("#/lib/organizations/message-channels")
	>("#/lib/organizations/message-channels");
	return {
		...actual,
		consumeMessageChannelIdentityLink: consumeMessageChannelIdentityLinkMock,
		previewMessageChannelIdentityLink: previewMessageChannelIdentityLinkMock,
	};
});

describe("link-message-channel route", () => {
	beforeEach(() => {
		getSessionMock.mockReset().mockResolvedValue(null);
	});

	it("redirects an unauthenticated link to login with the original return URL", async () => {
		const href =
			"/link-message-channel?token=messagechannellink_original_token";
		let thrown: unknown;
		try {
			await Route.options.beforeLoad?.({
				location: {
					href,
					pathname: "/link-message-channel",
					search: Object.assign(Object.create(null), {
						token: "messagechannellink_original_token",
					}),
				},
			} as never);
		} catch (error) {
			thrown = error;
		}

		expect(isRedirect(thrown)).toBe(true);
		const options = (
			thrown as {
				options: { search: { redirect: unknown }; to: string };
			}
		).options;
		expect(options.to).toBe("/login");
		expect(options.search.redirect).toBe(href);
	});
});

describe("LinkMessageChannelCard", () => {
	beforeEach(() => {
		previewMessageChannelIdentityLinkMock.mockReset().mockResolvedValue({
			alreadyMember: true,
			continuesRequest: true,
			expiresAt: "2026-07-19T12:15:00.000Z",
			organizationId: "org_1",
			organizationName: "OpenMeld Labs",
			provider: "lark",
			providerUserDisplayName: "Ari Chen",
			providerUserId: "ou_ari",
			openMeldAccountEmail: "ari@example.test",
		});
		consumeMessageChannelIdentityLinkMock.mockReset().mockResolvedValue({
			continuationRetryable: false,
			continued: true,
			continuesRequest: true,
			joinedOrganization: false,
			linked: true,
			organizationId: "org_1",
			organizationName: "OpenMeld Labs",
			provider: "lark",
			providerUserDisplayName: "Ari Chen",
			providerUserId: "ou_ari",
			openMeldUserId: "user_member",
		});
		useAuthSessionMock.mockReturnValue({
			data: { user: { email: "ari@example.test" } },
		});
	});

	afterEach(cleanup);

	it("shows both identities and the Organization before consuming the link", async () => {
		const token = `messagechannellink_${"a".repeat(64)}`;
		const queryClient = createTestQueryClient();
		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<LinkMessageChannelCard token={token} />
			</TestQueryClientProvider>
		);

		expect(await screen.findByText("Connect your Lark account")).toBeTruthy();
		expect(screen.getByText("Ari Chen")).toBeTruthy();
		expect(screen.getByText("ari@example.test")).toBeTruthy();
		expect(screen.getByText("Organization: OpenMeld Labs")).toBeTruthy();
		expect(
			screen.getByText(
				"Connect Ari Chen on Lark to ari@example.test. OpenMeld will then continue your original request automatically."
			)
		).toBeTruthy();

		fireEvent.click(
			screen.getByRole("button", { name: "Connect my account and continue" })
		);

		await waitFor(() => {
			expect(consumeMessageChannelIdentityLinkMock).toHaveBeenCalledWith({
				token,
			});
		});
		expect(await screen.findByText("You're ready.")).toBeTruthy();
		expect(
			screen.getByText(
				"The Center Agent is continuing your original request in Lark now."
			)
		).toBeTruthy();
		expect(
			queryClient.getQueryData([
				"message-channel-identity-link",
				"preview",
				token,
			])
		).toBeUndefined();
	});

	it("fails closed when the account-link token is missing", () => {
		render(
			<TestQueryClientProvider>
				<LinkMessageChannelCard token={null} />
			</TestQueryClientProvider>
		);

		expect(
			screen.getByText(
				"This account link is missing a token. Go back to Lark or Feishu and ask the Center Agent again."
			)
		).toBeTruthy();
		expect(previewMessageChannelIdentityLinkMock).not.toHaveBeenCalled();
	});
});
