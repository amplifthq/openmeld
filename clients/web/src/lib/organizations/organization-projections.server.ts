import {
	createdOrganizationResponseSchema,
	type OrganizationInvitationView as OrganizationInvitation,
	type OrganizationSummary,
	type UserOrganizationInvitationView as UserOrganizationInvitation,
} from "@openmeld/schemas";

type AcceptedOrganizationInvitation = { organizationId: string };
export function normalizeCreatedOrganization(
	input: unknown
): OrganizationSummary {
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

export function normalizeAcceptedInvitation(
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

export function normalizeOrganizationInvitations(
	input: unknown
): OrganizationInvitation[] {
	const invitations = resolveInvitationArray(input);
	return invitations.map(normalizeOrganizationInvitation);
}

export function normalizeUserOrganizationInvitations(
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
