import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type OrganizationApiMock = {
	acceptInvitation?: ReturnType<typeof vi.fn>;
	cancelInvitation?: ReturnType<typeof vi.fn>;
	create?: ReturnType<typeof vi.fn>;
	delete?: ReturnType<typeof vi.fn>;
	listInvitations?: ReturnType<typeof vi.fn>;
	listUserInvitations?: ReturnType<typeof vi.fn>;
	removeMember?: ReturnType<typeof vi.fn>;
	update?: ReturnType<typeof vi.fn>;
	updateMemberRole?: ReturnType<typeof vi.fn>;
};

type AuthClientMock = {
	organization?: OrganizationApiMock;
};

const { openMeldAuthClientMock } = vi.hoisted(() => ({
	openMeldAuthClientMock: {} as AuthClientMock,
}));

vi.mock("#/lib/auth-client", () => ({
	openMeldAuthClient: openMeldAuthClientMock,
}));

import { getAuthErrorCode } from "#/lib/auth-errors";
import {
	acceptOrganizationInvitation,
	acceptOrganizationJoinLink,
	cancelOrganizationInvitation,
	createOrganization,
	deleteOrganization,
	getOrganizationJoinLink,
	listCurrentUserOrganizationInvitations,
	listOrganizationInvitations,
	OrganizationRequestError,
	previewOrganizationJoinLink,
	removeOrganizationMember,
	resetOrganizationJoinLink,
	revokeOrganizationJoinLink,
	updateOrganization,
	updateOrganizationMemberRole,
} from "./auth-organizations";

