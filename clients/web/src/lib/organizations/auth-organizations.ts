import {
	acceptOrganizationJoinLinkResponseSchema,
	createdOrganizationResponseSchema,
	createOrganizationBodySchema,
	getOrganizationJoinLinkResponseSchema,
	previewOrganizationJoinLinkResponseSchema,
	revokeOrganizationJoinLinkResponseSchema,
} from "@openmeld/schemas";
import type {
	AcceptOrganizationJoinLinkBody,
	AcceptOrganizationJoinLinkResponse,
	OrganizationJoinLink,
	OrganizationJoinLinkManagementQuery,
	PreviewOrganizationJoinLinkQuery,
	PreviewOrganizationJoinLinkResponse,
} from "@openmeld/schemas/types";
import { openMeldAuthClient } from "#/lib/auth-client";
import type { AuthClientError } from "#/lib/auth-client-types";
import { requestAuthEndpoint, resolveClientResult } from "#/lib/auth-transport";
import { normalizeOrganizationList } from "./organization-list";
import type { OrganizationSummary } from "./organization-types";

type OrganizationClientApi = {
	acceptInvitation?: (input: { invitationId: string }) => Promise<unknown>;
	cancelInvitation?: (input: { invitationId: string }) => Promise<unknown>;
	delete?: (input: { organizationId: string }) => Promise<unknown>;
	inviteMember?: (input: {
		email: string;
		organizationId: string;
		role: OrganizationInviteRole;
	}) => Promise<unknown>;
	list?: () => Promise<unknown>;
	listUserInvitations?: () => Promise<unknown>;
	removeMember?: (input: {
		memberIdOrEmail: string;
		organizationId?: string;
	}) => Promise<unknown>;
	update?: (input: {
		data: OrganizationUpdateData;
		organizationId?: string;
	}) => Promise<unknown>;
	updateMemberRole?: (input: {
		memberId: string;
		organizationId?: string;
		role: OrganizationInviteRole;
	}) => Promise<unknown>;
};

type AuthClientWithOrganizationApi = typeof openMeldAuthClient & {
	organization?: OrganizationClientApi;
};

export type OrganizationInviteRole = "admin" | "member";

export type AcceptedOrganizationInvitation = {
	organizationId: string;
};

export type OrganizationInvitation = {
	email: string;
	expiresAt: string | null;
	id: string;
	organizationId: string | null;
	role: string | null;
	status: string | null;
};

export type UserOrganizationInvitation = OrganizationInvitation & {
	createdAt: string | null;
	inviterId: string | null;
	organizationId: string;
	organizationName: string;
};

export type OrganizationCreateInput = {
	name: string;
};

export type OrganizationUpdateData = {
	name?: string;
	slug?: string;
};

const authClientWithOrganizationApi =
	openMeldAuthClient as AuthClientWithOrganizationApi;

/**
 * Error thrown by every organization request helper in this module.
 *
 * It preserves the transport-layer error `code` (and `status`) alongside the
 * human message so downstream consumers can branch on the stable Better Auth
 * code via {@link getAuthErrorCode} instead of matching localized message text.
 * Existing consumers that only read `.message` keep working unchanged.
 */
export class OrganizationRequestError extends Error {
	readonly code?: string;
	readonly status?: number;

	constructor(input: { code?: string; message: string; status?: number }) {
		super(input.message);
		this.name = "OrganizationRequestError";
		if (input.code !== undefined) {
			this.code = input.code;
		}
		if (input.status !== undefined) {
			this.status = input.status;
		}
	}
}

function getAuthErrorMessage(error: AuthClientError | null, fallback: string) {
	return error?.message ?? error?.description ?? fallback;
}

function throwAuthError(
	error: AuthClientError | null,
	fallback: string
): never {
	throw new OrganizationRequestError({
		...(error?.code ? { code: error.code } : {}),
		message: getAuthErrorMessage(error, fallback),
		...(typeof error?.status === "number" ? { status: error.status } : {}),
	});
}

