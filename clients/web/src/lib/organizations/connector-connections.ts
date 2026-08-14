import {
	type OpenMeldApiClientFoundation,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import {
	connectorAppCatalogResponseSchema,
	connectorAppRequestListResponseSchema,
	connectorAppRequestResponseSchema,
	connectorAuthorizationStartResponseSchema,
	connectorConnectionListResponseSchema,
	connectorCredentialConnectResponseSchema,
	connectorDisconnectResponseSchema,
} from "@openmeld/schemas";
import type {
	ConnectorAppCatalogResponse,
	ConnectorAppRequestListResponse,
	ConnectorAppRequestResponse,
	ConnectorAuthorizationStartResponse,
	ConnectorConnectionListResponse,
	ConnectorCredentialAuthType,
	ConnectorCredentialConnectResponse,
	ConnectorDisconnectResponse,
	ConnectorService,
	CreateConnectorAppRequestBody,
} from "@openmeld/schemas/types";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

const CONNECTOR_ORGANIZATION_CONTEXT_CHANGED_CODE =
	"connector.organization_context_changed";

export async function listCurrentOrganizationConnectorConnections(input: {
	organizationId: string;
	service: ConnectorService;
	signal?: AbortSignal;
}): Promise<ConnectorConnectionListResponse> {
	try {
		const response = await createConnectorApiFoundation(
			input.organizationId
		).requestJson({
			invalidMessage: "Invalid App connection response.",
			method: "GET",
			operation: `connector.${input.service}.connections.list`,
			schema: connectorConnectionListResponseSchema,
			signal: input.signal,
			url: buildConnectorOrganizationUrl(
				buildConnectorPath(input.service, "connections"),
				input.organizationId
			),
		});
		requireMatchingOrganization(response.organizationId, input.organizationId);
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function listCurrentOrganizationAppConnections(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<ConnectorConnectionListResponse> {
	try {
		const response = await createConnectorApiFoundation(
			input.organizationId
		).requestJson({
			invalidMessage: "Invalid App connection response.",
			method: "GET",
			operation: "connector.connections.catalog",
			schema: connectorConnectionListResponseSchema,
			signal: input.signal,
			url: buildConnectorOrganizationUrl(
				"/v1/organizations/current/connectors/connections",
				input.organizationId
			),
		});
		requireMatchingOrganization(response.organizationId, input.organizationId);
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function listCurrentOrganizationConnectorAppRequests(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<ConnectorAppRequestListResponse> {
	try {
		const response = await createConnectorApiFoundation(
			input.organizationId
		).requestJson({
			invalidMessage: "Invalid App request response.",
			method: "GET",
			operation: "connector.requests.list",
			schema: connectorAppRequestListResponseSchema,
			signal: input.signal,
			url: buildConnectorOrganizationUrl(
				"/v1/organizations/current/connectors/requests",
				input.organizationId
			),
		});
		requireMatchingOrganization(response.organizationId, input.organizationId);
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function listCurrentOrganizationConnectorAppCatalog(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<ConnectorAppCatalogResponse> {
	try {
		const response = await createConnectorApiFoundation(
			input.organizationId
		).requestJson({
			invalidMessage: "Invalid App catalog response.",
			method: "GET",
			operation: "connector.catalog.providers",
			schema: connectorAppCatalogResponseSchema,
			signal: input.signal,
			url: buildConnectorOrganizationUrl(
				"/v1/organizations/current/connectors/catalog",
				input.organizationId
			),
		});
		requireMatchingOrganization(response.organizationId, input.organizationId);
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function createCurrentOrganizationConnectorAppRequest(
	input: CreateConnectorAppRequestBody & { organizationId: string }
): Promise<ConnectorAppRequestResponse> {
	try {
		const response = await createConnectorApiFoundation(
			input.organizationId
		).requestJson({
			body: JSON.stringify({
				providerId: input.providerId,
				providerName: input.providerName,
				requestedCapabilities: input.requestedCapabilities,
				source: input.source,
				useCase: input.useCase,
			}),
			headers: { "content-type": "application/json" },
			invalidMessage: "Invalid App request response.",
			method: "POST",
			operation: "connector.requests.create",
			schema: connectorAppRequestResponseSchema,
			url: buildConnectorOrganizationUrl(
				"/v1/organizations/current/connectors/requests",
				input.organizationId
			),
		});
		requireMatchingOrganization(
			response.request.organizationId,
			input.organizationId
		);
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function startCurrentMemberConnectorAuthorization(input: {
	organizationId: string;
	service: ConnectorService;
}): Promise<ConnectorAuthorizationStartResponse> {
	return await startConnectorAuthorization({ ...input, scope: "member" });
}

export async function startCurrentOrganizationSharedConnectorAuthorization(input: {
	organizationId: string;
	service: ConnectorService;
}): Promise<ConnectorAuthorizationStartResponse> {
	return await startConnectorAuthorization({ ...input, scope: "shared" });
}

export async function connectCurrentMemberConnectorCredential(input: {
	authType: ConnectorCredentialAuthType;
	organizationId: string;
	service: ConnectorService;
	values: Record<string, string>;
}): Promise<ConnectorCredentialConnectResponse> {
	return await connectConnectorCredential({ ...input, scope: "member" });
}

export async function connectCurrentOrganizationSharedConnectorCredential(input: {
	authType: ConnectorCredentialAuthType;
	organizationId: string;
	service: ConnectorService;
	values: Record<string, string>;
}): Promise<ConnectorCredentialConnectResponse> {
	return await connectConnectorCredential({ ...input, scope: "shared" });
}

export async function disconnectOrganizationConnectorConnection(input: {
	organizationId: string;
	service: ConnectorService;
	userId: string;
}): Promise<ConnectorDisconnectResponse> {
	return await disconnectConnectorConnection({ ...input, scope: "member" });
}

export async function disconnectSharedOrganizationConnectorConnection(input: {
	organizationId: string;
	service: ConnectorService;
}): Promise<ConnectorDisconnectResponse> {
	return await disconnectConnectorConnection({ ...input, scope: "shared" });
}

export function resolveConnectorConnectionErrorMessage(
	error: unknown,
	appName = "App"
): string {
	const failure = toStructuredApiClientFailure(error);
	if (failure.status === 401) {
		return `Sign in again before connecting ${appName}.`;
	}
	if (failure.status === 403) {
		return `You do not have permission to update this ${appName} connection.`;
	}
	if (failure.code === "network.timeout") {
		return `${appName} connection setup timed out. Try again.`;
	}
	if (
		(failure.upstreamCode ?? failure.code) ===
		CONNECTOR_ORGANIZATION_CONTEXT_CHANGED_CODE
	) {
		return `Your active Organization changed in another tab. Refresh this page before updating ${appName}.`;
	}
	if (failure.status !== null && failure.status >= 500) {
		return `OpenMeld could not finish ${appName} setup. Try again.`;
	}
	return (
		failure.message || `OpenMeld could not update the ${appName} connection.`
	);
}

export function isConnectorConnectionConfirmationRetryable(
	error: unknown
): boolean {
	const failure = toStructuredApiClientFailure(error);
	const failureCode = failure.upstreamCode ?? failure.code;
	if (failureCode === CONNECTOR_ORGANIZATION_CONTEXT_CHANGED_CODE) {
		return false;
	}
	if (
		failure.code === "network.timeout" ||
		failure.code === "network.request_failed"
	) {
		return true;
	}
	if (failure.status === null) {
		return false;
	}
	return (
		failure.status === 408 || failure.status === 429 || failure.status >= 500
	);
}

export function listCurrentOrganizationGitHubConnections(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<ConnectorConnectionListResponse> {
	return listCurrentOrganizationConnectorConnections({
		...input,
		service: "github",
	});
}

export function startCurrentMemberGitHubAuthorization(input: {
	organizationId: string;
}): Promise<ConnectorAuthorizationStartResponse> {
	return startCurrentMemberConnectorAuthorization({
		...input,
		service: "github",
	});
}

export function startCurrentOrganizationSharedGitHubAuthorization(input: {
	organizationId: string;
}): Promise<ConnectorAuthorizationStartResponse> {
	return startCurrentOrganizationSharedConnectorAuthorization({
		...input,
		service: "github",
	});
}

export function disconnectOrganizationGitHubConnection(input: {
	organizationId: string;
	userId: string;
}): Promise<ConnectorDisconnectResponse> {
	return disconnectOrganizationConnectorConnection({
		...input,
		service: "github",
	});
}

export function disconnectSharedOrganizationGitHubConnection(input: {
	organizationId: string;
}): Promise<ConnectorDisconnectResponse> {
	return disconnectSharedOrganizationConnectorConnection({
		...input,
		service: "github",
	});
}

async function startConnectorAuthorization(input: {
	organizationId: string;
	scope: "member" | "shared";
	service: ConnectorService;
}): Promise<ConnectorAuthorizationStartResponse> {
	try {
		const response = await createConnectorApiFoundation(
			input.organizationId
		).requestJson({
			invalidMessage: "Invalid App authorization response.",
			method: "POST",
			operation: `connector.${input.service}.${input.scope}_authorization.start`,
			schema: connectorAuthorizationStartResponseSchema,
			url: buildConnectorOrganizationUrl(
				buildConnectorPath(
					input.service,
					input.scope === "shared" ? "shared-authorization" : "authorization"
				),
				input.organizationId,
				input.scope === "shared" && input.service === "github"
			),
		});
		requireMatchingOrganization(
			response.connection.organizationId,
			input.organizationId
		);
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

async function connectConnectorCredential(input: {
	authType: ConnectorCredentialAuthType;
	organizationId: string;
	scope: "member" | "shared";
	service: ConnectorService;
	values: Record<string, string>;
}): Promise<ConnectorCredentialConnectResponse> {
	try {
		const response = await createConnectorApiFoundation(
			input.organizationId
		).requestJson({
			body: JSON.stringify({
				authType: input.authType,
				values: input.values,
			}),
			headers: { "content-type": "application/json" },
			invalidMessage: "Invalid App credential response.",
			method: "POST",
			operation: `connector.${input.service}.${input.scope}_credential.connect`,
			schema: connectorCredentialConnectResponseSchema,
			url: buildConnectorOrganizationUrl(
				buildConnectorPath(
					input.service,
					input.scope === "shared" ? "shared-credential" : "credential"
				),
				input.organizationId
			),
		});
		requireMatchingOrganization(
			response.connection.organizationId,
			input.organizationId
		);
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

async function disconnectConnectorConnection(input: {
	organizationId: string;
	scope: "member" | "shared";
	service: ConnectorService;
	userId?: string;
}): Promise<ConnectorDisconnectResponse> {
	try {
		const suffix =
			input.scope === "shared"
				? "shared"
				: encodeURIComponent(requireUserId(input.userId));
		const response = await createConnectorApiFoundation(
			input.organizationId
		).requestJson({
			invalidMessage: "Invalid App disconnect response.",
			method: "DELETE",
			operation: `connector.${input.service}.${input.scope}_connection.disconnect`,
			schema: connectorDisconnectResponseSchema,
			url: buildConnectorOrganizationUrl(
				`${buildConnectorPath(input.service, "connections")}/${suffix}`,
				input.organizationId
			),
		});
		requireMatchingOrganization(
			response.connection.organizationId,
			input.organizationId
		);
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

function buildConnectorPath(service: ConnectorService, suffix: string): string {
	return `/v1/organizations/current/connectors/${encodeURIComponent(service)}/${suffix}`;
}

function buildConnectorOrganizationUrl(
	path: string,
	expectedOrganizationId: string,
	includeAuthorizationExpiry = false
): string {
	const query = new URLSearchParams({ expectedOrganizationId });
	if (includeAuthorizationExpiry) {
		query.set("includeAuthorizationExpiry", "true");
	}
	return `${path}?${query.toString()}`;
}

function requireMatchingOrganization(
	actualOrganizationId: string,
	expectedOrganizationId: string
): void {
	if (actualOrganizationId !== expectedOrganizationId) {
		throw Object.assign(new Error("App response Organization mismatch."), {
			upstreamCode: CONNECTOR_ORGANIZATION_CONTEXT_CHANGED_CODE,
		});
	}
}

function requireUserId(userId: string | undefined): string {
	if (!userId) {
		throw new Error("The App connection owner is missing.");
	}
	return userId;
}

function createConnectorApiFoundation(
	organizationId: string
): OpenMeldApiClientFoundation {
	return createWebOpenMeldApiFoundation({ organizationId });
}
