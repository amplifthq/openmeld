import type { OrganizationJoinRequest } from "@openmeld/schemas";
import type { OrganizationInvitation } from "./auth-organizations";

export function groupInvitationRecords(
	requests: OrganizationJoinRequest[],
	invitations: OrganizationInvitation[]
) {
	const groups = new Map<
		string,
		{
			email: string;
			requests: OrganizationJoinRequest[];
			invitations: OrganizationInvitation[];
		}
	>();
	const groupFor = (email: string) => {
		const key = email.toLowerCase();
		let group = groups.get(key);
		if (!group) {
			group = { email, requests: [], invitations: [] };
			groups.set(key, group);
		}
		return group;
	};
	for (const request of requests) {
		groupFor(request.email).requests.push(request);
	}
	for (const invitation of invitations) {
		groupFor(invitation.email).invitations.push(invitation);
	}
	// Invitations and requests have no shared record ID. Group by recipient,
	// preserving every source record rather than inventing a causal association.
	return [...groups.values()].sort(
		(a, b) =>
			Number(b.requests.some((request) => request.status === "pending")) -
			Number(a.requests.some((request) => request.status === "pending"))
	);
}
