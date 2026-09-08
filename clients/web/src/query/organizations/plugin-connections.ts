import { connectorServiceSchema } from "@openmeld/schemas";
import type {
	ConnectorAppCatalogResponse,
	ConnectorAppRequestListResponse,
	ConnectorConnectionListResponse,
	ConnectorService,
} from "@openmeld/schemas/types";
import {
	type QueryClient,
	queryOptions,
	skipToken,
} from "@tanstack/react-query";
import { z } from "zod/v4";
import {
	listCurrentOrganizationAppConnections,
	listCurrentOrganizationConnectorAppCatalog,
	listCurrentOrganizationConnectorAppRequests,
	listCurrentOrganizationConnectorConnections,
} from "#/lib/organizations/connector-connections";
import {
	baseQueryOptions,
	PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
	ROUTE_REVISIT_GC_TIME_MS,
} from "#/query/query-config";

export const organizationPluginConnectionQueryKeys = {
	all: ["connector-connections"] as const,
	organization: (organizationId: string) =>
		[...organizationPluginConnectionQueryKeys.all, organizationId] as const,
	catalog: (organizationId: string) =>
		[
			...organizationPluginConnectionQueryKeys.organization(organizationId),
			"catalog",
		] as const,
	providers: (organizationId: string) =>
		[
			...organizationPluginConnectionQueryKeys.organization(organizationId),
			"providers",
		] as const,
	requests: (organizationId: string) =>
		[
			...organizationPluginConnectionQueryKeys.organization(organizationId),
			"requests",
		] as const,
	statusSummary: (organizationId: string) =>
		[
			...organizationPluginConnectionQueryKeys.organization(organizationId),
			"status-summary",
		] as const,
	service: (organizationId: string, service: ConnectorService) =>
		[
			...organizationPluginConnectionQueryKeys.organization(organizationId),
			service,
		] as const,
};

