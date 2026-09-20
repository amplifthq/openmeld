import {
	acceptOrganizationJoinLinkResponseSchema,
	getOrganizationJoinLinkResponseSchema,
	type OrganizationInvitationView,
	organizationActionSuccessSchema,
	organizationCreateActionSchema,
	organizationCreatedActionResponseSchema,
	organizationIdActionSchema,
	organizationInvitationAcceptedSchema,
	organizationInvitationIdActionSchema,
	organizationInvitationsResponseSchema,
	organizationInviteActionSchema,
	organizationMemberRemovalActionSchema,
	organizationMemberRoleActionSchema,
	organizationUpdateActionSchema,
	previewOrganizationJoinLinkResponseSchema,
	revokeOrganizationJoinLinkResponseSchema,
	type UserOrganizationInvitationView,
	userOrganizationInvitationsResponseSchema,
} from "@openmeld/schemas";
import type {
	AcceptOrganizationJoinLinkBody,
	OrganizationJoinLinkManagementQuery,
	PreviewOrganizationJoinLinkQuery,
} from "@openmeld/schemas/types";
import type { z } from "zod/v4";
import {
	OrganizationRequestError,
	requestAuthBusiness,
} from "#/lib/auth-business";
import { readCurrentAccountOrganizationContext } from "./account-organization-context";

export type { OrganizationInviteRole } from "@openmeld/schemas";
export type OrganizationInvitation = OrganizationInvitationView;
export type UserOrganizationInvitation = UserOrganizationInvitationView;
export type OrganizationCreateInput = z.infer<
	typeof organizationCreateActionSchema
>;
export type OrganizationUpdateData = z.infer<
	typeof organizationUpdateActionSchema
>["data"];
export type AcceptedOrganizationInvitation = z.infer<
	typeof organizationInvitationAcceptedSchema
>;

export async function listOrganizations() {
	const context =
		await readCurrentAccountOrganizationContext("membership_list");
	if (!context) {
		throw new OrganizationRequestError({
			code: "auth.unauthenticated",
			status: 401,
			message: "Sign in again to continue.",
		});
	}
	return context.organizations;
}

export async function createOrganization(
	input: z.infer<typeof organizationCreateActionSchema>
) {
	return await requestAuthBusiness({
		path: "/v1/organizations",
		method: "POST",
		body: organizationCreateActionSchema.parse(input),
		schema: organizationCreatedActionResponseSchema,
	});
}

export async function updateOrganization(
	input: z.infer<typeof organizationUpdateActionSchema>
) {
	await requestAuthBusiness({
		path: "/v1/organizations/update",
		method: "POST",
		body: organizationUpdateActionSchema.parse(input),
		schema: organizationActionSuccessSchema,
	});
}

export async function deleteOrganization(
	input: z.infer<typeof organizationIdActionSchema>
) {
	await requestAuthBusiness({
		path: "/v1/organizations/delete",
		method: "POST",
		body: organizationIdActionSchema.parse(input),
		schema: organizationActionSuccessSchema,
	});
}

export async function inviteOrganizationMember(
	input: z.infer<typeof organizationInviteActionSchema>
) {
	await requestAuthBusiness({
		path: "/v1/organizations/invite-member",
		method: "POST",
		body: organizationInviteActionSchema.parse(input),
		schema: organizationActionSuccessSchema,
	});
}

export async function acceptOrganizationInvitation(
	input: z.infer<typeof organizationInvitationIdActionSchema>
) {
	return await requestAuthBusiness({
		path: "/v1/organizations/accept-invitation",
		method: "POST",
		body: organizationInvitationIdActionSchema.parse(input),
		schema: organizationInvitationAcceptedSchema,
	});
}

export async function cancelOrganizationInvitation(
	input: z.infer<typeof organizationInvitationIdActionSchema>
) {
	await requestAuthBusiness({
		path: "/v1/organizations/cancel-invitation",
		method: "POST",
		body: organizationInvitationIdActionSchema.parse(input),
		schema: organizationActionSuccessSchema,
	});
}

