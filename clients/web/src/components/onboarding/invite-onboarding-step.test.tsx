import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import {
	InviteOnboardingStep,
	parseOrganizationInviteEmails,
} from "./invite-onboarding-step";

const api = vi.hoisted(() => ({
	getJoinLink: vi.fn(),
	inviteMember: vi.fn(),
	listInvitations: vi.fn(),
	resetJoinLink: vi.fn(),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: {
			id: "org-acme",
			name: "Acme",
			slug: "acme",
		},
		currentUserId: "user-1",
	}),
}));

vi.mock("#/lib/organizations/auth-organizations", () => ({
	getOrganizationJoinLink: api.getJoinLink,
	inviteOrganizationMember: api.inviteMember,
	listOrganizationInvitations: api.listInvitations,
	resetOrganizationJoinLink: api.resetJoinLink,
}));

vi.mock("#/query/organizations/organization-directory", () => ({
	organizationMemberRoleQueryOptions: () => ({
		queryFn: async () => "owner",
		queryKey: ["organizations", "org-acme", "role", "user-1"],
	}),
	organizationQueryKeys: {
		directory: (organizationId: string) => [
			"organizations",
			organizationId,
			"directory",
		],
		invitations: (organizationId: string) => [
			"organizations",
			organizationId,
			"invitations",
		],
		joinLink: (organizationId: string) => [
			"organizations",
			organizationId,
			"join-link",
		],
	},
}));

describe("parseOrganizationInviteEmails", () => {
	it("normalizes and deduplicates comma and newline separated addresses", () => {
		expect(
			parseOrganizationInviteEmails(
				" Maya@Acme.com, alex@acme.com\nmaya@acme.com "
			)
		).toEqual({
			emails: ["maya@acme.com", "alex@acme.com"],
			invalidEmails: [],
		});
	});

	it("keeps invalid entries explicit instead of silently dropping them", () => {
		expect(
			parseOrganizationInviteEmails("alex@acme.com; not-an-email")
		).toEqual({
			emails: ["alex@acme.com"],
			invalidEmails: ["not-an-email"],
		});
	});
});

describe("InviteOnboardingStep", () => {
	beforeEach(() => {
		api.getJoinLink.mockResolvedValue(null);
		api.listInvitations.mockResolvedValue([]);
		api.resetJoinLink.mockResolvedValue({
			createdAt: "2026-07-29T00:00:00.000Z",
			createdBy: "user-1",
			id: "link-1",
			organizationId: "org-acme",
			role: "member",
			token: "token-1",
			url: "https://app.openmeld.dev/join/token-1",
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("shows an optimistic sending state before the invitation request finishes", async () => {
		const invitation = deferred<void>();
		api.inviteMember.mockReturnValue(invitation.promise);

		render(
			<TestQueryClientProvider>
				<InviteOnboardingStep onContinue={vi.fn()} />
			</TestQueryClientProvider>
		);

		const emailInput = await screen.findByRole("textbox", {
			name: "Teammate email addresses",
		});
		fireEvent.change(emailInput, { target: { value: "maya@acme.com" } });
		fireEvent.click(screen.getByRole("button", { name: "Send invites" }));

		expect(await screen.findByText("Sending")).toBeTruthy();
		expect(api.inviteMember).toHaveBeenCalledWith({
			email: "maya@acme.com",
			organizationId: "org-acme",
			role: "member",
		});

		await act(async () => {
			invitation.resolve();
			await invitation.promise;
		});
		await waitFor(() => {
			expect(screen.getByText("Sent")).toBeTruthy();
		});
	});

	it("rolls back only the failed invitation and leaves the failure visible", async () => {
		api.inviteMember.mockRejectedValue(
			new Error("This teammate already has an invitation.")
		);

		render(
			<TestQueryClientProvider>
				<InviteOnboardingStep onContinue={vi.fn()} />
			</TestQueryClientProvider>
		);

		const emailInput = await screen.findByRole("textbox", {
			name: "Teammate email addresses",
		});
		fireEvent.change(emailInput, { target: { value: "maya@acme.com" } });
		fireEvent.click(screen.getByRole("button", { name: "Send invites" }));

		expect(
			await screen.findByText("This teammate already has an invitation.")
		).toBeTruthy();
		expect(screen.queryByText("Sent")).toBeNull();
	});
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}
