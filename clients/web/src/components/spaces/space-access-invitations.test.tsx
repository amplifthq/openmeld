import type { SpaceInvitation } from "@openmeld/schemas";
import {
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type {
	GetSpaceStatusResponse,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spaceQueryKeys } from "#/query/spaces/status";
import { SpaceAccessSettings } from "./space-access-settings";
import { SpaceInvitationForm } from "./space-invitations-section";
import { useSpaceSharingDraft } from "./use-space-sharing-draft";

const boundary = vi.hoisted(() => ({
	invitations: vi.fn(),
	members: vi.fn(),
	proposal: vi.fn(),
	userId: "user-123",
	organizationId: "org-123",
	role: "owner",
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({
		currentOrganization: {
			id: boundary.organizationId,
			name: "Northstar",
			slug: "northstar",
			isPersonal: false,
		},
		currentUserId: boundary.userId,
	}),
}));
vi.mock(
	"#/query/organizations/organization-directory",
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		organizationMemberRoleQueryOptions: () => ({
			queryKey: [
				"invitation-test-role",
				boundary.userId,
				boundary.organizationId,
			],
			queryFn: async () => boundary.role,
		}),
	})
);
vi.mock("#/lib/organizations/auth-organizations", () => ({
	prepareOrganizationJoinLink: async () => null,
}));
vi.mock("#/query/spaces/retry", () => ({ shouldRetrySpaceQuery: () => false }));
vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: () => ({
		getMembersSnapshot: boundary.members,
	}),
}));
vi.mock("#/lib/organizations/space-invitations", () => ({
	requestSpaceInvitations: boundary.invitations,
	SpaceInvitationRequestError: class extends Error {},
}));
vi.mock("#/lib/organizations/organization-join-requests", () => ({
	requestOrganizationJoinRequests: boundary.proposal,
}));

const clients: QueryClient[] = [];
const pendingLabel = /Pending invitations/;
const sentLabel = /Invitation sent/;

