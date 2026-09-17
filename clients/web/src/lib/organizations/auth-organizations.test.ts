import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationRequestError } from "#/lib/auth-business";
import {
	acceptOrganizationInvitation,
	acceptOrganizationJoinLink,
	cancelOrganizationInvitation,
	createOrganization,
	deleteOrganization,
	getOrganizationJoinLink,
	listCurrentUserOrganizationInvitations,
	listOrganizationInvitations,
	previewOrganizationJoinLink,
	removeOrganizationMember,
	resetOrganizationJoinLink,
	revokeOrganizationJoinLink,
	updateOrganization,
	updateOrganizationMemberRole,
} from "./auth-organizations";

describe("shared organization business client", () => {
	const fetchMock = vi.fn<typeof fetch>();
	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });
	});
	afterEach(() => vi.unstubAllGlobals());
	it("returns only the shared accepted membership and created organization", async () => {
		fetchMock
			.mockResolvedValueOnce(Response.json({ organizationId: "org-acme" }))
			.mockResolvedValueOnce(
				Response.json({
					id: "org-acme",
					name: "Acme",
					slug: "acme-abcdef",
					logo: null,
					isPersonal: false,
				})
			);
		await expect(
			acceptOrganizationInvitation({ invitationId: "inv-123" })
		).resolves.toEqual({ organizationId: "org-acme" });
		await expect(createOrganization({ name: "Acme" })).resolves.toMatchObject({
			id: "org-acme",
			isPersonal: false,
		});
		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
			"http://localhost:3000/v1/organizations/accept-invitation",
			"http://localhost:3000/v1/organizations",
		]);
	});
	it("keeps nullable invitation fields and requires user invitation organization identity", async () => {
		const invitation = {
			id: "inv-123",
			email: "member@example.com",
			expiresAt: null,
			organizationId: null,
			role: null,
			status: null,
		};
		fetchMock
			.mockResolvedValueOnce(Response.json([invitation]))
			.mockResolvedValueOnce(
				Response.json([
					{
						...invitation,
						organizationId: "org-acme",
						organizationName: "Acme",
						createdAt: null,
						inviterId: null,
					},
				])
			);
		await expect(
			listOrganizationInvitations({ organizationId: "org-acme" })
		).resolves.toEqual([invitation]);
		await expect(
			listCurrentUserOrganizationInvitations()
		).resolves.toMatchObject([{ organizationId: "org-acme", createdAt: null }]);
		fetchMock.mockResolvedValueOnce(Response.json([invitation]));
		await expect(listCurrentUserOrganizationInvitations()).rejects.toThrow(
			"invalid business response"
		);
	});
	it("uses only fixed business operations for settings mutations", async () => {
		fetchMock.mockImplementation(async () => Response.json({ ok: true }));
		await updateOrganization({
			organizationId: "org-acme",
			data: { name: "Acme" },
		});
		await deleteOrganization({ organizationId: "org-acme" });
		await updateOrganizationMemberRole({
			organizationId: "org-acme",
			memberId: "member-1",
			role: "member",
		});
		await removeOrganizationMember({
			organizationId: "org-acme",
			memberIdOrEmail: "member-1",
		});
		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(
			["update", "delete", "update-member-role", "remove-member"].map(
				(operation) => `http://localhost:3000/v1/organizations/${operation}`
			)
		);
	});
	it.each([
		acceptOrganizationInvitation,
		cancelOrganizationInvitation,
	])("preserves owner error code, status and message", async (action) => {
		fetchMock.mockResolvedValueOnce(
			Response.json(
				{ code: "INVITATION_EXPIRED", message: "Invitation has expired." },
				{ status: 403 }
			)
		);
		await expect(action({ invitationId: "inv-123" })).rejects.toMatchObject({
			code: "INVITATION_EXPIRED",
			status: 403,
			message: "Invitation has expired.",
		});
	});
	it("fails on malformed output rather than converting it to membership", async () => {
		fetchMock.mockResolvedValueOnce(
			Response.json({ member: { id: "member-1" } })
		);
		await expect(
			acceptOrganizationInvitation({ invitationId: "inv-123" })
		).rejects.toBeInstanceOf(OrganizationRequestError);
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
			`http://localhost:3000/v1/organization-join-link/preview?token=${token}&responseVersion=3`,
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
			"http://localhost:3000/v1/organization-join-link/accept",
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

		const path =
			"http://localhost:3000/v1/organization-join-link?organizationId=org-acme";
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
			`${path}&responseVersion=3`,
			expect.objectContaining({ credentials: "include", method: "DELETE" })
		);
	});
});
