import type { z } from "zod/v4";

export type CenterAgentResolveConnectorConnectionBody = z.infer<
  typeof import("../../schemas/http/connector-connections")["centerAgentResolveConnectorConnectionBodySchema"]
>;

type ConnectorAppCatalogProviderSchema =
  typeof import("../../schemas/http/connector-connections")["connectorAppCatalogProviderSchema"];
type ConnectorAppCatalogResponseSchema =
  typeof import("../../schemas/http/connector-connections")["connectorAppCatalogResponseSchema"];
type ConnectorAuthorizationStartResponseSchema =
  typeof import("../../schemas/http/connector-connections")["connectorAuthorizationStartResponseSchema"];
type ConnectorAppRequestListResponseSchema =
  typeof import("../../schemas/http/connector-connections")["connectorAppRequestListResponseSchema"];
type ConnectorAppRequestResponseSchema =
  typeof import("../../schemas/http/connector-connections")["connectorAppRequestResponseSchema"];
type ConnectorAppRequestSchema =
  typeof import("../../schemas/http/connector-connections")["connectorAppRequestSchema"];
type ConnectorAppRequestSourceSchema =
  typeof import("../../schemas/http/connector-connections")["connectorAppRequestSourceSchema"];
type ConnectorAppRequestStatusSchema =
  typeof import("../../schemas/http/connector-connections")["connectorAppRequestStatusSchema"];
type ConnectorConnectionListResponseSchema =
  typeof import("../../schemas/http/connector-connections")["connectorConnectionListResponseSchema"];
type ConnectorConnectionNameSchema =
  typeof import("../../schemas/http/connector-connections")["connectorConnectionNameSchema"];
type ConnectorConnectionPreferenceSchema =
  typeof import("../../schemas/http/connector-connections")["connectorConnectionPreferenceSchema"];
type ConnectorConnectionReconcileInputSchema =
  typeof import("../../schemas/http/connector-connections")["connectorConnectionReconcileInputSchema"];
type ConnectorConnectionSchema =
  typeof import("../../schemas/http/connector-connections")["connectorConnectionSchema"];
type ConnectorConnectionStatusSchema =
  typeof import("../../schemas/http/connector-connections")["connectorConnectionStatusSchema"];
type ConnectorConnectionScopeSchema =
  typeof import("../../schemas/http/connector-connections")["connectorConnectionScopeSchema"];
type ConnectorDisconnectBodySchema =
  typeof import("../../schemas/http/connector-connections")["connectorDisconnectBodySchema"];
type ConnectorDisconnectResponseSchema =
  typeof import("../../schemas/http/connector-connections")["connectorDisconnectResponseSchema"];
type ConnectorCredentialAuthTypeSchema =
  typeof import("../../schemas/http/connector-connections")["connectorCredentialAuthTypeSchema"];
type ConnectorCredentialConnectBodySchema =
  typeof import("../../schemas/http/connector-connections")["connectorCredentialConnectBodySchema"];
type ConnectorCredentialConnectResponseSchema =
  typeof import("../../schemas/http/connector-connections")["connectorCredentialConnectResponseSchema"];
type ConnectorOrganizationContextQuerySchema =
  typeof import("../../schemas/http/connector-connections")["connectorOrganizationContextQuerySchema"];
type ConnectorServiceSchema =
  typeof import("../../schemas/http/connector-connections")["connectorServiceSchema"];
type CreateConnectorAppRequestBodySchema =
  typeof import("../../schemas/http/connector-connections")["createConnectorAppRequestBodySchema"];
type CenterAgentConnectorConnectionSelectionSchema =
  typeof import("../../schemas/http/connector-connections")["centerAgentConnectorConnectionSelectionSchema"];
type GitHubAppInstallationStartResponseSchema =
  typeof import("../../schemas/http/connector-connections")["githubAppInstallationStartResponseSchema"];
type GitHubAppInstallationSetupQuerySchema =
  typeof import("../../schemas/http/connector-connections")["githubAppInstallationSetupQuerySchema"];
type GitHubAppInstallationVerificationResponseSchema =
  typeof import("../../schemas/http/connector-connections")["githubAppInstallationVerificationResponseSchema"];
type PendingGitHubAppInstallationSchema =
  typeof import("../../schemas/http/connector-connections")["pendingGitHubAppInstallationSchema"];

export type CenterAgentConnectorConnectionSelection =
  z.infer<CenterAgentConnectorConnectionSelectionSchema>;
export type ConnectorAppCatalogProvider =
  z.infer<ConnectorAppCatalogProviderSchema>;
export type ConnectorAppCatalogResponse =
  z.infer<ConnectorAppCatalogResponseSchema>;
export type ConnectorAuthorizationStartResponse =
  z.infer<ConnectorAuthorizationStartResponseSchema>;
export type ConnectorAppRequest = z.infer<ConnectorAppRequestSchema>;
export type ConnectorAppRequestListResponse =
  z.infer<ConnectorAppRequestListResponseSchema>;
export type ConnectorAppRequestResponse =
  z.infer<ConnectorAppRequestResponseSchema>;
export type ConnectorAppRequestSource =
  z.infer<ConnectorAppRequestSourceSchema>;
export type ConnectorAppRequestStatus =
  z.infer<ConnectorAppRequestStatusSchema>;
export type ConnectorConnection = z.infer<ConnectorConnectionSchema>;
export type ConnectorConnectionListResponse =
  z.infer<ConnectorConnectionListResponseSchema>;
export type ConnectorConnectionName = z.infer<ConnectorConnectionNameSchema>;
export type ConnectorConnectionPreference =
  z.infer<ConnectorConnectionPreferenceSchema>;
export type ConnectorConnectionReconcileInput =
  z.infer<ConnectorConnectionReconcileInputSchema>;
export type ConnectorConnectionStatus =
  z.infer<ConnectorConnectionStatusSchema>;
export type ConnectorConnectionScope = z.infer<ConnectorConnectionScopeSchema>;
export type ConnectorCredentialAuthType =
  z.infer<ConnectorCredentialAuthTypeSchema>;
export type ConnectorCredentialConnectBody =
  z.infer<ConnectorCredentialConnectBodySchema>;
export type ConnectorCredentialConnectResponse =
  z.infer<ConnectorCredentialConnectResponseSchema>;
export type ConnectorDisconnectBody = z.infer<ConnectorDisconnectBodySchema>;
export type ConnectorDisconnectResponse =
  z.infer<ConnectorDisconnectResponseSchema>;
export type ConnectorOrganizationContextQuery =
  z.infer<ConnectorOrganizationContextQuerySchema>;
export type ConnectorService = z.infer<ConnectorServiceSchema>;
export type CreateConnectorAppRequestBody =
  z.infer<CreateConnectorAppRequestBodySchema>;
export type GitHubAppInstallationStartResponse =
  z.infer<GitHubAppInstallationStartResponseSchema>;
export type GitHubAppInstallationSetupQuery =
  z.infer<GitHubAppInstallationSetupQuerySchema>;
export type GitHubAppInstallationVerificationResponse =
  z.infer<GitHubAppInstallationVerificationResponseSchema>;
export type PendingGitHubAppInstallation =
  z.infer<PendingGitHubAppInstallationSchema>;