function eligibleMembers(): SpaceMembersSnapshot {
	return createSpaceMembersSnapshot({
		spaceId: "space-123",
		humans: [
			createSpaceMemberHumanSnapshot({
				ownerUserId: boundary.userId,
				status: "active",
			}),
		],
	});
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function wrap(content: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	clients.push(client);
	client.setQueryData<GetSpaceStatusResponse>(
		spaceQueryKeys.status("space-123", undefined),
		{
			accessMode: "public",
			allowedActions: ["post_message", "post_status", "stay_silent"],
			allowGuests: true,
			dispatchBrief: "default",
			dispatchPolicy: { mode: "mention_only" },
			entryBrief: "default",
			generatedAt: new Date().toISOString(),
			linkJoinPolicy: "invite_only",
			members: {
				agentCount: 0,
				humanCount: 1,
				liveAgentCount: 0,
				liveHumanCount: 1,
				liveNowCount: 1,
				totalCount: 1,
			},
			passwordProtected: false,
			publicationMode: "collaboration",
			resultArchivePolicy: { mode: "all_final_results" },
			spaceId: "space-123",
		}
	);
	return {
		client,
		...render(
			<QueryClientProvider client={client}>{content}</QueryClientProvider>
		),
	};
}

function Settings({ spaceId = "space-123" }: { spaceId?: string }) {
	const saved = {
		spaceId,
		accessMode: "public" as const,
		allowGuests: true,
		linkJoinPolicy: "invite_only" as const,
		visibility: "private" as const,
	};
	const draftController = useSpaceSharingDraft(saved);
	return (
		<SpaceAccessSettings
			{...saved}
			canManageAccess
			draftController={draftController}
			errorMessage={null}
			initialShareView="invite"
			isPending={false}
			onSetAccessMode={() => {
				throw new Error("This test must not change access policy");
			}}
			surface="share"
		/>
	);
}

async function emailInput() {
	return (await screen.findByRole("textbox", {
		name: "Email address",
	})) as HTMLInputElement;
}

function typeEmail(input: HTMLInputElement, value: string) {
	fireEvent.change(input, { target: { value } });
}

async function chooseAudience(label: string) {
	fireEvent.click(screen.getByRole("combobox", { name: "Invite as" }));
	fireEvent.click(await screen.findByRole("option", { name: label }));
}

describe("Space invitation lifecycle", () => {
	beforeEach(() => {
		boundary.userId = "user-123";
		boundary.organizationId = "org-123";
		boundary.role = "owner";
		boundary.invitations.mockReset().mockResolvedValue([]);
		boundary.proposal.mockReset().mockResolvedValue([]);
		boundary.members
			.mockReset()
			.mockImplementation(async () => eligibleMembers());
	});
	afterEach(() => {
		cleanup();
		for (const client of clients.splice(0)) {
			client.clear();
		}
	});

	it("preserves draft and pending operation across real Share tabs", async () => {
		const response = deferred<[]>();
		boundary.invitations.mockImplementation((request) =>
			request.action === "list" ? Promise.resolve([]) : response.promise
		);
		wrap(<Settings />);
		typeEmail(await emailInput(), "first@example.com");
		fireEvent.click(screen.getByRole("button", { name: "Invite guest" }));
		await waitFor(() =>
			expect(boundary.invitations).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "create",
					email: "first@example.com",
				})
			)
		);
		typeEmail(await emailInput(), "next@example.com");
		fireEvent.click(screen.getByRole("tab", { name: "Share link" }));
		await waitFor(() =>
			expect(
				screen.queryByRole("textbox", { name: "Email address" })
			).toBeNull()
		);
		fireEvent.click(screen.getByRole("tab", { name: "Invite people" }));
		expect((await emailInput()).value).toBe("next@example.com");
		expect(
			(
				screen.getByRole("button", {
					name: "Invite guest",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		await act(async () => response.resolve([]));
		expect((await emailInput()).value).toBe("next@example.com");
	});

	it("keeps separate Guest and Teammate drafts and remembers the audience", async () => {
		wrap(<Settings />);
		typeEmail(await emailInput(), "guest@example.com");
		await chooseAudience("Teammate — organization and this Space");
		expect((await emailInput()).value).toBe("");
		typeEmail(await emailInput(), "teammate@example.com");
		fireEvent.click(screen.getByRole("tab", { name: "Share link" }));
		fireEvent.click(screen.getByRole("tab", { name: "Invite people" }));
		expect((await emailInput()).value).toBe("teammate@example.com");
		await chooseAudience("Guest — this Space only");
		expect((await emailInput()).value).toBe("guest@example.com");
	});

	it.each([
		"create",
		"proposal",
	])("clears only the unchanged submitted %s draft", async (operation) => {
		const response = deferred<[]>();
		boundary.role = operation === "proposal" ? "member" : "owner";
		boundary.invitations.mockImplementation((request) =>
			request.action === "list" ? Promise.resolve([]) : response.promise
		);
		boundary.proposal.mockReturnValue(response.promise);
		wrap(
			<SpaceInvitationForm
				audience={operation === "proposal" ? "organization" : "guest"}
				spaceId="space-123"
			/>
		);
		const input = await emailInput();
		typeEmail(input, "first@example.com");
		fireEvent.click(
			screen.getByRole("button", {
				name: operation === "proposal" ? "Request invitation" : "Invite guest",
			})
		);
		await waitFor(() =>
			expect(
				operation === "proposal" ? boundary.proposal : boundary.invitations
			).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "create",
					email: "first@example.com",
				})
			)
		);
		// Editing away and back still creates a new draft, even if text matches.
		typeEmail(input, "next@example.com");
		typeEmail(input, "first@example.com");
		await act(async () => response.resolve([]));
		expect(input.value).toBe("first@example.com");
	});

	it.each([
		"resend",
		"revoke",
	])("does not clear new input after %s of an old invitation", async (action) => {
		const oldInvitation: SpaceInvitation = {
			id: "inv-old",
			email: "old@example.com",
			status: "pending",
			audience: "guest",
			organizationId: "org-123",
			organizationName: "Northstar",
			spaceId: "space-123",
			spaceName: "Team",
			inviterName: "Owner",
			expiresAt: Date.now() + 60_000,
		};
		boundary.invitations.mockImplementation(async (request) =>
			request.action === "list" ? [oldInvitation] : []
		);
		wrap(<SpaceInvitationForm audience="guest" spaceId="space-123" />);
		const input = await emailInput();
		typeEmail(input, "new@example.com");
		fireEvent.click(await screen.findByText(pendingLabel));
		fireEvent.click(
			await screen.findByText(action === "resend" ? "Resend" : "Revoke")
		);
		await waitFor(() =>
			expect(boundary.invitations).toHaveBeenCalledWith({
				action,
				invitationId: "inv-old",
			})
		);
		await waitFor(() =>
			expect(
				boundary.invitations.mock.calls.filter(
					([request]) => request.action === "list"
				).length
			).toBeGreaterThan(1)
		);
		expect(input.value).toBe("new@example.com");
	});

	it("shows initial loading and a retryable failed membership read", async () => {
		const response = deferred<SpaceMembersSnapshot>();
		boundary.members.mockReturnValueOnce(response.promise);
		wrap(<Settings />);
		expect(await screen.findByText("Loading invitation options…")).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Share link" })).toBeTruthy();
		await act(async () => response.reject(new Error("Membership unavailable")));
		expect(
			await screen.findByText("Unable to load invitation options.")
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Invite guest" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(await emailInput()).toBeTruthy();
	});

	it.each([
		true,
		false,
	])("clears an unchanged submitted draft only on success=%s", async (success) => {
		const response = deferred<[]>();
		boundary.invitations.mockImplementation((request) =>
			request.action === "list" ? Promise.resolve([]) : response.promise
		);
		wrap(<SpaceInvitationForm audience="guest" spaceId="space-123" />);
		const input = await emailInput();
		typeEmail(input, "recipient@example.com");
		fireEvent.click(screen.getByRole("button", { name: "Invite guest" }));
		await waitFor(() =>
			expect(boundary.invitations).toHaveBeenCalledWith(
				expect.objectContaining({ action: "create" })
			)
		);
		await act(() => {
			if (success) {
				response.resolve([]);
			} else {
				response.reject(new Error("Invitation failed"));
			}
		});
		if (success) {
			await screen.findByText(
				"Invitation sent to recipient@example.com. They’ll appear in this Space after accepting."
			);
		} else {
			await screen.findByText("Invitation failed");
		}
		expect(input.value).toBe(success ? "" : "recipient@example.com");
	});

	it("keeps drafts during a failed background read but removes revoked access", async () => {
		const { client } = wrap(<Settings />);
		typeEmail(await emailInput(), "draft@example.com");
		boundary.members.mockRejectedValueOnce(new Error("Membership unavailable"));
		await act(() =>
			client.invalidateQueries({
				queryKey: spaceQueryKeys.members("space-123", undefined),
			})
		);
		await screen.findByText("Unable to load invitation options.");
		expect((await emailInput()).value).toBe("draft@example.com");
		expect(
			(
				screen.getByRole("button", {
					name: "Invite guest",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await waitFor(() =>
			expect(
				(
					screen.getByRole("button", {
						name: "Invite guest",
					}) as HTMLButtonElement
				).disabled
			).toBe(false)
		);
		expect((await emailInput()).value).toBe("draft@example.com");
		boundary.members.mockResolvedValueOnce(
			createSpaceMembersSnapshot({ spaceId: "space-123" })
		);
		await act(() =>
			client.invalidateQueries({
				queryKey: spaceQueryKeys.members("space-123", undefined),
			})
		);
		await screen.findByText("Only active Space members can send invitations.");
		expect(screen.queryByRole("button", { name: "Invite guest" })).toBeNull();
	});

	it.each([
		"account",
		"organization",
		"space",
	])("discards the old draft and late result on a different %s", async (change) => {
		const response = deferred<[]>();
		boundary.invitations.mockImplementation((request) =>
			request.action === "list" ? Promise.resolve([]) : response.promise
		);
		const { client, rerender } = wrap(
			<SpaceInvitationForm audience="guest" spaceId="space-123" />
		);
		typeEmail(await emailInput(), "old@example.com");
		fireEvent.click(screen.getByRole("button", { name: "Invite guest" }));
		await waitFor(() =>
			expect(boundary.invitations).toHaveBeenCalledWith(
				expect.objectContaining({ action: "create" })
			)
		);
		if (change === "account") {
			boundary.userId = "user-456";
		}
		if (change === "organization") {
			boundary.organizationId = "org-456";
		}
		rerender(
			<QueryClientProvider client={client}>
				<SpaceInvitationForm
					audience="guest"
					spaceId={change === "space" ? "space-456" : "space-123"}
				/>
			</QueryClientProvider>
		);
		expect((await emailInput()).value).toBe("");
		typeEmail(await emailInput(), "new@example.com");
		await act(async () => response.resolve([]));
		expect((await emailInput()).value).toBe("new@example.com");
		expect(screen.queryByText(sentLabel)).toBeNull();
	});
});
