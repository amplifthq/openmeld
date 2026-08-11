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

export const organizationAppConnectionQueryKeys = {
	all: ["connector-connections"] as const,
	organization: (organizationId: string) =>
		[...organizationAppConnectionQueryKeys.all, organizationId] as const,
	catalog: (organizationId: string) =>
		[
			...organizationAppConnectionQueryKeys.organization(organizationId),
			"catalog",
		] as const,
	providers: (organizationId: string) =>
		[
			...organizationAppConnectionQueryKeys.organization(organizationId),
			"providers",
		] as const,
	requests: (organizationId: string) =>
		[
			...organizationAppConnectionQueryKeys.organization(organizationId),
			"requests",
		] as const,
	statusSummary: (organizationId: string) =>
		[
			...organizationAppConnectionQueryKeys.organization(organizationId),
			"status-summary",
		] as const,
	service: (organizationId: string, service: ConnectorService) =>
		[
			...organizationAppConnectionQueryKeys.organization(organizationId),
			service,
		] as const,
};

export function organizationAppProviderCatalogQueryOptions(input: {
	organizationId: string;
}) {
	return queryOptions<ConnectorAppCatalogResponse>({
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async ({ signal }) =>
			await listCurrentOrganizationConnectorAppCatalog({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: organizationAppConnectionQueryKeys.providers(
			input.organizationId
		),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 5 * 60_000,
	});
}

export function organizationAppRequestsQueryOptions(input: {
	organizationId: string;
}) {
	return queryOptions<ConnectorAppRequestListResponse>({
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async ({ signal }) =>
			await listCurrentOrganizationConnectorAppRequests({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: organizationAppConnectionQueryKeys.requests(input.organizationId),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 30_000,
	});
}

export const organizationAppConnectionStatusSummarySchema = z.strictObject({
	connectedServices: z.array(connectorServiceSchema),
	organizationId: z.string().trim().min(1),
});

export type OrganizationAppConnectionStatusSummary = z.infer<
	typeof organizationAppConnectionStatusSummarySchema
>;

export function organizationAppConnectionCatalogQueryOptions(input: {
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
		queryKey: organizationAppConnectionQueryKeys.catalog(input.organizationId),
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: baseQueryOptions.staleTime,
	});
}

export function organizationAppConnectionStatusSummaryQueryOptions(input: {
	organizationId: string;
}) {
	return queryOptions<OrganizationAppConnectionStatusSummary>({
		gcTime: PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
		queryFn: skipToken,
		queryKey: organizationAppConnectionQueryKeys.statusSummary(
			input.organizationId
		),
		select: (data) => organizationAppConnectionStatusSummarySchema.parse(data),
		staleTime: Number.POSITIVE_INFINITY,
	});
}

export function organizationAppServiceConnectionsQueryOptions(input: {
	organizationId: string;
	queryClient: QueryClient;
	refetchInterval?: false | number;
	service: ConnectorService;
}) {
	const catalogQueryKey = organizationAppConnectionQueryKeys.catalog(
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
			mergeOrganizationAppServiceConnectionsIntoCatalog({
				organizationId: input.organizationId,
				queryClient: input.queryClient,
				response,
				service: input.service,
			});
			return response;
		},
		queryKey: organizationAppConnectionQueryKeys.service(
			input.organizationId,
			input.service
		),
		refetchInterval: input.refetchInterval ?? false,
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: baseQueryOptions.staleTime,
	});
}

export function mergeOrganizationAppServiceConnectionsIntoCatalog(input: {
	organizationId: string;
	queryClient: QueryClient;
	response: ConnectorConnectionListResponse;
	service: ConnectorService;
}): void {
	input.queryClient.setQueryData<ConnectorConnectionListResponse>(
		organizationAppConnectionQueryKeys.catalog(input.organizationId),
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
	input.queryClient.setQueryData<OrganizationAppConnectionStatusSummary>(
		organizationAppConnectionQueryKeys.statusSummary(input.organizationId),
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
	input.queryClient.setQueryData<OrganizationAppConnectionStatusSummary>(
		organizationAppConnectionQueryKeys.statusSummary(input.organizationId),
		{
			connectedServices: [...connectedServices].sort(),
			organizationId: input.organizationId,
		}
	);
}

export async function invalidateOrganizationAppConnections(input: {
	organizationId: string;
	queryClient: QueryClient;
	service: ConnectorService;
}): Promise<void> {
	await Promise.all([
		input.queryClient.invalidateQueries({
			queryKey: organizationAppConnectionQueryKeys.catalog(
				input.organizationId
			),
		}),
		input.queryClient.invalidateQueries({
			queryKey: organizationAppConnectionQueryKeys.service(
				input.organizationId,
				input.service
			),
		}),
	]);
}
