import {
	createFetchTransport,
	createOpenMeldApiClient,
	type OpenMeldApiClientFoundation,
} from "@openmeld/api-client";
import {
	buildOpenMeldRequestContextHeaders,
	OPENMELD_HEADER_ACTIVE_ORGANIZATION_ID,
	OPENMELD_HEADER_PROFILE_ID,
	OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID,
	OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG,
} from "@openmeld/gateway-contract";

type CreateWebOpenMeldApiFoundationInput = {
	openMeldProfileId?: string;
	organizationId?: string;
	organizationSlug?: string;
	baseUrl?: string;
	defaultTimeoutMs?: number;
	fetchImpl?: typeof fetch;
};

export function resolveWebOpenMeldApiBaseUrl(): string {
	if (typeof window === "undefined") {
		throw new Error("Web OpenMeld API base URL requires a browser origin");
	}
	return window.location.origin;
}

export function createCredentialedOpenMeldFetch(
	fetchImpl: typeof fetch = fetch,
	input: {
		openMeldProfileId?: string;
		organizationId?: string;
		organizationSlug?: string;
	} = {}
): typeof fetch {
	return async (resource, init) => {
		const headers = new Headers(init?.headers);
		if (
			input.openMeldProfileId &&
			headers.get(OPENMELD_HEADER_PROFILE_ID) === null
		) {
			headers.set(OPENMELD_HEADER_PROFILE_ID, input.openMeldProfileId);
		}
		const requestContextOrganizationId = normalizeOptionalText(
			headers.get(OPENMELD_HEADER_ACTIVE_ORGANIZATION_ID)
		);
		headers.delete(OPENMELD_HEADER_ACTIVE_ORGANIZATION_ID);

		const requestedOrganizationId =
			normalizeOptionalText(input.organizationId) ??
			requestContextOrganizationId;
		const requestedOrganizationSlug = normalizeOptionalText(
			input.organizationSlug
		);
		headers.delete(OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID);
		headers.delete(OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG);
		if (requestedOrganizationId) {
			headers.set(
				OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID,
				requestedOrganizationId
			);
		} else if (requestedOrganizationSlug) {
			headers.set(
				OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG,
				requestedOrganizationSlug
			);
		}

		return await fetchImpl(resource, {
			...init,
			headers,
			credentials: "include",
		});
	};
}

export function createWebOpenMeldApiFoundation(
	input: CreateWebOpenMeldApiFoundationInput = {}
): OpenMeldApiClientFoundation {
	return createOpenMeldApiClient({
		baseUrl: input.baseUrl ?? resolveWebOpenMeldApiBaseUrl(),
		transport: createFetchTransport({
			fetch: createCredentialedOpenMeldFetch(input.fetchImpl, {
				organizationId: input.organizationId,
				organizationSlug: input.organizationSlug,
				openMeldProfileId: input.openMeldProfileId,
			}),
			...(input.defaultTimeoutMs === undefined
				? {}
				: { defaultTimeoutMs: input.defaultTimeoutMs }),
		}),
		getRequestContextHeaders: async ({ requestContext, spacePassword }) =>
			buildOpenMeldRequestContextHeaders({
				requestContext,
				...(spacePassword === undefined ? {} : { spacePassword }),
			}),
	});
}

function normalizeOptionalText(value: unknown): string | null {
	const normalized = String(value ?? "").trim();
	return normalized.length > 0 ? normalized : null;
}