export async function listOrganizations(): Promise<OrganizationSummary[]> {
	if (authClientWithOrganizationApi.organization?.list) {
		const response = await resolveClientResult<OrganizationSummary[] | unknown>(
			() => authClientWithOrganizationApi.organization?.list?.(),
			"Failed to fetch organizations."
		);
		if (response.error) {
			throwAuthError(response.error, "Failed to fetch organizations.");
		}
		return normalizeOrganizationList(response.data);
	}

	const response = await requestAuthEndpoint<OrganizationSummary[]>({
		fallbackMessage: "Failed to fetch organizations.",
		path: "/organization/list",
		request: { method: "GET" },
	});
	if (response.error) {
		throwAuthError(response.error, "Failed to fetch organizations.");
	}
	return normalizeOrganizationList(response.data);
}

export async function createOrganization(
	input: OrganizationCreateInput
): Promise<OrganizationSummary> {
	const body = createOrganizationBodySchema.parse(input);
	const response = await requestAuthEndpoint<unknown>({
		fallbackMessage: "Failed to create organization.",
		path: "/organization/create",
		request: {
			body: JSON.stringify(body),
			method: "POST",
		},
	});
	if (response.error) {
		throwAuthError(response.error, "Failed to create organization.");
	}
	return normalizeCreatedOrganization(response.data);
}

export async function inviteOrganizationMember(input: {
	email: string;
	organizationId: string;
	role: OrganizationInviteRole;
}): Promise<void> {
	if (authClientWithOrganizationApi.organization?.inviteMember) {
		const response = await resolveClientResult(
			() => authClientWithOrganizationApi.organization?.inviteMember?.(input),
			"Failed to send invitation."
		);
		if (response.error) {
			throwAuthError(response.error, "Failed to send invitation.");
		}
		return;
	}

	const response = await requestAuthEndpoint({
		fallbackMessage: "Failed to send invitation.",
		path: "/organization/invite-member",
		request: {
			body: JSON.stringify(input),
			method: "POST",
		},
	});
	if (response.error) {
		throwAuthError(response.error, "Failed to send invitation.");
	}
}

export async function acceptOrganizationInvitation(input: {
	invitationId: string;
}): Promise<AcceptedOrganizationInvitation> {
	if (authClientWithOrganizationApi.organization?.acceptInvitation) {
		const response = await resolveClientResult<unknown>(
			() =>
				authClientWithOrganizationApi.organization?.acceptInvitation?.(input),
			"Failed to accept invitation."
		);
		if (response.error) {
			throwAuthError(response.error, "Failed to accept invitation.");
		}
		return normalizeAcceptedInvitation(response.data);
	}

	const response = await requestAuthEndpoint<unknown>({
		fallbackMessage: "Failed to accept invitation.",
		path: "/organization/accept-invitation",
		request: {
			body: JSON.stringify(input),
			method: "POST",
		},
	});
	if (response.error) {
		throwAuthError(response.error, "Failed to accept invitation.");
	}
	return normalizeAcceptedInvitation(response.data);
}

export async function previewOrganizationJoinLink(
	input: PreviewOrganizationJoinLinkQuery
): Promise<PreviewOrganizationJoinLinkResponse> {
	const search = new URLSearchParams({
		token: input.token,
		responseVersion: "2",
	});
	const response = await requestAuthEndpoint<unknown>({
		fallbackMessage: "Failed to check organization invite link.",
		path: `/organization/join-link/preview?${search.toString()}`,
		request: { method: "GET" },
	});
	if (response.error) {
		throwAuthError(response.error, "Failed to check organization invite link.");
	}
	const parsed = previewOrganizationJoinLinkResponseSchema.safeParse(
		response.data
	);
	if (!parsed.success) {
		throw new Error("Organization invite link preview response is invalid.");
	}
	return parsed.data;
}

