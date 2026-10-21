import type { AccountOrganizationContext } from "@openmeld/schemas";
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod/v4";
import { getRequiredServerEnv } from "#/env";
import { fetchSessionFromGateway } from "#/lib/auth-session.server";
import { readCurrentAccountOrganizationContext } from "./account-organization-context";
import { fetchAuthOrganizations } from "./auth-organizations.server";
import {
	buildOrganizationDefaultPath,
	buildOrganizationPeoplePath,
	buildOrganizationPluginsPath,
	buildOrganizationSpacePath,
} from "./organization-routes";
import type {
	OrganizationScopeResolution,
	OrganizationSummary,
} from "./organization-types";

type OrganizationSessionLike = {
	session: Record<string, unknown>;
	user: {
		email?: string;
		id?: string;
		image?: string | null;
		lastSelectedOrganizationId?: string | null;
		name?: string;
	};
};

const ORGANIZATION_APP_DETAIL_PATH_PATTERN =
	/^\/o\/([^/]+)\/(?:center-agent\/)?plugins\/[^/]+$/u;

/**
 * Where login returns to: the signed-out deep link itself, search included
 * (for example an Agent's memberAgentId). Plugin details return to the
 * Plugins page, so provider names stay out of the public login URL.
 */
export function resolvePublicLoginRedirectTarget(
	routeFamily: string,
	search = ""
): string {
	const match = ORGANIZATION_APP_DETAIL_PATH_PATTERN.exec(routeFamily);
	if (match?.[1]) {
		return buildOrganizationPluginsPath(match[1]);
	}
	const query =
		search.length === 0 || search.startsWith("?") ? search : `?${search}`;
	return `${routeFamily}${query}`;
}

function readActiveOrganizationId(session: {
	session: Record<string, unknown>;
}): string | null {
	const value = session.session.activeOrganizationId;
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: null;
}

function readLastSelectedOrganizationId(session: {
	user: { lastSelectedOrganizationId?: string | null };
}): string | null {
	const value = session.user.lastSelectedOrganizationId;
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: null;
}

function findOrganizationBySlug(
	organizations: readonly OrganizationSummary[],
	orgSlug: string
): OrganizationSummary | null {
	return (
		organizations.find((organization) => organization.slug === orgSlug) ?? null
	);
}

function findOrganizationById(
	organizations: readonly OrganizationSummary[],
	organizationId: string | null
): OrganizationSummary | null {
	if (!organizationId) {
		return null;
	}
	return (
		organizations.find((organization) => organization.id === organizationId) ??
		null
	);
}

export function resolveDefaultOrganizationForSession(input: {
	organizations: readonly OrganizationSummary[];
	session: OrganizationSessionLike;
}): OrganizationSummary | null {
	return (
		findOrganizationById(
			input.organizations,
			readLastSelectedOrganizationId(input.session)
		) ??
		findOrganizationById(
			input.organizations,
			readActiveOrganizationId(input.session)
		) ??
		input.organizations[0] ??
		null
	);
}

export function resolveOrganizationScopeForContext(input: {
	context: AccountOrganizationContext;
	orgSlug: string;
}): OrganizationScopeResolution {
	const { account, currentUserId, organizations, defaultOrganizationId } =
		input.context;
	const common = {
		account,
		currentUserId,
		organizations,
		activeOrganization: findOrganizationById(
			organizations,
			defaultOrganizationId
		),
		storageScope: currentUserId,
	};
	const currentOrganization = findOrganizationBySlug(
		organizations,
		input.orgSlug
	);
	return currentOrganization
		? { ...common, access: "authorized", currentOrganization }
		: { ...common, access: "denied" };
}

export const resolveActiveOrganizationEntryPath = createServerFn({
	method: "GET",
})
	.validator((input: unknown) =>
		z
			.strictObject({
				routeFamily: z.string().trim().min(1),
			})
			.parse(input)
	)
	.handler(async ({ data }): Promise<string> => {
		const entryPath = await resolveActiveOrganizationEntryPathForRequest({
			currentUserSessionExpectation: "required",
			routeFamily: data.routeFamily,
		});
		if (!entryPath) {
			throw redirect({ to: "/login" });
		}
		return entryPath;
	});

export class NoAvailableOrganizationError extends Error {
	constructor() {
		super("No organization is available for this account.");
		this.name = "NoAvailableOrganizationError";
	}
}