describe("auth organization client helpers", () => {
	const fetchMock = vi.fn<typeof fetch>();

	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal("fetch", fetchMock);
		openMeldAuthClientMock.organization = {};
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("reads the organization id from Better Auth's accept invitation response", async () => {
		const acceptInvitation = vi.fn().mockResolvedValue({
			data: {
				invitation: {
					id: "inv-123",
					organizationId: "org-acme",
				},
				member: {
					id: "member-123",
				},
			},
		});
		openMeldAuthClientMock.organization = { acceptInvitation };

		await expect(
			acceptOrganizationInvitation({ invitationId: "inv-123" })
		).resolves.toEqual({ organizationId: "org-acme" });
		expect(acceptInvitation).toHaveBeenCalledWith({ invitationId: "inv-123" });
	});

	it("asks Auth to create an organization URL and normalizes the result", async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "org-acme",
					name: "Acme Labs",
					slug: "acme-labs-k7m3qx",
				}),
				{
					headers: { "content-type": "application/json" },
					status: 200,
				}
			)
		);

		await expect(createOrganization({ name: "Acme Labs" })).resolves.toEqual({
			id: "org-acme",
			isPersonal: false,
			logo: null,
			name: "Acme Labs",
			slug: "acme-labs-k7m3qx",
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/auth/organization/create",
			expect.objectContaining({
				body: JSON.stringify({ name: "Acme Labs" }),
				method: "POST",
			})
		);
	});

	it("uses Better Auth organization management methods with documented input shapes", async () => {
		const update = vi.fn().mockResolvedValue({ data: {} });
		const updateMemberRole = vi.fn().mockResolvedValue({ data: {} });
		const cancelInvitation = vi.fn().mockResolvedValue({ data: {} });
		const deleteOrganizationApi = vi.fn().mockResolvedValue({ data: {} });
		const removeMember = vi.fn().mockResolvedValue({ data: {} });
		openMeldAuthClientMock.organization = {
			cancelInvitation,
			delete: deleteOrganizationApi,
			removeMember,
			update,
			updateMemberRole,
		};

		await updateOrganization({
			data: { name: "Acme Labs", slug: "acme-labs" },
			organizationId: "org-acme",
		});
		await updateOrganizationMemberRole({
			memberId: "member-123",
			organizationId: "org-acme",
			role: "admin",
		});
		await removeOrganizationMember({
			memberIdOrEmail: "member-123",
			organizationId: "org-acme",
		});
		await cancelOrganizationInvitation({ invitationId: "inv-123" });
		await deleteOrganization({ organizationId: "org-acme" });

		expect(update).toHaveBeenCalledWith({
			data: { name: "Acme Labs", slug: "acme-labs" },
			organizationId: "org-acme",
		});
		expect(updateMemberRole).toHaveBeenCalledWith({
			memberId: "member-123",
			organizationId: "org-acme",
			role: "admin",
		});
		expect(removeMember).toHaveBeenCalledWith({
			memberIdOrEmail: "member-123",
			organizationId: "org-acme",
		});
		expect(cancelInvitation).toHaveBeenCalledWith({
			invitationId: "inv-123",
		});
		expect(deleteOrganizationApi).toHaveBeenCalledWith({
			organizationId: "org-acme",
		});
	});

	it("loads organization invitations through the GET auth endpoint", async () => {
		const listInvitations = vi
			.fn()
			.mockRejectedValue(new Error("Dynamic client listInvitations used"));
		openMeldAuthClientMock.organization = { listInvitations };
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({
					invitations: [
						{
							email: "teammate@example.com",
							expiresAt: "2026-08-01T00:00:00.000Z",
							id: "inv-123",
							organizationId: "org-acme",
							role: "member",
							status: "pending",
						},
					],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				}
			)
		);

		await expect(
			listOrganizationInvitations({ organizationId: "org-acme" })
		).resolves.toEqual([
			{
				email: "teammate@example.com",
				expiresAt: "2026-08-01T00:00:00.000Z",
				id: "inv-123",
				organizationId: "org-acme",
				role: "member",
				status: "pending",
			},
		]);

		expect(listInvitations).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/auth/organization/list-invitations?organizationId=org-acme",
			expect.objectContaining({
				credentials: "include",
				method: "GET",
			})
		);
	});

	it("lists the current user's pending organization invitations", async () => {
		const listUserInvitations = vi.fn().mockResolvedValue({
			data: [
				{
					createdAt: new Date("2026-07-29T00:00:00.000Z"),
					email: "felix@example.com",
					expiresAt: new Date("2026-08-01T00:00:00.000Z"),
					id: "inv-user-1",
					inviterId: "user-admin",
					organizationId: "org-acme",
					organizationName: "Acme",
					role: "member",
					status: "pending",
				},
			],
		});
		openMeldAuthClientMock.organization = { listUserInvitations };

		await expect(listCurrentUserOrganizationInvitations()).resolves.toEqual([
			{
				createdAt: "2026-07-29T00:00:00.000Z",
				email: "felix@example.com",
				expiresAt: "2026-08-01T00:00:00.000Z",
				id: "inv-user-1",
				inviterId: "user-admin",
				organizationId: "org-acme",
				organizationName: "Acme",
				role: "member",
				status: "pending",
			},
		]);
		expect(listUserInvitations).toHaveBeenCalledWith();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("preserves auth server messages from the invitation fallback endpoint", async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({
					error: {
						code: "AUTH_UNAUTHENTICATED",
						message: "Not authenticated",
					},
				}),
				{
					status: 400,
					statusText: "Bad Request",
					headers: { "content-type": "application/json" },
				}
			)
		);

		await expect(
			listOrganizationInvitations({ organizationId: "org-acme" })
		).rejects.toThrow("Not authenticated");
	});

	it("reports malformed invitation fallback responses as invalid auth responses", async () => {
		fetchMock.mockResolvedValue(
			new Response("{bad json", {
				status: 200,
				statusText: "OK",
				headers: { "content-type": "application/json" },
			})
		);

		await expect(
			listOrganizationInvitations({ organizationId: "org-acme" })
		).rejects.toThrow("Failed to fetch invitations.");
	});

	it("preserves auth server messages from the cancel invitation fallback endpoint", async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({
					error: {
						code: "INVITATION_NOT_FOUND",
						message: "Invitation was already canceled.",
					},
				}),
				{
					status: 400,
					statusText: "Bad Request",
					headers: { "content-type": "application/json" },
				}
			)
		);

		await expect(
			cancelOrganizationInvitation({ invitationId: "inv-123" })
		).rejects.toThrow("Invitation was already canceled.");
	});

	it("previews a public organization join link through the auth endpoint", async () => {
		const token = `joinlink_${"a".repeat(64)}`;
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({
					active: true,
					ok: true,
					organizationName: "Acme Research",
					organizationSlug: "acme-research",
				}),
				{
					headers: { "content-type": "application/json" },
					status: 200,
				}
			)
		);

		await expect(previewOrganizationJoinLink({ token })).resolves.toEqual({
			active: true,
			ok: true,
			organizationName: "Acme Research",
			organizationSlug: "acme-research",
		});
		expect(fetchMock).toHaveBeenCalledWith(
			`/api/auth/organization/join-link/preview?token=${token}&responseVersion=3`,
			expect.objectContaining({ credentials: "include", method: "GET" })
		);
	});

	it("accepts an organization join link with the shared response contract", async () => {
		const token = `joinlink_${"a".repeat(64)}`;
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({
					alreadyMember: false,
					ok: true,
					organizationId: "org-acme",
					organizationName: "Acme Research",
					organizationSlug: "acme-research",
					role: "member",
				}),
				{
					headers: { "content-type": "application/json" },
					status: 200,
				}
			)
		);

		await expect(acceptOrganizationJoinLink({ token })).resolves.toEqual({
			alreadyMember: false,
			ok: true,
			organizationId: "org-acme",
			organizationName: "Acme Research",
			organizationSlug: "acme-research",
			role: "member",
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/auth/organization/join-link/accept",
			expect.objectContaining({
				body: JSON.stringify({ token }),
				credentials: "include",
				method: "POST",
			})
		);
	});

	it("gets, resets, and revokes the managed organization join link", async () => {
		const token = `joinlink_${"a".repeat(64)}`;
		const joinLink = {
			createdAt: "2026-07-14T01:00:00.000Z",
			createdBy: "user-owner",
			id: "link-1",
			organizationId: "org-acme",
			role: "member",
			token,
			url: `https://app.openmeld.ai/join-organization?token=${token}`,
		};
		fetchMock
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ joinLink: null, ok: true }), {
					headers: { "content-type": "application/json" },
					status: 200,
				})
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ joinLink, ok: true }), {
					headers: { "content-type": "application/json" },
					status: 201,
				})
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: true, revoked: true }), {
					headers: { "content-type": "application/json" },
					status: 200,
				})
			);

		await expect(
			getOrganizationJoinLink({ organizationId: "org-acme" })
		).resolves.toBeNull();
		await expect(
			resetOrganizationJoinLink({ organizationId: "org-acme" })
		).resolves.toEqual(joinLink);
		await expect(
			revokeOrganizationJoinLink({ organizationId: "org-acme" })
		).resolves.toBe(true);

		const path = "/api/auth/organization/join-link?organizationId=org-acme";
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			`${path}&responseVersion=3`,
			expect.objectContaining({ credentials: "include", method: "GET" })
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			`${path}&responseVersion=3`,
			expect.objectContaining({ credentials: "include", method: "POST" })
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			3,
			path,
			expect.objectContaining({ credentials: "include", method: "DELETE" })
		);
	});
});