export async function acceptOrganizationJoinLink(
	input: AcceptOrganizationJoinLinkBody
): Promise<AcceptOrganizationJoinLinkResponse> {
	const response = await requestAuthEndpoint<unknown>({
		fallbackMessage: "Failed to join organization.",
		path: "/organization/join-link/accept",
		request: {
			body: JSON.stringify(input),
			method: "POST",
		},
	});
	if (response.error) {
		throwAuthError(response.error, "Failed to join organization.");
	}
	const parsed = acceptOrganizationJoinLinkResponseSchema.safeParse(
		response.data
	);
	if (!parsed.success) {
		throw new Error("Organization join response is invalid.");
	}
	return parsed.data;
}

export async function getOrganizationJoinLink(
	input: OrganizationJoinLinkManagementQuery
): Promise<OrganizationJoinLink | null> {
	return await requestManagedOrganizationJoinLink({
		fallbackMessage: "Failed to load organization invite link.",
		method: "GET",
		organizationId: input.organizationId,
	});
}

export async function resetOrganizationJoinLink(
	input: OrganizationJoinLinkManagementQuery
): Promise<OrganizationJoinLink> {
	const joinLink = await requestManagedOrganizationJoinLink({
		fallbackMessage: "Failed to generate organization invite link.",
		method: "POST",
		organizationId: input.organizationId,
	});
	if (!joinLink) {
		throw new Error("Generated organization invite link response is empty.");
	}
	return joinLink;
}

export async function revokeOrganizationJoinLink(
	input: OrganizationJoinLinkManagementQuery
): Promise<boolean> {
	const search = new URLSearchParams({
		organizationId: input.organizationId,
	});
	const response = await requestAuthEndpoint<unknown>({
		fallbackMessage: "Failed to revoke organization invite link.",
		path: `/organization/join-link?${search.toString()}`,
		request: { method: "DELETE" },
	});
	if (response.error) {
		throwAuthError(
			response.error,
			"Failed to revoke organization invite link."
		);
	}
	const parsed = revokeOrganizationJoinLinkResponseSchema.safeParse(
		response.data
	);
	if (!parsed.success) {
		throw new Error("Organization invite link revoke response is invalid.");
	}
	return parsed.data.revoked;
}

async function requestManagedOrganizationJoinLink(input: {
	fallbackMessage: string;
	method: "GET" | "POST";
	organizationId: string;
}): Promise<OrganizationJoinLink | null> {
	const search = new URLSearchParams({ organizationId: input.organizationId });
	const response = await requestAuthEndpoint<unknown>({
		fallbackMessage: input.fallbackMessage,
		path: `/organization/join-link?${search.toString()}`,
		request: { method: input.method },
	});
	if (response.error) {
		throwAuthError(response.error, input.fallbackMessage);
	}
	const parsed = getOrganizationJoinLinkResponseSchema.safeParse(response.data);
	if (!parsed.success) {
		throw new Error("Organization invite link response is invalid.");
	}
	return parsed.data.joinLink;
}

export async function updateOrganization(input: {
	data: OrganizationUpdateData;
	organizationId: string;
}): Promise<void> {
	if (authClientWithOrganizationApi.organization?.update) {
		const response = await resolveClientResult(
			() => authClientWithOrganizationApi.organization?.update?.(input),
			"Failed to update organization."
		);
		if (response.error) {
			throwAuthError(response.error, "Failed to update organization.");
		}
		return;
	}

	const response = await requestAuthEndpoint({
		fallbackMessage: "Failed to update organization.",
		path: "/organization/update",
		request: {
			body: JSON.stringify(input),
			method: "POST",
		},
	});
	if (response.error) {
		throwAuthError(response.error, "Failed to update organization.");
	}
}

