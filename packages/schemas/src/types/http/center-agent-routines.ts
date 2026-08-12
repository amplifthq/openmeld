import type { z } from "zod/v4";

type RoutineSchemas = typeof import("../../schemas/http/center-agent-routines");

export type CenterAgentRoutine = z.infer<
  RoutineSchemas["centerAgentRoutineSchema"]
>;
export type CenterAgentRoutineCapabilityState = z.infer<
  RoutineSchemas["centerAgentRoutineCapabilityStateSchema"]
>;
export type CenterAgentRoutineCreationAttribution = z.infer<
  RoutineSchemas["centerAgentRoutineCreationAttributionSchema"]
>;
export type CenterAgentRoutineCreationInteractionSource = z.infer<
  RoutineSchemas["centerAgentRoutineCreationInteractionSourceSchema"]
>;
export type CenterAgentRoutineManagement = z.infer<
  RoutineSchemas["centerAgentRoutineManagementSchema"]
>;
export type CenterAgentRoutineManagementV1 = z.infer<
  RoutineSchemas["centerAgentRoutineManagementV1Schema"]
>;
export type CenterAgentRoutineLastRunSummary = z.infer<
  RoutineSchemas["centerAgentRoutineLastRunSummarySchema"]
>;
export type CenterAgentRoutineRun = z.infer<
  RoutineSchemas["centerAgentRoutineRunSchema"]
>;
export type CenterAgentRoutineTargetSpace = z.infer<
  RoutineSchemas["centerAgentRoutineTargetSpaceSchema"]
>;
export type CenterAgentRoutineTargetSpaceKind = z.infer<
  RoutineSchemas["centerAgentRoutineTargetSpaceKindSchema"]
>;
export type CenterAgentRoutineStatus = z.infer<
  RoutineSchemas["centerAgentRoutineStatusSchema"]
>;
export type CenterAgentRoutineRunStatus = z.infer<
  RoutineSchemas["centerAgentRoutineRunStatusSchema"]
>;
export type CenterAgentRoutineScheduleKind = z.infer<
  RoutineSchemas["centerAgentRoutineScheduleKindSchema"]
>;
export type CenterAgentRoutineDestinationKind = z.infer<
  RoutineSchemas["centerAgentRoutineDestinationKindSchema"]
>;
export type CenterAgentRoutineAuthorizedAction = z.infer<
  RoutineSchemas["centerAgentRoutineAuthorizedActionSchema"]
>;
export type CenterAgentRoutineExternalActionPolicy = z.infer<
  RoutineSchemas["centerAgentRoutineExternalActionPolicySchema"]
>;
export type CenterAgentRoutineContract = z.infer<
  RoutineSchemas["centerAgentRoutineContractSchema"]
>;
export type CenterAgentRoutineListContract = z.infer<
  RoutineSchemas["centerAgentRoutineListContractSchema"]
>;
export type CenterAgentRoutineLegacyV1 = z.infer<
  RoutineSchemas["centerAgentRoutineLegacyV1Schema"]
>;
export type CenterAgentRoutineRunLegacyV1 = z.infer<
  RoutineSchemas["centerAgentRoutineRunLegacyV1Schema"]
>;
export type ListCenterAgentRoutinesQuery = z.infer<
  RoutineSchemas["listCenterAgentRoutinesQuerySchema"]
>;
export type ListCenterAgentRoutinesResponse = z.infer<
  RoutineSchemas["listCenterAgentRoutinesResponseSchema"]
>;
export type ListCenterAgentRoutinesManagementResponse = z.infer<
  RoutineSchemas["listCenterAgentRoutinesManagementResponseSchema"]
>;
export type ListCenterAgentRoutinesManagementV1Response = z.infer<
  RoutineSchemas["listCenterAgentRoutinesManagementV1ResponseSchema"]
>;
export type ListCenterAgentRoutinesLegacyV1Response = z.infer<
  RoutineSchemas["listCenterAgentRoutinesLegacyV1ResponseSchema"]
>;
export type ListCenterAgentRoutineTargetSpacesQuery = z.infer<
  RoutineSchemas["listCenterAgentRoutineTargetSpacesQuerySchema"]
>;
export type ListCenterAgentRoutineTargetSpacesResponse = z.infer<
  RoutineSchemas["listCenterAgentRoutineTargetSpacesResponseSchema"]
>;
export type CreateCenterAgentRoutineBody = z.infer<
  RoutineSchemas["createCenterAgentRoutineBodySchema"]
>;
export type CreateCenterAgentRoutineResponse = z.infer<
  RoutineSchemas["createCenterAgentRoutineResponseSchema"]
