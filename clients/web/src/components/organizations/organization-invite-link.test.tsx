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

const copyTextToClipboardMock = vi.hoisted(() => vi.fn());
const getOrganizationJoinLinkMock = vi.hoisted(() => vi.fn());
const resetOrganizationJoinLinkMock = vi.hoisted(() => vi.fn());
const revokeOrganizationJoinLinkMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/clipboard", () => ({
	copyTextToClipboard: copyTextToClipboardMock,
}));

vi.mock("#/lib/organizations/auth-organizations", () => ({
	getOrganizationJoinLink: getOrganizationJoinLinkMock,
	resetOrganizationJoinLink: resetOrganizationJoinLinkMock,
	revokeOrganizationJoinLink: revokeOrganizationJoinLinkMock,
}));

import { OrganizationInviteLink } from "./organization-invite-link";

const FIRST_TOKEN = `joinlink_${"a".repeat(64)}`;
const SECOND_TOKEN = `joinlink_${"b".repeat(64)}`;
const FIRST_URL = `https://app.openmeld.ai/join-organization?token=${FIRST_TOKEN}`;
const SECOND_URL = `https://app.openmeld.ai/join-organization?token=${SECOND_TOKEN}`;

function joinLink(input: { id: string; token: string; url: string }) {
	return {
		createdAt: "2026-07-14T01:00:00.000Z",
		createdBy: "user-owner",
		id: input.id,
		organizationId: "org-acme",
		role: "member" as const,
		token: input.token,
		url: input.url,
	};
}

describe("OrganizationInviteLink", () => {
	beforeEach(() => {
		copyTextToClipboardMock.mockReset().mockResolvedValue(true);
		getOrganizationJoinLinkMock.mockReset().mockResolvedValue(null);
		resetOrganizationJoinLinkMock
			.mockReset()
			.mockResolvedValueOnce(
				joinLink({ id: "link-1", token: FIRST_TOKEN, url: FIRST_URL })
			)
			.mockResolvedValueOnce(
				joinLink({ id: "link-2", token: SECOND_TOKEN, url: SECOND_URL })
			);
		revokeOrganizationJoinLinkMock.mockReset().mockResolvedValue(true);
	});

	afterEach(cleanup);

	it("keeps the last loaded link visible after a failed refresh and retries", async () => {
		const queryClient = createTestQueryClient();
		getOrganizationJoinLinkMock.mockResolvedValue(
			joinLink({ id: "link-1", token: FIRST_TOKEN, url: FIRST_URL })
		);
		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<OrganizationInviteLink organizationId="org-acme" />
			</TestQueryClientProvider>
		);
		expect(await screen.findByDisplayValue(FIRST_URL)).toBeTruthy();
		getOrganizationJoinLinkMock.mockRejectedValue(
			new Error("Internal server error")
		);
		await queryClient.invalidateQueries();
		expect(
			await screen.findByText(
				"Could not refresh the invite link. Showing the last loaded link; its status could not be confirmed."
			)
		).toBeTruthy();
		expect(screen.getByDisplayValue(FIRST_URL)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Copy" }));
		await waitFor(() =>
			expect(copyTextToClipboardMock).toHaveBeenCalledWith(FIRST_URL)
		);
		getOrganizationJoinLinkMock.mockResolvedValue(
			joinLink({ id: "link-2", token: SECOND_TOKEN, url: SECOND_URL })
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByDisplayValue(SECOND_URL)).toBeTruthy();
		expect(screen.queryByDisplayValue(FIRST_URL)).toBeNull();
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
	});

	it("shows a retry without a link when the first load fails", async () => {
		getOrganizationJoinLinkMock.mockRejectedValue(
			new Error("Internal server error")
		);
		render(
			<TestQueryClientProvider>
				<OrganizationInviteLink organizationId="org-acme" />
			</TestQueryClientProvider>
		);
		expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
		expect(screen.queryByLabelText("Invite link URL")).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Generate invite link" })
		).toBeNull();
	});

	it("generates, copies, resets, and revokes an organization invite link", async () => {
		render(
			<TestQueryClientProvider>
				<OrganizationInviteLink organizationId="org-acme" />
			</TestQueryClientProvider>
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Generate invite link" })
		);

		expect(await screen.findByDisplayValue(FIRST_URL)).toBeTruthy();
		expect(resetOrganizationJoinLinkMock).toHaveBeenNthCalledWith(1, {
			mode: "direct",
			organizationId: "org-acme",
		});

		fireEvent.click(screen.getByRole("button", { name: "Copy" }));

		await waitFor(() => {
			expect(copyTextToClipboardMock).toHaveBeenCalledWith(FIRST_URL);
		});
		expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Reset" }));

		expect(await screen.findByDisplayValue(SECOND_URL)).toBeTruthy();
		expect(screen.queryByDisplayValue(FIRST_URL)).toBeNull();
		expect(resetOrganizationJoinLinkMock).toHaveBeenNthCalledWith(2, {
			mode: "direct",
			organizationId: "org-acme",
		});

		fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

		expect(
			await screen.findByRole("button", { name: "Generate invite link" })
		).toBeTruthy();
		expect(revokeOrganizationJoinLinkMock).toHaveBeenCalledWith({
			mode: "direct",
			organizationId: "org-acme",
		});
	});
});