export async function updateOrganizationMemberRole(
	input: z.infer<typeof organizationMemberRoleActionSchema>
) {
	await requestAuthBusiness({
		path: "/v1/organizations/update-member-role",
		method: "POST",
		body: organizationMemberRoleActionSchema.parse(input),
		schema: organizationActionSuccessSchema,
	});
}

export async function removeOrganizationMember(
	input: z.infer<typeof organizationMemberRemovalActionSchema>
) {
	await requestAuthBusiness({
		path: "/v1/organizations/remove-member",
		method: "POST",
		body: organizationMemberRemovalActionSchema.parse(input),
		schema: organizationActionSuccessSchema,
	});
}

export async function listOrganizationInvitations(input: {
	organizationId: string;
}) {
	return await requestAuthBusiness({
		path: `/v1/organizations/list-invitations?${new URLSearchParams(input)}`,
		method: "GET",
		schema: organizationInvitationsResponseSchema,
	});
}
export async function listCurrentUserOrganizationInvitations() {
	return await requestAuthBusiness({
		path: "/v1/organizations/list-user-invitations",
		method: "GET",
		schema: userOrganizationInvitationsResponseSchema,
	});
}
export async function previewOrganizationJoinLink(
	input: PreviewOrganizationJoinLinkQuery
) {
	return await requestAuthBusiness({
		path: `/v1/organization-join-link/preview?${new URLSearchParams({ token: input.token, responseVersion: "3" })}`,
		method: "GET",
		schema: previewOrganizationJoinLinkResponseSchema,
	});
}
export async function acceptOrganizationJoinLink(
	input: AcceptOrganizationJoinLinkBody
) {
	return await requestAuthBusiness({
		path: "/v1/organization-join-link/accept",
		method: "POST",
		body: input,
		schema: acceptOrganizationJoinLinkResponseSchema,
	});
}
function linkQuery(input: OrganizationJoinLinkManagementQuery) {
	const query = new URLSearchParams({
		organizationId: input.organizationId,
		responseVersion: "3",
	});
	if (input.mode) {
		query.set("mode", input.mode);
	}
	if (input.spaceId) {
		query.set("spaceId", input.spaceId);
	}
	return query;
}
export async function getOrganizationJoinLink(
	input: OrganizationJoinLinkManagementQuery
) {
	return (
		await requestAuthBusiness({
			path: `/v1/organization-join-link?${linkQuery(input)}`,
			method: "GET",
			schema: getOrganizationJoinLinkResponseSchema,
		})
	).joinLink;
}
export async function resetOrganizationJoinLink(
	input: OrganizationJoinLinkManagementQuery
) {
	const result = await requestAuthBusiness({
		path: `/v1/organization-join-link?${linkQuery(input)}`,
		method: "POST",
		schema: getOrganizationJoinLinkResponseSchema,
	});
	if (!result.joinLink) {
		throw new Error("Generated organization invite link response is empty.");
	}
	return result.joinLink;
}
export async function revokeOrganizationJoinLink(
	input: OrganizationJoinLinkManagementQuery
) {
	return (
		await requestAuthBusiness({
			path: `/v1/organization-join-link?${linkQuery(input)}`,
			method: "DELETE",
			schema: revokeOrganizationJoinLinkResponseSchema,
		})
	).revoked;
}
export async function ensureOrganizationJoinLink(
	input: OrganizationJoinLinkManagementQuery
) {
	const result = await requestAuthBusiness({
		path: "/v1/organization-join-link/ensure",
		method: "POST",
		body: { ...input, responseVersion: "3" },
		schema: getOrganizationJoinLinkResponseSchema,
	});
	if (!result.joinLink) {
		throw new Error("No invitation link was returned. Try again.");
	}
	return result.joinLink;
}
export async function prepareOrganizationJoinLink(
	input: OrganizationJoinLinkManagementQuery
) {
	return (
		await requestAuthBusiness({
			path: "/v1/organization-join-link/prepare",
			method: "POST",
			body: { ...input, responseVersion: "3" },
			schema: getOrganizationJoinLinkResponseSchema,
		})
	).joinLink;
}