>;
export type CenterAgentRoutineMutationLegacyV1Response = z.infer<
  RoutineSchemas["centerAgentRoutineMutationLegacyV1ResponseSchema"]
>;
export type CenterAgentRoutineRouteParams = z.infer<
  RoutineSchemas["centerAgentRoutineRouteParamsSchema"]
>;
export type UpdateCenterAgentRoutineBody = z.infer<
  RoutineSchemas["updateCenterAgentRoutineBodySchema"]
>;
export type UpdateCenterAgentRoutineResponse = z.infer<
  RoutineSchemas["updateCenterAgentRoutineResponseSchema"]
>;
export type PauseCenterAgentRoutineBody = z.infer<
  RoutineSchemas["pauseCenterAgentRoutineBodySchema"]
>;
export type PauseCenterAgentRoutineResponse = z.infer<
  RoutineSchemas["pauseCenterAgentRoutineResponseSchema"]
>;
export type ResumeCenterAgentRoutineBody = z.infer<
  RoutineSchemas["resumeCenterAgentRoutineBodySchema"]
>;
export type ResumeCenterAgentRoutineResponse = z.infer<
  RoutineSchemas["resumeCenterAgentRoutineResponseSchema"]
>;
export type DeleteCenterAgentRoutineBody = z.infer<
  RoutineSchemas["deleteCenterAgentRoutineBodySchema"]
>;
export type DeleteCenterAgentRoutineResponse = z.infer<
  RoutineSchemas["deleteCenterAgentRoutineResponseSchema"]
>;
export type ListCenterAgentRoutineRunsQuery = z.infer<
  RoutineSchemas["listCenterAgentRoutineRunsQuerySchema"]
>;
export type ListCenterAgentRoutineRunsResponse = z.infer<
  RoutineSchemas["listCenterAgentRoutineRunsResponseSchema"]
>;
export type ListCenterAgentRoutineRunsLegacyV1Response = z.infer<
  RoutineSchemas["listCenterAgentRoutineRunsLegacyV1ResponseSchema"]
>;
export type ListCenterAgentRoutinesRpcInput = z.infer<
  RoutineSchemas["listCenterAgentRoutinesRpcInputSchema"]
>;
export type ListCenterAgentRoutineTargetSpacesRpcInput = z.infer<
  RoutineSchemas["listCenterAgentRoutineTargetSpacesRpcInputSchema"]
>;
export type CreateCenterAgentRoutineRpcInput = z.infer<
  RoutineSchemas["createCenterAgentRoutineRpcInputSchema"]
>;
export type UpdateCenterAgentRoutineRpcInput = z.infer<
  RoutineSchemas["updateCenterAgentRoutineRpcInputSchema"]
>;
export type PauseCenterAgentRoutineRpcInput = z.infer<
  RoutineSchemas["pauseCenterAgentRoutineRpcInputSchema"]
>;
export type ResumeCenterAgentRoutineRpcInput = z.infer<
  RoutineSchemas["resumeCenterAgentRoutineRpcInputSchema"]
>;
export type DeleteCenterAgentRoutineRpcInput = z.infer<
  RoutineSchemas["deleteCenterAgentRoutineRpcInputSchema"]
>;
export type ListCenterAgentRoutineRunsRpcInput = z.infer<
  RoutineSchemas["listCenterAgentRoutineRunsRpcInputSchema"]
>;
export type CenterAgentRoutineToolSpeaker = z.infer<
  RoutineSchemas["centerAgentRoutineToolSpeakerSchema"]
>;
export type CenterAgentListRoutinesToolRpcInput = z.infer<
  RoutineSchemas["centerAgentListRoutinesToolRpcInputSchema"]
>;
export type CenterAgentCreateRoutineToolRpcInput = z.infer<
  RoutineSchemas["centerAgentCreateRoutineToolRpcInputSchema"]
>;
export type CenterAgentUpdateRoutineToolRpcInput = z.infer<
  RoutineSchemas["centerAgentUpdateRoutineToolRpcInputSchema"]
>;
export type CenterAgentDeleteRoutineToolRpcInput = z.infer<
  RoutineSchemas["centerAgentDeleteRoutineToolRpcInputSchema"]
>;
export type CenterAgentPauseRoutineToolRpcInput = z.infer<
  RoutineSchemas["centerAgentPauseRoutineToolRpcInputSchema"]
>;
export type CenterAgentResumeRoutineToolRpcInput = z.infer<
  RoutineSchemas["centerAgentResumeRoutineToolRpcInputSchema"]
>;
