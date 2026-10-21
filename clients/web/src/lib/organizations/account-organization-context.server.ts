import {
	createFetchTransport,
	createOpenMeldApiClient,
	readAccountOrganizationContext,
} from "@openmeld/api-client";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getRequiredServerEnv } from "#/env";
import { createOrganizationScopeTimingCollector } from "./organization-scope-observability";
import { scheduleOrganizationScopeTimingEvidence } from "./organization-scope-observability.server";

export async function readAccountOrganizationContextFromRequest(
	routeFamily: string,
	options: {
		deferSessionRefresh?: boolean;
		signal?: AbortSignal;
		timeoutMs?: number;
	} = {}
) {
	const requestHeaders = getRequestHeaders();
	const cookie = requestHeaders.get("cookie");
	const timing = createOrganizationScopeTimingCollector();
	let failure: unknown;
	try {
		return await timing.measure("account_organization_context", () =>
			readAccountOrganizationContext(
				createOpenMeldApiClient({
					baseUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
					transport: createFetchTransport({ fetch }),
					getAuthHeaders: async (): Promise<Record<string, string>> =>
						cookie ? { cookie } : {},
				}),
				options
			)
		);
	} catch (error) {
		failure = error;
		throw error;
	} finally {
		try {
			scheduleOrganizationScopeTimingEvidence({
				requestHeaders,
				routeFamily,
				metrics: timing.finish({
					status: failure === undefined ? "succeeded" : "failed",
					reasonCode:
						failure === undefined
							? "total_context_read"
							: "total_context_read_failed",
					...(failure === undefined ? {} : { error: failure }),
				}),
			});
		} catch (error) {
			console.error({
				event: "web.openmeld.organization_scope_timing_emission_failed",
				errorName: error instanceof Error ? error.name : typeof error,
			});
		}
	}
}
