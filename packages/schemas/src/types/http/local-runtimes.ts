import type { z } from "zod/v4";

type CurrentLocalRuntimeReplyReadinessResponseSchema =
  typeof import("../../schemas/http/local-runtimes")["currentLocalRuntimeReplyReadinessResponseSchema"];
type LocalRuntimeComputerSchema =
  typeof import("../../schemas/http/local-runtimes")["localRuntimeComputerSchema"];
type LocalRuntimeExecutionTargetSchema =
  typeof import("../../schemas/http/local-runtimes")["localRuntimeExecutionTargetSchema"];
type LocalRuntimeReplyReadinessNextActionSchema =
  typeof import("../../schemas/http/local-runtimes")["localRuntimeReplyReadinessNextActionSchema"];
type LocalRuntimeReplyReadinessPrimaryBlockerSchema =
  typeof import("../../schemas/http/local-runtimes")["localRuntimeReplyReadinessPrimaryBlockerSchema"];
type LocalRuntimeReplyReadinessStatusSchema =
  typeof import("../../schemas/http/local-runtimes")["localRuntimeReplyReadinessStatusSchema"];
type LocalRuntimesResponseSchema =
  typeof import("../../schemas/http/local-runtimes")["localRuntimesResponseSchema"];
type LocalRuntimesQuerySchema =
  typeof import("../../schemas/http/local-runtimes")["localRuntimesQuerySchema"];
type SetLocalRuntimeDisplayNameBodySchema =
  typeof import("../../schemas/http/local-runtimes")["setLocalRuntimeDisplayNameBodySchema"];
type SetCurrentLocalAgentEnabledBodySchema =
  typeof import("../../schemas/http/local-runtimes")["setCurrentLocalAgentEnabledBodySchema"];
type SetCurrentLocalAgentEnabledResponseSchema =
  typeof import("../../schemas/http/local-runtimes")["setCurrentLocalAgentEnabledResponseSchema"];
type SetCurrentLocalAgentEnabledRouteParamsSchema =
  typeof import("../../schemas/http/local-runtimes")["setCurrentLocalAgentEnabledRouteParamsSchema"];
type SetCurrentAgentProfileWorkspaceBodySchema =
  typeof import("../../schemas/http/local-runtimes")["setCurrentAgentProfileWorkspaceBodySchema"];
type SetCurrentAgentProfileWorkspaceResponseSchema =
  typeof import("../../schemas/http/local-runtimes")["setCurrentAgentProfileWorkspaceResponseSchema"];
type SetCurrentAgentProfileWorkspaceRouteParamsSchema =
  typeof import("../../schemas/http/local-runtimes")["setCurrentAgentProfileWorkspaceRouteParamsSchema"];
type RefreshCurrentLocalAgentCatalogResponseSchema =
  typeof import("../../schemas/http/local-runtimes")["refreshCurrentLocalAgentCatalogResponseSchema"];

export type CurrentLocalRuntimeReplyReadinessResponse =
  z.infer<CurrentLocalRuntimeReplyReadinessResponseSchema>;
export type LocalRuntimeComputer = z.infer<LocalRuntimeComputerSchema>;
export type LocalRuntimeExecutionTarget =
  z.infer<LocalRuntimeExecutionTargetSchema>;
export type LocalRuntimeReplyReadinessNextAction =
  z.infer<LocalRuntimeReplyReadinessNextActionSchema>;
export type LocalRuntimeReplyReadinessPrimaryBlocker =
  z.infer<LocalRuntimeReplyReadinessPrimaryBlockerSchema>;
export type LocalRuntimeReplyReadinessStatus =
  z.infer<LocalRuntimeReplyReadinessStatusSchema>;
export type LocalRuntimesQuery = z.infer<LocalRuntimesQuerySchema>;
export type LocalRuntimesResponse = z.infer<LocalRuntimesResponseSchema>;
export type SetLocalRuntimeDisplayNameBody =
  z.infer<SetLocalRuntimeDisplayNameBodySchema>;
export type SetCurrentLocalAgentEnabledBody =
  z.infer<SetCurrentLocalAgentEnabledBodySchema>;
export type SetCurrentLocalAgentEnabledResponse =
  z.infer<SetCurrentLocalAgentEnabledResponseSchema>;
export type SetCurrentLocalAgentEnabledRouteParams =
  z.infer<SetCurrentLocalAgentEnabledRouteParamsSchema>;
export type SetCurrentAgentProfileWorkspaceBody =
  z.infer<SetCurrentAgentProfileWorkspaceBodySchema>;
export type SetCurrentAgentProfileWorkspaceResponse =
  z.infer<SetCurrentAgentProfileWorkspaceResponseSchema>;
export type SetCurrentAgentProfileWorkspaceRouteParams =
  z.infer<SetCurrentAgentProfileWorkspaceRouteParamsSchema>;
export type RefreshCurrentLocalAgentCatalogResponse =
  z.infer<RefreshCurrentLocalAgentCatalogResponseSchema>;
