export type RuntimeCoordinatorExecutionToken = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution-token")["runtimeCoordinatorExecutionTokenSchema"]
>;

export type RuntimeCoordinatorTokenValidationHash = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution-token")["runtimeCoordinatorTokenValidationHashSchema"]
>;

export type RuntimeCoordinatorTokenFingerprint = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution-token")["runtimeCoordinatorTokenFingerprintSchema"]
>;

export type RuntimeCoordinatorTokenStatus = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution-token")["runtimeCoordinatorTokenStatusSchema"]
>;

export type RuntimeCoordinatorTokenReasonCode = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution-token")["runtimeCoordinatorTokenReasonCodeSchema"]
>;

export type RuntimeCoordinatorTokenExecutionScope = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution-token")["runtimeCoordinatorTokenExecutionScopeSchema"]
>;

export type RuntimeCoordinatorTokenAuthorityScope = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution-token")["runtimeCoordinatorTokenAuthorityScopeSchema"]
>;

export type RuntimeCoordinatorTokenDeliveryProvenance = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution-token")["runtimeCoordinatorTokenDeliveryProvenanceSchema"]
>;

export type RuntimeCoordinatorExecutionTokenEnvelope = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution-token")["runtimeCoordinatorExecutionTokenEnvelopeSchema"]
>;

export type RuntimeCoordinatorExecutionTokenEcho = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution-token")["runtimeCoordinatorExecutionTokenEchoSchema"]
>;

export type RuntimeCoordinatorTokenProjection = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution-token")["runtimeCoordinatorTokenProjectionSchema"]
>;

export type RuntimeCoordinatorTokenDiagnosticEvent = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution-token")["runtimeCoordinatorTokenDiagnosticEventSchema"]
>;

export type RuntimeCoordinatorTokenRunAuthority = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution-token")["runtimeCoordinatorTokenRunAuthoritySchema"]
>;

export type RuntimeCoordinatorExecutionTokenAuthorityRecord =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-coordinator-execution-token")["runtimeCoordinatorExecutionTokenAuthorityRecordSchema"]
  >;