export async function deleteOrganization(input: {
	organizationId: string;
}): Promise<void> {
	if (authClientWithOrganizationApi.organization?.delete) {
		const response = await resolveClientResult(
			() => authClientWithOrganizationApi.organization?.delete?.(input),
			"Failed to delete organization."
		);
		if (response.error) {
			throwAuthError(response.error, "Failed to delete organization.");
		}
		return;
	}

	const response = await requestAuthEndpoint({
		fallbackMessage: "Failed to delete organization.",
		path: "/organization/delete",
		request: {
			body: JSON.stringify(input),
			method: "POST",
		},
	});
	if (response.error) {
		throwAuthError(response.error, "Failed to delete organization.");
	}
}

export async function updateOrganizationMemberRole(input: {
	memberId: string;
	organizationId: string;
	role: OrganizationInviteRole;
}): Promise<void> {
	if (authClientWithOrganizationApi.organization?.updateMemberRole) {
		const response = await resolveClientResult(
			() =>
				authClientWithOrganizationApi.organization?.updateMemberRole?.(input),
			"Failed to update member role."
		);
		if (response.error) {
			throwAuthError(response.error, "Failed to update member role.");
		}
		return;
	}

	const response = await requestAuthEndpoint({
		fallbackMessage: "Failed to update member role.",
		path: "/organization/update-member-role",
		request: {
			body: JSON.stringify(input),
			method: "POST",
		},
	});
	if (response.error) {
		throwAuthError(response.error, "Failed to update member role.");
	}
}

export async function removeOrganizationMember(input: {
	memberIdOrEmail: string;
	organizationId: string;
}): Promise<void> {
	if (authClientWithOrganizationApi.organization?.removeMember) {
		const response = await resolveClientResult(
			() => authClientWithOrganizationApi.organization?.removeMember?.(input),
			"Failed to remove organization member."
		);
		if (response.error) {
			throwAuthError(response.error, "Failed to remove organization member.");
		}
		return;
	}

	const response = await requestAuthEndpoint({
		fallbackMessage: "Failed to remove organization member.",
		path: "/organization/remove-member",
		request: {
			body: JSON.stringify(input),
			method: "POST",
		},
	});
	if (response.error) {
		throwAuthError(response.error, "Failed to remove organization member.");
	}
}

export async function listOrganizationInvitations(input: {
	organizationId: string;
}): Promise<OrganizationInvitation[]> {
	const search = new URLSearchParams({ organizationId: input.organizationId });
	const response = await requestAuthEndpoint<unknown>({
		fallbackMessage: "Failed to fetch invitations.",
		path: `/organization/list-invitations?${search.toString()}`,
		request: { method: "GET" },
	});
	if (response.error) {
		throwAuthError(response.error, "Failed to fetch invitations.");
	}
	return normalizeOrganizationInvitations(response.data);
}

export async function listCurrentUserOrganizationInvitations(): Promise<
	UserOrganizationInvitation[]
> {
	if (authClientWithOrganizationApi.organization?.listUserInvitations) {
		const response = await resolveClientResult<unknown>(
			() => authClientWithOrganizationApi.organization?.listUserInvitations?.(),
			"Failed to fetch your organization invitations."
		);
		if (response.error) {
			throwAuthError(
				response.error,
				"Failed to fetch your organization invitations."
			);
		}
		return normalizeUserOrganizationInvitations(response.data);
	}

	const response = await requestAuthEndpoint<unknown>({
		fallbackMessage: "Failed to fetch your organization invitations.",
		path: "/organization/list-user-invitations",
		request: { method: "GET" },
	});
	if (response.error) {
		throwAuthError(
			response.error,
			"Failed to fetch your organization invitations."
		);
	}
	return normalizeUserOrganizationInvitations(response.data);
}

export async function cancelOrganizationInvitation(input: {
	invitationId: string;
}): Promise<void> {
	if (authClientWithOrganizationApi.organization?.cancelInvitation) {
		const response = await resolveClientResult(
			() =>
				authClientWithOrganizationApi.organization?.cancelInvitation?.(input),
			"Failed to cancel invitation."
		);
		if (response.error) {
			throwAuthError(response.error, "Failed to cancel invitation.");
		}
		return;
	}

	const response = await requestAuthEndpoint({
		fallbackMessage: "Failed to cancel invitation.",
		path: "/organization/cancel-invitation",
		request: {
			body: JSON.stringify(input),
			method: "POST",
		},
	});
	if (response.error) {
		throwAuthError(response.error, "Failed to cancel invitation.");
	}
}

