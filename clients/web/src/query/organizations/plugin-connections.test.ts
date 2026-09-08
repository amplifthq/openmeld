import type {
	ConnectorConnection,
	ConnectorConnectionListResponse,
} from "@openmeld/schemas/types";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	mergeOrganizationPluginServiceConnectionsIntoCatalog,
	organizationPluginConnectionCatalogQueryOptions,
	organizationPluginConnectionQueryKeys,
	organizationPluginServiceConnectionsQueryOptions,
} from "./plugin-connections";

const listCurrentOrganizationConnectorConnectionsMock = vi.hoisted(() =>
	vi.fn()
);
const listCurrentOrganizationAppConnectionsMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/organizations/connector-connections", () => ({
	listCurrentOrganizationAppConnections:
		listCurrentOrganizationAppConnectionsMock,
	listCurrentOrganizationConnectorConnections:
		listCurrentOrganizationConnectorConnectionsMock,
}));

describe("organization Plugin connection queries", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("stores only a privacy-safe connected-service summary from the Catalog", async () => {
		const queryClient = createQueryClient();
		listCurrentOrganizationAppConnectionsMock.mockResolvedValue(
			createResponse([
				createConnection({ service: "github", userId: "private-user-1" }),
				createConnection({
					service: "linear",
					status: "disconnected",
					userId: "private-user-2",
				}),
			])
		);

		await queryClient.fetchQuery(
			organizationPluginConnectionCatalogQueryOptions({
				organizationId: "org-acme",
				queryClient,
			})
		);

		const summary = queryClient.getQueryData(
			organizationPluginConnectionQueryKeys.statusSummary("org-acme")
		);
		expect(summary).toEqual({
			connectedServices: ["github"],
			organizationId: "org-acme",
		});
		expect(JSON.stringify(summary)).not.toContain("private-user");
	});

	it("reuses a fresh Catalog snapshot when opening an Plugin detail", async () => {
		const queryClient = createQueryClient();
		const catalogResponse = createResponse([
			createConnection({ service: "github", userId: "user-1" }),
			createConnection({ service: "linear", userId: "user-2" }),
		]);
		queryClient.setQueryData(
			organizationPluginConnectionQueryKeys.catalog("org-acme"),
			catalogResponse
		);

		const response = await queryClient.ensureQueryData(
			organizationPluginServiceConnectionsQueryOptions({
				organizationId: "org-acme",
				queryClient,
				service: "github",
			})
		);

		expect(response).toEqual(
			createResponse([
				createConnection({ service: "github", userId: "user-1" }),
			])
		);
		expect(
			listCurrentOrganizationConnectorConnectionsMock
		).not.toHaveBeenCalled();
	});

	it("does not permanently poll an observed Plugin detail", () => {
		const options = organizationPluginServiceConnectionsQueryOptions({
			organizationId: "org-acme",
			queryClient: createQueryClient(),
			service: "github",
		});

		expect(options.refetchInterval).toBe(false);
	});

	it("merges a refreshed Plugin detail back into the Catalog without losing other Plugins", () => {
		const queryClient = createQueryClient();
		queryClient.setQueryData(
			organizationPluginConnectionQueryKeys.catalog("org-acme"),
			createResponse([
				createConnection({ service: "github", userId: "old-user" }),
				createConnection({ service: "linear", userId: "linear-user" }),
			])
		);
		const refreshedGitHub = createResponse([
			createConnection({ service: "github", userId: "new-user" }),
		]);

		mergeOrganizationPluginServiceConnectionsIntoCatalog({
			organizationId: "org-acme",
			queryClient,
			response: refreshedGitHub,
			service: "github",
		});

		expect(
			queryClient.getQueryData<ConnectorConnectionListResponse>(
				organizationPluginConnectionQueryKeys.catalog("org-acme")
			)?.connections
		).toEqual([
			createConnection({ service: "linear", userId: "linear-user" }),
			createConnection({ service: "github", userId: "new-user" }),
		]);
	});
});

function createQueryClient() {
	return new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
}

function createResponse(
	connections: ConnectorConnection[]
): ConnectorConnectionListResponse {
	return {
		connections,
		currentUserId: "user-1",
		organizationId: "org-acme",
	};
}

function createConnection(input: {
	service: ConnectorConnection["service"];
	status?: ConnectorConnection["status"];
	userId: string;
}): ConnectorConnection {
	return {
		canDisconnect: true,
		connectionName: `${input.service}-${input.userId}`,
		createdAtMs: 1,
		disconnectedAtMs: null,
		organizationId: "org-acme",
		ownerDisplayName: input.userId,
		scope: "member",
		service: input.service,
		status: input.status ?? "active",
		updatedAtMs: 1,
		userId: input.userId,
	};
}
