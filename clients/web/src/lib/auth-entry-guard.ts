import { redirect } from "@tanstack/react-router";
import { getRequiredServerEnv } from "#/env";
import { resolveAuthenticatedEntryTarget } from "./auth-entry-policy";
import { hasAddAccountAuthIntent } from "./auth-intent";
import { getSession } from "./auth-session";
import { resolveActiveOrganizationEntryPath } from "./organizations/organization-scope";

const INTERNAL_URL_BASE = "https://openmeld.ai";

function getBrowserOrigin(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	return window.location.origin;
}

function resolveTrustedRedirectOrigins(parsedLocation: URL): readonly string[] {
	const trustedOrigins = [parsedLocation.origin];
	const browserOrigin = getBrowserOrigin();
	if (browserOrigin) {
		trustedOrigins.push(browserOrigin);
		return trustedOrigins;
	}

	trustedOrigins.push(getRequiredServerEnv("WEB_APP_URL"));
	return trustedOrigins;
}

export function resolveAuthenticatedRedirectTarget(
	locationHref: string
): string {
	const parsedLocation = new URL(locationHref, INTERNAL_URL_BASE);
	return resolveAuthenticatedEntryTarget({
		requestedRedirect: parsedLocation.searchParams.get("redirect"),
		trustedOrigins: resolveTrustedRedirectOrigins(parsedLocation),
	});
}

export async function guardAnonymousOnlyRoute(
	locationHref: string
): Promise<void> {
	const parsedLocation = new URL(locationHref, INTERNAL_URL_BASE);
	const session = await getSession({
		data: {
			currentUserSessionExpectation: "optional",
			routeFamily: parsedLocation.pathname,
			sessionCacheMode: "bypass",
		},
	});
	if (!session) {
		return;
	}
	if (hasAddAccountAuthIntent(locationHref)) {
		return;
	}

	const redirectTarget = resolveAuthenticatedRedirectTarget(locationHref);

	throw redirect({
		to:
			redirectTarget === "/login"
				? await resolveActiveOrganizationEntryPath({
						data: { routeFamily: parsedLocation.pathname },
					})
				: redirectTarget,
	});
}
