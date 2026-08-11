import type { z } from "zod/v4";

type LocalProjectControlSchemas =
  typeof import("../../schemas/daemon/local-project-control");

export type LocalProjectControlGitStatus = z.infer<
  LocalProjectControlSchemas["localProjectControlGitStatusSchema"]
>;
export type LocalProjectControlCandidate = z.infer<
  LocalProjectControlSchemas["localProjectControlCandidateSchema"]
>;
export type LocalProjectControlConnection = z.infer<
  LocalProjectControlSchemas["localProjectControlConnectionSchema"]
>;
export type LocalProjectControlProjectDiscovery = z.infer<
  LocalProjectControlSchemas["localProjectControlProjectDiscoverySchema"]
>;
export type LocalProjectControlDiscoverProjectsRequest = z.infer<
  LocalProjectControlSchemas["localProjectControlDiscoverProjectsRequestSchema"]
>;
export type LocalProjectControlDiscoverProjectsResponse = z.infer<
  LocalProjectControlSchemas["localProjectControlDiscoverProjectsResponseSchema"]
>;
export type LocalProjectControlConnectCandidateRequest = z.infer<
  LocalProjectControlSchemas["localProjectControlConnectCandidateRequestSchema"]
>;
export type LocalProjectControlConnectDeclaredPathRequest = z.infer<
  LocalProjectControlSchemas["localProjectControlConnectDeclaredPathRequestSchema"]
>;
export type LocalProjectControlConnectResponse = z.infer<
  LocalProjectControlSchemas["localProjectControlConnectResponseSchema"]
>;
export type LocalProjectControlConnectOutcome = z.infer<
  LocalProjectControlSchemas["localProjectControlConnectOutcomeSchema"]
>;
export type LocalProjectControlCanonicalProject = z.infer<
  LocalProjectControlSchemas["localProjectControlCanonicalProjectSchema"]
>;
export type LocalProjectControlDiscoverProjectsDaemonRequest = z.infer<
  LocalProjectControlSchemas["localProjectControlDiscoverProjectsDaemonRequestSchema"]
>;
export type LocalProjectControlConnectCandidateDaemonRequest = z.infer<
  LocalProjectControlSchemas["localProjectControlConnectCandidateDaemonRequestSchema"]
>;
export type LocalProjectControlConnectDeclaredPathDaemonRequest = z.infer<
  LocalProjectControlSchemas["localProjectControlConnectDeclaredPathDaemonRequestSchema"]
>;
export type LocalProjectControlSetDefaultConnectionRequest = z.infer<
  LocalProjectControlSchemas["localProjectControlSetDefaultConnectionRequestSchema"]
>;
export type LocalProjectControlSetDefaultConnectionResponse = z.infer<
  LocalProjectControlSchemas["localProjectControlSetDefaultConnectionResponseSchema"]
>;
export type LocalProjectControlRemoveConnectionRequest = z.infer<
  LocalProjectControlSchemas["localProjectControlRemoveConnectionRequestSchema"]
>;
export type LocalProjectControlRemoveConnectionResponse = z.infer<
  LocalProjectControlSchemas["localProjectControlRemoveConnectionResponseSchema"]
>;
export type LocalProjectControlRemoveMissingConnectionsRequest = z.infer<
  LocalProjectControlSchemas["localProjectControlRemoveMissingConnectionsRequestSchema"]
>;
export type LocalProjectControlRemoveMissingConnectionsResponse = z.infer<
  LocalProjectControlSchemas["localProjectControlRemoveMissingConnectionsResponseSchema"]
>;
export type LocalProjectControlErrorCode = z.infer<
  LocalProjectControlSchemas["localProjectControlErrorCodeSchema"]
>;
export type LocalProjectControlErrorResponse = z.infer<
  LocalProjectControlSchemas["localProjectControlErrorResponseSchema"]
>;
export type LocalProjectControlPathConflictResponse = z.infer<
  LocalProjectControlSchemas["localProjectControlPathConflictResponseSchema"]
>;
export type LocalProjectControlDiscoverProjectsRpcInput = z.infer<
  LocalProjectControlSchemas["localProjectControlDiscoverProjectsRpcInputSchema"]
>;
export type LocalProjectControlConnectCandidateRpcInput = z.infer<
  LocalProjectControlSchemas["localProjectControlConnectCandidateRpcInputSchema"]
>;
export type LocalProjectControlConnectDeclaredPathRpcInput = z.infer<
  LocalProjectControlSchemas["localProjectControlConnectDeclaredPathRpcInputSchema"]
>;
export type LocalProjectControlSetDefaultConnectionRpcInput = z.infer<
  LocalProjectControlSchemas["localProjectControlSetDefaultConnectionRpcInputSchema"]
>;
export type LocalProjectControlRemoveConnectionRpcInput = z.infer<
  LocalProjectControlSchemas["localProjectControlRemoveConnectionRpcInputSchema"]
>;
export type LocalProjectControlRemoveMissingConnectionsRpcInput = z.infer<
  LocalProjectControlSchemas["localProjectControlRemoveMissingConnectionsRpcInputSchema"]
>;
export type LocalProjectControlDaemonFrame = z.infer<
  LocalProjectControlSchemas["localProjectControlDaemonFrameSchema"]
>;
export type RuntimeTransportLocalProjectControlDiscoverProjectsRequest =
  z.infer<
    LocalProjectControlSchemas["runtimeTransportLocalProjectControlDiscoverProjectsRequestSchema"]
  >;
export type RuntimeTransportLocalProjectControlConnectCandidateRequest =
  z.infer<
    LocalProjectControlSchemas["runtimeTransportLocalProjectControlConnectCandidateRequestSchema"]
  >;
export type RuntimeTransportLocalProjectControlConnectDeclaredPathRequest =
  z.infer<
    LocalProjectControlSchemas["runtimeTransportLocalProjectControlConnectDeclaredPathRequestSchema"]
  >;
export type RuntimeTransportLocalProjectControlSetDefaultConnectionRequest =
  z.infer<
    LocalProjectControlSchemas["runtimeTransportLocalProjectControlSetDefaultConnectionRequestSchema"]
  >;
export type RuntimeTransportLocalProjectControlRemoveConnectionRequest =
  z.infer<
    LocalProjectControlSchemas["runtimeTransportLocalProjectControlRemoveConnectionRequestSchema"]
  >;
export type RuntimeTransportLocalProjectControlRemoveMissingConnectionsRequest =
  z.infer<
    LocalProjectControlSchemas["runtimeTransportLocalProjectControlRemoveMissingConnectionsRequestSchema"]
  >;
