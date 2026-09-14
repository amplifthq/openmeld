import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";

const acceptOrganizationInvitationMock = vi.hoisted(() => vi.fn());
const listOrganizationsMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const signOutMutateAsyncMock = vi.hoisted(() => vi.fn());
let sessionQuery = vi.hoisted(() => ({
	data: { user: { email: "beatrice@gmail.com", id: "user-1" } } as {
		user: { email?: string; id: string };
	} | null,
	isPending: false,
}));
let signOutState = vi.hoisted(() => ({
	isPending: false,
	mutateAsync: signOutMutateAsyncMock,
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (config: unknown) => ({
		...(config as Record<string, unknown>),
		useSearch: () => ({}),
	}),
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
	useNavigate: () => navigateMock,
}));

vi.mock("#/components/auth/auth-page-shell", () => ({
	AuthPageShell: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
}));

vi.mock("#/hooks/auth.hooks", () => ({
	useAuthSession: () => sessionQuery,
	useSignOut: () => signOutState,
}));

vi.mock("#/lib/organizations/auth-organizations", () => ({
	acceptOrganizationInvitation: acceptOrganizationInvitationMock,
	listOrganizations: listOrganizationsMock,
}));

import { AcceptInvitationPage } from "./accept-invitation";

const NO_LONGER_VALID_PATTERN = /This invitation is no longer valid/;

function errorWithCode(code: string, message = "failed"): Error {
	return Object.assign(new Error(message), { code });
}

describe("AcceptInvitationPage", () => {
	beforeEach(() => {
		acceptOrganizationInvitationMock.mockReset();
		listOrganizationsMock.mockReset();
		navigateMock.mockReset().mockResolvedValue(undefined);
		signOutMutateAsyncMock.mockReset().mockResolvedValue(undefined);
		sessionQuery = {
			data: { user: { email: "beatrice@gmail.com", id: "user-1" } },
			isPending: false,
		};
		signOutState = { isPending: false, mutateAsync: signOutMutateAsyncMock };
	});

	afterEach(cleanup);

	it("auto-accepts when signed in and navigates to the organization", async () => {
		acceptOrganizationInvitationMock.mockResolvedValue({
			organizationId: "org-acme",
		});
		listOrganizationsMock.mockResolvedValue([
			{ id: "org-solo", isPersonal: true, name: "Felix", slug: "felix" },
			{ id: "org-acme", name: "Acme", slug: "acme" },
		]);

		render(
			<TestQueryClientProvider>
				<AcceptInvitationPage
					invitationId="inv-123"
					org="Acme"
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme/spaces",
			});
		});
		expect(acceptOrganizationInvitationMock).toHaveBeenCalledWith({
			invitationId: "inv-123",
		});
		expect(
			acceptOrganizationInvitationMock.mock.invocationCallOrder[0]
		).toBeLessThan(navigateMock.mock.invocationCallOrder[0] ?? 0);
	});

	it("retries opening the organization without accepting the invitation again", async () => {
		acceptOrganizationInvitationMock.mockResolvedValue({
			organizationId: "org-acme",
		});
		listOrganizationsMock.mockResolvedValue([
			{ id: "org-acme", name: "Acme", slug: "acme" },
		]);
		navigateMock
			.mockRejectedValueOnce(new Error("navigation failed"))
			.mockResolvedValueOnce(undefined);

		render(
			<TestQueryClientProvider>
				<AcceptInvitationPage
					invitationId="inv-123"
					org="Acme"
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);

		const retryButton = await screen.findByRole("button", {
			name: "Open Acme again",
		});
		expect(acceptOrganizationInvitationMock).toHaveBeenCalledTimes(1);
		expect(navigateMock).toHaveBeenCalledTimes(1);

		fireEvent.click(retryButton);

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledTimes(2);
		});
		expect(acceptOrganizationInvitationMock).toHaveBeenCalledTimes(1);
	});

	it("shows an error instead of guessing when the accepted organization is missing", async () => {
		acceptOrganizationInvitationMock.mockResolvedValue({
			organizationId: "org-missing",
		});
		listOrganizationsMock.mockResolvedValue([
			{ id: "org-other", name: "Other", slug: "other" },
		]);

		render(
			<TestQueryClientProvider>
				<AcceptInvitationPage invitationId="inv-123" />
			</TestQueryClientProvider>
		);

		expect(
			await screen.findByText(
				"OpenMeld accepted this invitation, but could not find the organization in your account. Refresh this page and try again."
			)
		).toBeTruthy();
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("offers to switch accounts when the session is not the invited recipient", async () => {
		acceptOrganizationInvitationMock.mockRejectedValue(
			errorWithCode("YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION")
		);

		render(
			<TestQueryClientProvider>
				<AcceptInvitationPage
					hint="t***@acme.io"
					invitationId="inv-123"
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);

		const switchButton = await screen.findByRole("button", {
			name: "Sign out and use t***@acme.io",
		});
		fireEvent.click(switchButton);

		await waitFor(() => {
			expect(signOutMutateAsyncMock).toHaveBeenCalled();
		});
		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				search: { redirect: expect.stringContaining("invitationId=inv-123") },
				to: "/login",
			});
		});
	});

	it("treats an already-accepted invitation as existing membership", async () => {
		acceptOrganizationInvitationMock.mockRejectedValue(
			errorWithCode("INVITATION_NOT_FOUND")
		);
		listOrganizationsMock.mockResolvedValue([
			{ id: "org-acme", name: "Acme", slug: "acme" },
		]);

		render(
			<TestQueryClientProvider>
				<AcceptInvitationPage
					invitationId="inv-123"
					org="Acme"
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);

		expect(
			await screen.findByText("You are already a member of Acme.")
		).toBeTruthy();
		const organizationLink = await screen.findByRole("link", {
			name: "Go to Acme",
		});
		expect(organizationLink.getAttribute("href")).toBe("/o/acme/spaces");
	});

	it("reports an expired or revoked invitation when membership is absent", async () => {
		acceptOrganizationInvitationMock.mockRejectedValue(
			errorWithCode("INVITATION_NOT_FOUND")
		);
		listOrganizationsMock.mockResolvedValue([
			{ id: "org-other", name: "Other", slug: "other" },
		]);

		render(
			<TestQueryClientProvider>
				<AcceptInvitationPage
					invitationId="inv-123"
					org="Acme"
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);

		expect(await screen.findByText(NO_LONGER_VALID_PATTERN)).toBeTruthy();
	});

	it("guides signed-out visitors to sign in with the invited email", () => {
		sessionQuery = { data: null, isPending: false };

		render(
			<TestQueryClientProvider>
				<AcceptInvitationPage
					hint="t***@acme.io"
					invitationId="inv-123"
					org="Acme"
				/>
			</TestQueryClientProvider>
		);

		expect(
			screen.getByRole("link", { name: "Sign in to accept" })
		).toBeTruthy();
		expect(acceptOrganizationInvitationMock).not.toHaveBeenCalled();
	});
});
