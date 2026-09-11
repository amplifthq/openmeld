import type { OrganizationJoinRequest } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import type { OrganizationInvitation } from "./auth-organizations";
import { groupInvitationRecords } from "./invitation-records";

describe("invitation records", () => {
	it("groups a recipient without losing repeat requests or invitation history, and keeps pending reviews first", () => {
		const request = (
			id: string,
			email: string,
			status: OrganizationJoinRequest["status"]
		): OrganizationJoinRequest => ({
			id,
			email,
			status,
			organizationId: "org",
			spaceId: null,
			requestedByUserId: "member",
			reviewedByUserId: null,
			createdAt: 1,
			reviewedAt: null,
			invitationSentAt: null,
		});
		const invitation = (
			id: string,
			email: string,
			status: string
		): OrganizationInvitation => ({
			id,
			email,
			status,
			organizationId: "org",
			role: "member",
			expiresAt: null,
		});
		const groups = groupInvitationRecords(
			[
				request("approved", "casey@example.com", "approved"),
				request("declined", "casey@example.com", "rejected"),
				request("pending", "jordan@example.com", "pending"),
			],
			[
				invitation("sent", "CASEY@example.com", "pending"),
				invitation("old", "casey@example.com", "canceled"),
				invitation("direct", "avery@example.com", "accepted"),
			]
		);
		expect(groups.map((group) => group.email)).toEqual([
			"jordan@example.com",
			"casey@example.com",
			"avery@example.com",
		]);
		expect(groups[1]?.requests.map((item) => item.id)).toEqual([
			"approved",
			"declined",
		]);
		expect(groups[1]?.invitations.map((item) => item.id)).toEqual([
			"sent",
			"old",
		]);
		expect(groups[2]?.requests).toEqual([]);
		expect(groups[2]?.invitations[0]?.id).toBe("direct");
	});
});