function normalizeCreatedOrganization(input: unknown): OrganizationSummary {
	if (!input || typeof input !== "object") {
		throw new Error("Created organization response is invalid.");
	}
	const record = resolveCreatedOrganizationRecord(input);
	const parsed = createdOrganizationResponseSchema.safeParse(record);
	if (!parsed.success) {
		throw new Error("Created organization response is invalid.");
	}
	return {
		id: parsed.data.id,
		isPersonal: false,
		logo: parsed.data.logo ?? null,
		name: parsed.data.name,
		slug: parsed.data.slug,
	};
}

function resolveCreatedOrganizationRecord(
	input: unknown
): Record<string, unknown> {
	const record = input as Record<string, unknown>;
	if (record.organization && typeof record.organization === "object") {
		return record.organization as Record<string, unknown>;
	}
	return record;
}

function normalizeAcceptedInvitation(
	input: unknown
): AcceptedOrganizationInvitation {
	if (!input || typeof input !== "object") {
		throw new Error("Accepted invitation response is invalid.");
	}
	const record = input as Record<string, unknown>;
	const invitation =
		record.invitation && typeof record.invitation === "object"
			? (record.invitation as Record<string, unknown>)
			: null;
	const organizationId = readTrimmedText(invitation?.organizationId);
	if (!organizationId) {
		throw new Error("Accepted invitation response is missing organization id.");
	}
	return {
		organizationId,
	};
}

function normalizeOrganizationInvitations(
	input: unknown
): OrganizationInvitation[] {
	const invitations = resolveInvitationArray(input);
	return invitations.map(normalizeOrganizationInvitation);
}

function normalizeUserOrganizationInvitations(
	input: unknown
): UserOrganizationInvitation[] {
	return resolveInvitationArray(input).map((value) => {
		const invitation = normalizeOrganizationInvitation(value);
		if (!value || typeof value !== "object") {
			throw new Error("User organization invitation response is invalid.");
		}
		const record = value as Record<string, unknown>;
		const organizationId = invitation.organizationId;
		const organizationName = readTrimmedText(record.organizationName);
		if (!(organizationId && organizationName)) {
			throw new Error("User organization invitation response is invalid.");
		}
		return {
			...invitation,
			createdAt: normalizeInvitationDate(record.createdAt),
			inviterId: readTrimmedText(record.inviterId),
			organizationId,
			organizationName,
		};
	});
}

function resolveInvitationArray(input: unknown): unknown[] {
	if (Array.isArray(input)) {
		return input;
	}
	if (!input || typeof input !== "object") {
		throw new Error("Organization invitations response is invalid.");
	}
	const record = input as Record<string, unknown>;
	if (Array.isArray(record.invitations)) {
		return record.invitations;
	}
	throw new Error("Organization invitations response is invalid.");
}

function normalizeOrganizationInvitation(
	input: unknown
): OrganizationInvitation {
	if (!input || typeof input !== "object") {
		throw new Error("Organization invitation response is invalid.");
	}
	const record = input as Record<string, unknown>;
	const id = readTrimmedText(record.id);
	const email = readTrimmedText(record.email);
	if (!(id && email)) {
		throw new Error("Organization invitation response is invalid.");
	}
	return {
		email,
		expiresAt: normalizeInvitationDate(record.expiresAt),
		id,
		organizationId: readTrimmedText(record.organizationId),
		role: readTrimmedText(record.role),
		status: readTrimmedText(record.status),
	};
}

function normalizeInvitationDate(value: unknown): string | null {
	if (value instanceof Date) {
		return value.toISOString();
	}
	return readTrimmedText(value);
}

function readTrimmedText(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}
