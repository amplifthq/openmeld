import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/execution-recovery");

export type ExecutionRecoveryAction = z.infer<
  Schemas["executionRecoveryActionSchema"]
>;
export type ExecutionRecoveryTier = z.infer<
  Schemas["executionRecoveryTierSchema"]
>;
export type ExecutionRecoveryDestination = z.infer<
  Schemas["executionRecoveryDestinationSchema"]
>;
export type ExecutionRecoveryIdentity = z.infer<
  Schemas["executionRecoveryIdentitySchema"]
>;
export type ExecutionRecoveryActionCapability = z.infer<
  Schemas["executionRecoveryActionCapabilitySchema"]
>;
export type ExecutionRecoveryProjection = z.infer<
  Schemas["executionRecoveryProjectionSchema"]
>;
export type InspectExecutionRecoveryQuery = z.infer<
  Schemas["inspectExecutionRecoveryQuerySchema"]
>;
export type InspectExecutionRecoveryResponse = z.infer<
  Schemas["inspectExecutionRecoveryResponseSchema"]
>;
export type ExecuteExecutionRecoveryBody = z.infer<
  Schemas["executeExecutionRecoveryBodySchema"]
>;
export type ExecuteExecutionRecoveryResponse = z.infer<
  Schemas["executeExecutionRecoveryResponseSchema"]
>;
