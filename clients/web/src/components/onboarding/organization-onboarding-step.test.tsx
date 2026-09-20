import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { OrganizationOnboardingStep } from "./organization-onboarding-step";

const api = vi.hoisted(() => ({
	acceptInvitation: vi.fn(),
	listOrganizations: vi.fn(),
	listUserInvitations: vi.fn(),
	previewJoinLink: vi.fn(),
	requestInvitation: vi.fn(),
	acceptJoinLink: vi.fn(),
}));
const AMPLIFT_CURRENT_CHOICE_LABEL = /Amplift.*Current/;
const PERSONAL_WORKSPACE_CHOICE_LABEL =
	/Personal Workspace.*For you only.*Create an organization to connect Slack or invite teammates/;
const OPENMELD_OFFICIAL_CHOICE_LABEL = /OpenMeld Official/;
const JOIN_WITH_LINK_LABEL = /Join with an invite link/;

vi.mock("#/lib/organizations/auth-organizations", () => ({
	acceptOrganizationInvitation: api.acceptInvitation,
	acceptOrganizationJoinLink: api.acceptJoinLink,
	createOrganization: vi.fn(),
	listCurrentUserOrganizationInvitations: api.listUserInvitations,
	listOrganizations: api.listOrganizations,
	previewOrganizationJoinLink: api.previewJoinLink,
}));
vi.mock("#/lib/organizations/organization-join-requests", () => ({
	requestOrganizationJoinRequests: api.requestInvitation,
}));

