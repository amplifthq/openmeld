import { organizationDashboardResponseSchema } from "@openmeld/schemas";
import type { OrganizationDashboardMutation } from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

const DASHBOARD_PATH = "/v1/organizations/current/dashboards";
type WithoutOrganization<T> = T extends { organizationId: string }
	? Omit<T, "organizationId">
	: never;
export type DashboardChange =
	WithoutOrganization<OrganizationDashboardMutation>;

export async function listCurrentDashboards(input: {
	organizationId: string;
	id?: string;
	signal?: AbortSignal;
}) {
	const query = new URLSearchParams({ organizationId: input.organizationId });
	if (input.id) {
		query.set("id", input.id);
	}
	const response = await createOrganizationScopedWebOpenMeldApiFoundation(
		input
	).requestJson({
		invalidMessage: "Invalid Dashboard response.",
		method: "GET",
		operation: "dashboard.list",
		schema: organizationDashboardResponseSchema,
		signal: input.signal,
		url: `${DASHBOARD_PATH}?${query}`,
	});
	if (response.organizationId !== input.organizationId) {
		throw new Error("Dashboard response workspace mismatch.");
	}
	return response;
}

export async function mutateCurrentDashboards(input: {
	organizationId: string;
	mutation: DashboardChange;
}) {
	const response = await createOrganizationScopedWebOpenMeldApiFoundation(
		input
	).requestJson({
		body: JSON.stringify({
			...input.mutation,
			organizationId: input.organizationId,
		}),
		invalidMessage: "Invalid Dashboard response.",
		method: "POST",
		operation: "dashboard.mutate",
		schema: organizationDashboardResponseSchema,
		url: DASHBOARD_PATH,
	});
	if (response.organizationId !== input.organizationId) {
		throw new Error("Dashboard mutation workspace mismatch.");
	}
	return response;
}
