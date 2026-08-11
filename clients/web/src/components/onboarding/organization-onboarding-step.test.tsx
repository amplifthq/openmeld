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
}));
const AMPLIFT_CURRENT_CHOICE_LABEL = /Amplift.*Current/;
const PERSONAL_WORKSPACE_CHOICE_LABEL = /Personal Workspace.*Private to you/;
const OPENMELD_OFFICIAL_CHOICE_LABEL = /OpenMeld Official/;

vi.mock("#/lib/organizations/auth-organizations", () => ({
	acceptOrganizationInvitation: api.acceptInvitation,
	acceptOrganizationJoinLink: vi.fn(),
	createOrganization: vi.fn(),
	listCurrentUserOrganizationInvitations: api.listUserInvitations,
	listOrganizations: api.listOrganizations,
	previewOrganizationJoinLink: vi.fn(),
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