export function organizationPluginProviderCatalogQueryOptions(input: {
	organizationId: string;
}) {
	return queryOptions<ConnectorAppCatalogResponse>({
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async ({ signal }) =>
			await listCurrentOrganizationConnectorAppCatalog({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: organizationPluginConnectionQueryKeys.providers(
			input.organizationId
		),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 5 * 60_000,
	});
}

export function organizationPluginRequestsQueryOptions(input: {
	organizationId: string;
}) {
	return queryOptions<ConnectorAppRequestListResponse>({
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async ({ signal }) =>
			await listCurrentOrganizationConnectorAppRequests({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: organizationPluginConnectionQueryKeys.requests(
			input.organizationId
		),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 30_000,
	});
}

export const organizationPluginConnectionStatusSummarySchema = z.strictObject({
	connectedServices: z.array(connectorServiceSchema),
	organizationId: z.string().trim().min(1),
});

export type OrganizationPluginConnectionStatusSummary = z.infer<
	typeof organizationPluginConnectionStatusSummarySchema
>;

export function organizationPluginConnectionCatalogQueryOptions(input: {
	organizationId: string;
	queryClient: QueryClient;
}) {
	return queryOptions({
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async ({ signal }) => {
			const response = await listCurrentOrganizationAppConnections({
				organizationId: input.organizationId,
				signal,
			});
			writeOrganizationAppConnectionStatusSummary({
				organizationId: input.organizationId,
				queryClient: input.queryClient,
				response,
			});
			return response;
		},
		queryKey: organizationPluginConnectionQueryKeys.catalog(
			input.organizationId
		),
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: baseQueryOptions.staleTime,
	});
}

export function organizationPluginConnectionStatusSummaryQueryOptions(input: {
	organizationId: string;
}) {
	return queryOptions<OrganizationPluginConnectionStatusSummary>({
		gcTime: PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
		queryFn: skipToken,
		queryKey: organizationPluginConnectionQueryKeys.statusSummary(
			input.organizationId
		),
		select: (data) =>
			organizationPluginConnectionStatusSummarySchema.parse(data),
		staleTime: Number.POSITIVE_INFINITY,
	});
}

export function organizationPluginServiceConnectionsQueryOptions(input: {
	organizationId: string;
	queryClient: QueryClient;
	refetchInterval?: false | number;
	service: ConnectorService;
}) {
	const catalogQueryKey = organizationPluginConnectionQueryKeys.catalog(
		input.organizationId
	);
	return queryOptions({
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		initialData: () => {
			const catalog =
				input.queryClient.getQueryData<ConnectorConnectionListResponse>(
					catalogQueryKey
				);
			if (!catalog) {
				return undefined;
			}
			return {
				...catalog,
				connections: catalog.connections.filter(
					(connection) => connection.service === input.service
				),
			};
		},
		initialDataUpdatedAt: () =>
			input.queryClient.getQueryState(catalogQueryKey)?.dataUpdatedAt,
		queryFn: async ({ signal }) => {
			const response = await listCurrentOrganizationConnectorConnections({
				organizationId: input.organizationId,
				service: input.service,
				signal,
			});
			mergeOrganizationPluginServiceConnectionsIntoCatalog({
				organizationId: input.organizationId,
				queryClient: input.queryClient,
				response,
				service: input.service,
			});
			return response;
		},
		queryKey: organizationPluginConnectionQueryKeys.service(
			input.organizationId,
			input.service
		),
		refetchInterval: input.refetchInterval ?? false,
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: baseQueryOptions.staleTime,
	});
}

export function mergeOrganizationPluginServiceConnectionsIntoCatalog(input: {
	organizationId: string;
	queryClient: QueryClient;
	response: ConnectorConnectionListResponse;
	service: ConnectorService;
}): void {
	input.queryClient.setQueryData<ConnectorConnectionListResponse>(
		organizationPluginConnectionQueryKeys.catalog(input.organizationId),
		(current) => {
			if (!current) {
				return current;
			}
			return {
				...current,
				connections: [
					...current.connections.filter(
						(connection) => connection.service !== input.service
					),
					...input.response.connections,
				],
				currentUserId: input.response.currentUserId,
			};
		}
	);
	input.queryClient.setQueryData<OrganizationPluginConnectionStatusSummary>(
		organizationPluginConnectionQueryKeys.statusSummary(input.organizationId),
		(current) => {
			if (!current) {
				return current;
			}
			const connectedServices = new Set(current.connectedServices);
			if (
				input.response.connections.some(
					(connection) => connection.status === "active"
				)
			) {
				connectedServices.add(input.service);
			} else {
				connectedServices.delete(input.service);
			}
			return {
				...current,
				connectedServices: [...connectedServices].sort(),
			};
		}
	);
}

function writeOrganizationAppConnectionStatusSummary(input: {
	organizationId: string;
	queryClient: QueryClient;
	response: ConnectorConnectionListResponse;
}): void {
	const connectedServices = new Set<ConnectorService>();
	for (const connection of input.response.connections) {
		if (connection.status === "active") {
			connectedServices.add(connection.service);
		}
	}
	input.queryClient.setQueryData<OrganizationPluginConnectionStatusSummary>(
		organizationPluginConnectionQueryKeys.statusSummary(input.organizationId),
		{
			connectedServices: [...connectedServices].sort(),
			organizationId: input.organizationId,
		}
	);
}

export async function invalidateOrganizationPluginConnections(input: {
	organizationId: string;
	queryClient: QueryClient;
	service: ConnectorService;
}): Promise<void> {
	await Promise.all([
		input.queryClient.invalidateQueries({
			queryKey: organizationPluginConnectionQueryKeys.catalog(
				input.organizationId
			),
		}),
		input.queryClient.invalidateQueries({
			queryKey: organizationPluginConnectionQueryKeys.service(
				input.organizationId,
				input.service
			),
		}),
	]);
}
