import {
	createFetchTransport,
	createOpenMeldApiClient,
	type OpenMeldApiClientConfig,
	type OpenMeldApiClientFoundation,
} from "@openmeld/api-client";
import {
	buildOpenMeldRequestContextHeaders,
	OPENMELD_HEADER_ACTIVE_ORGANIZATION_ID,
	OPENMELD_HEADER_PROFILE_ID,
	OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID,
	OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG,
} from "@openmeld/gateway-contract";
import { openMeldRequestedOrganizationSelectorSchema } from "@openmeld/schemas";
import type { OpenMeldRequestedOrganizationSelector } from "@openmeld/schemas/types";
import { observeSpaceRequest } from "#/lib/observability/space-open";

type CreateWebOpenMeldApiFoundationInput = {
	openMeldProfileId?: string;
	baseUrl?: string;
	defaultTimeoutMs?: number;
	fetchImpl?: typeof fetch;
};

export type WebOrganizationSelector =
	| ({ organizationId: string } & { organizationSlug?: never })
	| ({ organizationId?: never } & { organizationSlug: string });

type CreateOrganizationScopedWebOpenMeldApiFoundationInput =
	CreateWebOpenMeldApiFoundationInput & WebOrganizationSelector;

export function resolveWebOpenMeldApiBaseUrl(): string {
	if (typeof window === "undefined") {
		throw new Error("Web OpenMeld API base URL requires a browser origin");
	}
	return window.location.origin;
}

function createCredentialedOpenMeldFetch(
	fetchImpl: typeof fetch = fetch,
	input: {
		openMeldProfileId?: string;
		organization?: OpenMeldRequestedOrganizationSelector;
	} = {}
): typeof fetch {
	return async (resource, init) => {
		if (import.meta.env.DEV) {
			rejectComputerPreviewRequest(resource, init);
		}
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

		const organization = input.organization;
		let requestedOrganizationId = requestContextOrganizationId;
		let requestedOrganizationSlug: string | null = null;
		if (organization) {
			requestedOrganizationId =
				"organizationId" in organization ? organization.organizationId : null;
			requestedOrganizationSlug =
				"organizationSlug" in organization
					? organization.organizationSlug
					: null;
		}
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

// These browser-memory fixtures never authorize real API calls, including
// setup and Agent creation after navigating away from the preview surface.
function rejectComputerPreviewRequest(
	resource: RequestInfo | URL,
	init?: RequestInit
) {
	const url = resource instanceof Request ? resource.url : String(resource);
	const body = typeof init?.body === "string" ? init.body : "";
	if (`${url} ${body}`.includes("local-computer-preview-")) {
		throw new Error(
			"This computer is a local UI preview. No real computer was changed."
		);
	}
}

export function createOrganizationScopedWebOpenMeldApiFoundation(
	input: CreateOrganizationScopedWebOpenMeldApiFoundationInput
): OpenMeldApiClientFoundation {
	const organization = parseRequestedOrganization(input);
	return createWebOpenMeldApiFoundation(input, organization);
}

export function createUnscopedWebOpenMeldApiFoundation(
	input: CreateWebOpenMeldApiFoundationInput = {}
): OpenMeldApiClientFoundation {
	return createWebOpenMeldApiFoundation(input);
}

function createWebOpenMeldApiFoundation(
	input: CreateWebOpenMeldApiFoundationInput,
	organization?: OpenMeldRequestedOrganizationSelector
): OpenMeldApiClientFoundation {
	const config: OpenMeldApiClientConfig = {
		baseUrl: input.baseUrl ?? resolveWebOpenMeldApiBaseUrl(),
		transport: createFetchTransport({
			fetch: createCredentialedOpenMeldFetch(input.fetchImpl, {
				...(organization === undefined ? {} : { organization }),
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
	};
	const foundation = createOpenMeldApiClient(config);
	return {
		...foundation,
		requestJson: async (request) => {
			const observe = observeSpaceRequest(request.url);
			if (!observe) {
				return await foundation.requestJson(request);
			}
			const observed = createOpenMeldApiClient({
				...config,
				transport: async (transportRequest) => {
					observe("sent");
					const response = await config.transport(transportRequest);
					observe("headers", response);
					return response;
				},
			});
			try {
				const result = await observed.requestJson({
					...request,
					schema: {
						safeParse: (value) => {
							observe("validating");
							return request.schema.safeParse(value);
						},
					},
				});
				observe("complete");
				return result;
			} catch (error) {
				observe("failed");
				throw error;
			}
		},
	};
}

function normalizeOptionalText(value: unknown): string | null {
	const normalized = String(value ?? "").trim();
	return normalized.length > 0 ? normalized : null;
}

function parseRequestedOrganization(
	input: WebOrganizationSelector
): OpenMeldRequestedOrganizationSelector {
	return openMeldRequestedOrganizationSelectorSchema.parse({
		...(input.organizationId === undefined
			? {}
			: { organizationId: input.organizationId }),
		...(input.organizationSlug === undefined
			? {}
			: { organizationSlug: input.organizationSlug }),
	});
}

export function resolveWebOrganizationSelector(input: {
	organizationId?: string | null;
	organizationSlug: string;
}): WebOrganizationSelector {
	const organizationId = normalizeOptionalText(input.organizationId);
	if (organizationId) {
		return { organizationId };
	}
	const organization = openMeldRequestedOrganizationSelectorSchema.parse({
		organizationSlug: input.organizationSlug,
	});
	return "organizationSlug" in organization
		? { organizationSlug: organization.organizationSlug }
		: { organizationId: organization.organizationId };
}