describe("organization request error code passthrough", () => {
	const fetchMock = vi.fn<typeof fetch>();

	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal("fetch", fetchMock);
		openMeldAuthClientMock.organization = {};
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("preserves the Better Auth error code from the dynamic client accept path", async () => {
		const acceptInvitation = vi.fn().mockResolvedValue({
			error: {
				code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
				message: "You are not the recipient of the invitation.",
				status: 403,
			},
		});
		openMeldAuthClientMock.organization = { acceptInvitation };

		const error = await acceptOrganizationInvitation({
			invitationId: "inv-123",
		}).then(
			() => null,
			(caught: unknown) => caught
		);

		expect(error).toBeInstanceOf(OrganizationRequestError);
		expect(getAuthErrorCode(error)).toBe(
			"YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION"
		);
		expect((error as OrganizationRequestError).message).toBe(
			"You are not the recipient of the invitation."
		);
		expect((error as OrganizationRequestError).status).toBe(403);
	});

	it("preserves the Better Auth error code from the fallback fetch accept path", async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({
					error: {
						code: "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION",
						message: "Verify your email before accepting the invitation.",
					},
				}),
				{
					status: 403,
					statusText: "Forbidden",
					headers: { "content-type": "application/json" },
				}
			)
		);

		const error = await acceptOrganizationInvitation({
			invitationId: "inv-123",
		}).then(
			() => null,
			(caught: unknown) => caught
		);

		expect(error).toBeInstanceOf(OrganizationRequestError);
		expect(getAuthErrorCode(error)).toBe(
			"EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION"
		);
	});
});
