export type RuntimeExecutionAuthorityOpenMeldServiceRuntimeId =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/execution-identity")["runtimeExecutionAuthorityOpenMeldServiceRuntimeIdSchema"]
  >;

export type RuntimeExecutionIdentityCore = import("zod/v4").infer<
  typeof import("../../schemas/daemon/execution-identity")["runtimeExecutionIdentityCoreSchema"]
>;

export type RuntimeTransportDeliveryExecutionIdentity = import("zod/v4").infer<
  typeof import("../../schemas/daemon/execution-identity")["runtimeTransportDeliveryExecutionIdentitySchema"]
>;

export type RuntimeTransportRuntimeEvidenceIdentityEcho =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/execution-identity")["runtimeTransportRuntimeEvidenceIdentityEchoSchema"]
  >;

export type RuntimeTransportResultIdentityEcho = import("zod/v4").infer<
  typeof import("../../schemas/daemon/execution-identity")["runtimeTransportResultIdentityEchoSchema"]
>;

export type SpaceTraceExecutionIdentityProjection = import("zod/v4").infer<
  typeof import("../../schemas/daemon/execution-identity")["spaceTraceExecutionIdentityProjectionSchema"]
>;