export async function resolveOptionalActiveOrganizationEntryPath(input: {
	data: { routeFamily: string };
}): Promise<string | null> {
	z.strictObject({ routeFamily: z.string().trim().min(1) }).parse(input.data);
	const context = await readCurrentAccountOrganizationContext(
		input.data.routeFamily
	);
	if (!context) {
		return null;
	}
	const organization = findOrganizationById(
		context.organizations,
		context.defaultOrganizationId
	);
	if (!organization) {
		throw new NoAvailableOrganizationError();
	}
	return buildOrganizationDefaultPath(organization.slug);
}

async function resolveActiveOrganizationEntryPathForRequest(input: {
	currentUserSessionExpectation: "optional" | "required";
	routeFamily: string;
}): Promise<string | null> {
	const activeOrganization = await resolveActiveOrganizationForRequest(input);
	return activeOrganization
		? buildOrganizationDefaultPath(activeOrganization.slug)
		: null;
}

export const resolveOptionalActiveOrganizationSlug = createServerFn({
	method: "GET",
})
	.validator((input: unknown) =>
		z
			.strictObject({
				routeFamily: z.string().trim().min(1),
			})
			.parse(input)
	)
	.handler(async ({ data }): Promise<string | null> => {
		const activeOrganization = await resolveActiveOrganizationForRequest({
			currentUserSessionExpectation: "optional",
			routeFamily: data.routeFamily,
		});
		return activeOrganization?.slug ?? null;
	});

async function resolveActiveOrganizationForRequest(input: {
	currentUserSessionExpectation: "optional" | "required";
	routeFamily: string;
}): Promise<OrganizationSummary | null> {
	const betterAuthUrl = getRequiredServerEnv("BETTER_AUTH_URL");
	const requestHeaders = getRequestHeaders();
	const session = await fetchSessionFromGateway({
		betterAuthUrl,
		currentUserSessionExpectation: input.currentUserSessionExpectation,
		requestHeaders,
		routeFamily: input.routeFamily,
		sessionCacheMode: "bypass",
	});
	if (!session) {
		return null;
	}

	const organizations = await fetchAuthOrganizations({
		betterAuthUrl,
		requestHeaders,
	});
	const activeOrganization = resolveDefaultOrganizationForSession({
		organizations,
		session,
	});
	if (!activeOrganization) {
		throw new Error("No organization is available for this account.");
	}

	return activeOrganization;
}

export const resolveActiveOrganizationSpacePath = createServerFn({
	method: "GET",
})
	.validator((input: unknown) =>
		z
			.strictObject({
				profileId: z.string().trim().min(1).optional(),
				routeFamily: z.string().trim().min(1),
				spaceId: z.string().trim().min(1),
			})
			.parse(input)
	)
	.handler(async ({ data }): Promise<string> => {
		const session = await fetchSessionFromGateway({
			betterAuthUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
			currentUserSessionExpectation: "required",
			routeFamily: data.routeFamily,
		});

		if (!session) {
			throw redirect({ to: "/login" });
		}

		const organizations = await fetchAuthOrganizations({
			betterAuthUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
		});
		const activeOrganization = resolveDefaultOrganizationForSession({
			organizations,
			session,
		});
		if (!activeOrganization) {
			throw new Error("No organization is available for this account.");
		}

		return buildOrganizationSpacePath({
			orgSlug: activeOrganization.slug,
			search: { profileId: data.profileId },
			spaceId: data.spaceId,
		});
	});

export const resolveActiveOrganizationHumanProfilesPath = createServerFn({
	method: "GET",
})
	.validator((input: unknown) =>
		z
			.strictObject({
				routeFamily: z.string().trim().min(1),
			})
			.parse(input)
	)
	.handler(async ({ data }): Promise<string> => {
		const session = await fetchSessionFromGateway({
			betterAuthUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
			currentUserSessionExpectation: "required",
			routeFamily: data.routeFamily,
		});

		if (!session) {
			throw redirect({ to: "/login" });
		}

		const organizations = await fetchAuthOrganizations({
			betterAuthUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
		});
		const activeOrganization = resolveDefaultOrganizationForSession({
			organizations,
			session,
		});
		if (!activeOrganization) {
			throw new Error("No organization is available for this account.");
		}

		return buildOrganizationPeoplePath(activeOrganization.slug);
	});
