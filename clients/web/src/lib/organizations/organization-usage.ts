import {
	createOrganizationUsageApi,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	AiUsageQuery,
	OrganizationUsageOverviewResponse,
} from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type OrganizationUsageFailure = StructuredApiClientFailure;

export async function readOrganizationAiUsage(input: {
	organizationId: string;
	query: AiUsageQuery;
	signal?: AbortSignal;
}) {
	try {
		return await createOrganizationUsageApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).query({ query: input.query, signal: input.signal });
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function readCurrentOrganizationUsageOverview(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<OrganizationUsageOverviewResponse> {
	try {
		return await createOrganizationUsageApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).readOverview({ signal: input.signal });
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