describe("OrganizationOnboardingStep", () => {
	beforeEach(() => {
		api.listUserInvitations.mockResolvedValue([
			{
				createdAt: "2026-07-29T00:00:00.000Z",
				email: "felix@example.com",
				expiresAt: "2026-08-01T00:00:00.000Z",
				id: "inv-1",
				inviterId: "user-admin",
				organizationId: "org-acme",
				organizationName: "Acme",
				role: "member",
				status: "pending",
			},
		]);
		api.listOrganizations.mockResolvedValue([
			{
				id: "org-acme",
				isPersonal: false,
				name: "Acme",
				slug: "acme",
			},
		]);
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("requests an invitation from onboarding without claiming membership", async () => {
		api.listUserInvitations.mockResolvedValue([]);
		api.previewJoinLink.mockResolvedValue({
			ok: true,
			active: true,
			organizationName: "Acme",
			organizationSlug: "acme",
		});
		api.requestInvitation.mockResolvedValue([
			{ id: "request-1", status: "pending" },
		]);
		const personal = {
			id: "org-personal",
			isPersonal: true,
			name: "Personal",
			slug: "personal",
		};
		const onOrganizationChosen = vi.fn();
		render(
			<TestQueryClientProvider>
				<OrganizationOnboardingStep
					currentOrganization={personal}
					currentUserId="user-1"
					onOrganizationChosen={onOrganizationChosen}
					onPreviewOrganizationChange={vi.fn()}
					organizations={[personal]}
				/>
			</TestQueryClientProvider>
		);
		fireEvent.click(screen.getByRole("button", { name: JOIN_WITH_LINK_LABEL }));
		fireEvent.change(screen.getByLabelText("Invite link"), {
			target: {
				value: "https://openmeld.ai/join-organization?token=joinlink_test",
			},
		});
		fireEvent.click(screen.getByRole("button", { name: "Check invite" }));
		const requestButton = await screen.findByRole("button", {
			name: "Request to join",
		});
		expect(screen.queryByText("Ready to join")).toBeNull();
		expect(api.requestInvitation).not.toHaveBeenCalled();
		fireEvent.click(requestButton);
		await screen.findByText("Request sent");
		expect(api.requestInvitation).toHaveBeenCalledWith({
			token: "joinlink_test",
		});
		expect(api.acceptJoinLink).not.toHaveBeenCalled();
		expect(onOrganizationChosen).not.toHaveBeenCalled();
		expect(
			screen.getByRole("link", { name: "View request" }).getAttribute("href")
		).toBe("/invitation-requests?requestId=request-1");
		fireEvent.click(screen.getByRole("button", { name: "Back to workspaces" }));
		expect(
			screen.getByRole("button", { name: PERSONAL_WORKSPACE_CHOICE_LABEL })
		).toBeTruthy();
	});

	it("joins directly only after Auth confirms an administrator link", async () => {
		api.listUserInvitations.mockResolvedValue([]);
		api.previewJoinLink.mockResolvedValue({
			ok: true,
			active: true,
			mode: "direct",
			organizationName: "Acme",
			organizationSlug: "acme",
		});
		api.acceptJoinLink.mockResolvedValue({
			ok: true,
			organizationId: "org-acme",
			organizationSlug: "acme",
			organizationName: "Acme",
			alreadyMember: false,
			role: "member",
		});
		const personal = {
			id: "org-personal",
			isPersonal: true,
			name: "Personal",
			slug: "personal",
		};
		const chosen = vi.fn();
		render(
			<TestQueryClientProvider>
				<OrganizationOnboardingStep
					currentOrganization={personal}
					currentUserId="user-1"
					onOrganizationChosen={chosen}
					onPreviewOrganizationChange={vi.fn()}
					organizations={[personal]}
				/>
			</TestQueryClientProvider>
		);
		fireEvent.click(screen.getByRole("button", { name: JOIN_WITH_LINK_LABEL }));
		fireEvent.change(screen.getByLabelText("Invite link"), {
			target: { value: "joinlink_direct" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Check invite" }));
		const join = await screen.findByRole("button", { name: "Join Acme" });
		expect(chosen).not.toHaveBeenCalled();
		fireEvent.click(join);
		await waitFor(() =>
			expect(chosen).toHaveBeenCalledWith(
				expect.objectContaining({ id: "org-acme", slug: "acme" })
			)
		);
		expect(api.acceptJoinLink).toHaveBeenCalledWith({
			token: "joinlink_direct",
		});
		expect(api.requestInvitation).not.toHaveBeenCalled();
	});

	it("shows each existing organization's logo or name fallback", () => {
		api.listUserInvitations.mockResolvedValue([]);

		render(
			<TestQueryClientProvider>
				<OrganizationOnboardingStep
					currentOrganization={{
						id: "org-amplift",
						isPersonal: false,
						logo: "https://gateway.example/amplift.webp",
						name: "Amplift",
						slug: "amplift",
					}}
					currentUserId="user-1"
					onOrganizationChosen={vi.fn().mockResolvedValue(undefined)}
					onPreviewOrganizationChange={vi.fn()}
					organizations={[
						{
							id: "org-amplift",
							isPersonal: false,
							logo: "https://gateway.example/amplift.webp",
							name: "Amplift",
							slug: "amplift",
						},
						{
							id: "org-openmeld-official",
							isPersonal: false,
							logo: null,
							name: "OpenMeld Official",
							slug: "openmeld-official",
						},
					]}
				/>
			</TestQueryClientProvider>
		);

		const ampliftChoice = screen.getByRole("button", {
			name: AMPLIFT_CURRENT_CHOICE_LABEL,
		});
		expect(ampliftChoice.closest('[data-slot="card"]')).toBeTruthy();
		expect(ampliftChoice.querySelector("img")?.getAttribute("src")).toBe(
			"https://gateway.example/amplift.webp"
		);
		expect(
			within(
				screen.getByRole("button", {
					name: OPENMELD_OFFICIAL_CHOICE_LABEL,
				})
			).getByText("OO")
		).toBeTruthy();
	});

	it("lets the user explicitly choose their Personal Workspace", async () => {
		api.listUserInvitations.mockResolvedValue([]);
		const personalWorkspace = {
			id: "org-personal",
			isPersonal: true,
			name: "Felix's Workspace",
			slug: "felix",
		};
		const onOrganizationChosen = vi.fn().mockResolvedValue(undefined);
		const onPreviewOrganizationChange = vi.fn();

		render(
			<TestQueryClientProvider>
				<OrganizationOnboardingStep
					currentOrganization={{
						id: "org-amplift",
						isPersonal: false,
						name: "Amplift",
						slug: "amplift",
					}}
					currentUserId="user-1"
					onOrganizationChosen={onOrganizationChosen}
					onPreviewOrganizationChange={onPreviewOrganizationChange}
					organizations={[
						personalWorkspace,
						{
							id: "org-amplift",
							isPersonal: false,
							name: "Amplift",
							slug: "amplift",
						},
					]}
				/>
			</TestQueryClientProvider>
		);

		const personalChoice = screen.getByRole("button", {
			name: PERSONAL_WORKSPACE_CHOICE_LABEL,
		});
		fireEvent.click(personalChoice);

		await waitFor(() => {
			expect(onOrganizationChosen).toHaveBeenCalledWith(personalWorkspace);
		});
		expect(onPreviewOrganizationChange).toHaveBeenCalledWith(personalWorkspace);
	});

	it("optimistically removes a pending invitation while joining", async () => {
		const accepted = deferred<{ organizationId: string }>();
		api.acceptInvitation.mockReturnValue(accepted.promise);
		const onOrganizationChosen = vi.fn().mockResolvedValue(undefined);

		render(
			<TestQueryClientProvider>
				<OrganizationOnboardingStep
					currentOrganization={{
						id: "org-personal",
						isPersonal: true,
						name: "Personal",
						slug: "personal",
					}}
					currentUserId="user-1"
					onOrganizationChosen={onOrganizationChosen}
					onPreviewOrganizationChange={vi.fn()}
					organizations={[
						{
							id: "org-personal",
							isPersonal: true,
							name: "Personal",
							slug: "personal",
						},
					]}
				/>
			</TestQueryClientProvider>
		);

		expect(await screen.findByText("You’re invited")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Join" }));

		await waitFor(() => {
			expect(screen.queryByText("You’re invited")).toBeNull();
		});
		expect(api.acceptInvitation).toHaveBeenCalledWith({
			invitationId: "inv-1",
		});

		await act(async () => {
			accepted.resolve({ organizationId: "org-acme" });
			await accepted.promise;
		});
		await waitFor(() => {
			expect(onOrganizationChosen).toHaveBeenCalledWith({
				id: "org-acme",
				isPersonal: false,
				name: "Acme",
				slug: "acme",
			});
		});
	});
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}
