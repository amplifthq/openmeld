export type RuntimeCoordinatorExecutionStatus = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution")["runtimeCoordinatorExecutionStatusSchema"]
>;

export type RuntimeCoordinatorExecutionEventType = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution")["runtimeCoordinatorExecutionEventTypeSchema"]
>;

export type RuntimeCoordinatorCancellationStatus = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution")["runtimeCoordinatorCancellationStatusSchema"]
>;

export type RuntimeCoordinatorCancellationState = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution")["runtimeCoordinatorCancellationStateSchema"]
>;

export type RuntimeCoordinatorTerminalOutcome = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution")["runtimeCoordinatorTerminalOutcomeSchema"]
>;

export type RuntimeCoordinatorLegacyPointers = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution")["runtimeCoordinatorLegacyPointersSchema"]
>;

export type RuntimeCoordinatorExecutionRecord = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution")["runtimeCoordinatorExecutionRecordSchema"]
>;

export type RuntimeCoordinatorExecutionEvent = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution")["runtimeCoordinatorExecutionEventSchema"]
>;

export type RuntimeCoordinatorExecutionCreationStatus = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-execution")["runtimeCoordinatorExecutionCreationStatusSchema"]
>;

export type RuntimeCoordinatorExecutionCreationDiagnostic =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-coordinator-execution")["runtimeCoordinatorExecutionCreationDiagnosticSchema"]
  >;
