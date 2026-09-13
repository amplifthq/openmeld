import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod/v4";
import { getRequiredServerEnv } from "#/env";
import { fetchSessionFromGateway } from "#/lib/auth-session.server";
import { fetchAuthOrganizations } from "./auth-organizations.server";
import {
	buildOrganizationDefaultPath,
	buildOrganizationPeoplePath,
	buildOrganizationPluginsPath,
	buildOrganizationSpacePath,
} from "./organization-routes";
import {
	createOrganizationScopeTimingCollector,
	normalizeOrganizationScopeRouteFamilyForObservability,
	type OrganizationScopeTimingMetric,
	type OrganizationScopeTimingStage,
} from "./organization-scope-observability";
import { scheduleOrganizationScopeTimingEvidence } from "./organization-scope-observability.server";
import type {
	OrganizationScopeAccount,
	OrganizationScopeResolution,
	OrganizationSummary,
} from "./organization-types";

const organizationScopeInputSchema = z.strictObject({
	orgSlug: z.string().trim().min(1),
	routeFamily: z.string().trim().min(1),
});

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

export function resolvePublicLoginRedirectTarget(routeFamily: string): string {
	const match = ORGANIZATION_APP_DETAIL_PATH_PATTERN.exec(routeFamily);
	return match?.[1] ? buildOrganizationPluginsPath(match[1]) : routeFamily;
}

function readRequiredUserId(session: { user: { id?: string } }): string {
	const userId = session.user.id?.trim();
	if (!userId) {
		throw new Error("Authenticated session is missing user id.");
	}
	return userId;
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

function toAccount(session: {
	user: { email?: string; image?: string | null; name?: string };
}): OrganizationScopeAccount {
	return {
		email: session.user.email ?? null,
		image: session.user.image ?? null,
		name: session.user.name ?? null,
	};
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

export function resolveOrganizationScopeForSession(input: {
	organizations: readonly OrganizationSummary[];
	orgSlug: string;
	session: OrganizationSessionLike;
}): OrganizationScopeResolution {
	const activeOrganization = resolveDefaultOrganizationForSession({
		organizations: input.organizations,
		session: input.session,
	});
	const currentOrganization = findOrganizationBySlug(
		input.organizations,
		input.orgSlug
	);
	const account = toAccount(input.session);
	const currentUserId = readRequiredUserId(input.session);
	const storageScope = currentUserId;

	if (!currentOrganization) {
		return {
			access: "denied",
			account,
			activeOrganization,
			currentUserId,
			organizations: [...input.organizations],
			storageScope,
		};
	}

	return {
		access: "authorized",
		account,
		activeOrganization,
		currentOrganization,
		currentUserId,
		organizations: [...input.organizations],
		storageScope,
	};
}

export const resolveOrganizationScope = createServerFn({ method: "GET" })
	.validator((input: unknown) => organizationScopeInputSchema.parse(input))
	.handler(async ({ data }): Promise<OrganizationScopeResolution> => {
		const requestHeaders = getRequestHeaders();
		const timing = createOrganizationScopeTimingCollector();
		let failure: unknown;
		let failureStage: OrganizationScopeTimingStage | null = null;
		let resolution: OrganizationScopeResolution | null = null;

		try {
			const [sessionResult, organizationsResult] = await Promise.allSettled([
				timing.measure("auth_session", async () =>
					fetchSessionFromGateway({
						betterAuthUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
						currentUserSessionExpectation: "required",
						requestHeaders,
						routeFamily: data.routeFamily,
					})
				),
				timing.measure("organization_list", async () =>
					fetchAuthOrganizations({
						betterAuthUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
						requestHeaders,
					})
				),
			]);
			if (sessionResult.status === "rejected") {
				failureStage = "auth_session";
				throw sessionResult.reason;
			}
			const session = sessionResult.value;

			if (!session) {
				failureStage = "auth_session";
				throw redirect({
					search: {
						redirect: resolvePublicLoginRedirectTarget(data.routeFamily),
					},
					to: "/login",
				});
			}
			if (organizationsResult.status === "rejected") {
				failureStage = "organization_list";
				throw organizationsResult.reason;
			}
			const organizations = organizationsResult.value;
			resolution = timing.measureSync("scope_resolution", () =>
				resolveOrganizationScopeForSession({
					organizations,
					orgSlug: data.orgSlug,
					session,
				})
			);
			return resolution;
		} catch (error) {
			failure = error;
			throw error;
		} finally {
			const metrics = timing.finish({
				...(failure === undefined ? {} : { error: failure }),
				reasonCode: resolveOrganizationScopeTotalReasonCode({
					failure,
					lastStage: failureStage ?? timing.lastStage(),
					resolution,
				}),
				status: failure === undefined ? "succeeded" : "failed",
			});
			emitOrganizationScopeTimingEvidenceBestEffort({
				metrics,
				requestHeaders,
				routeFamily: data.routeFamily,
			});
		}
	});

function resolveOrganizationScopeTotalReasonCode(input: {
	failure: unknown;
	lastStage: OrganizationScopeTimingStage | null;
	resolution: OrganizationScopeResolution | null;
}): string {
	if (input.failure !== undefined) {
		return `total_failed_after_${input.lastStage ?? "start"}`;
	}
	if (input.resolution?.access === "denied") {
		return "total_denied";
	}
	return "total_authorized";
}

function emitOrganizationScopeTimingEvidenceBestEffort(input: {
	metrics: readonly OrganizationScopeTimingMetric[];
	requestHeaders: Headers;
	routeFamily: string;
}): void {
	try {
		scheduleOrganizationScopeTimingEvidence(input);
	} catch (error) {
		console.error({
			event: "web.openmeld.organization_scope_timing_emission_failed",
			errorName: error instanceof Error ? error.name : typeof error,
			routeFamily: normalizeOrganizationScopeRouteFamilyForObservability(
				input.routeFamily
			),
		});
	}
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

export const resolveOptionalActiveOrganizationEntryPath = createServerFn({
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
		return activeOrganization
			? buildOrganizationDefaultPath(activeOrganization.slug)
			: null;
	});

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
