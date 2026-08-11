export type RuntimeCoordinatorFinalizationDispatchOwner =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-coordinator-finalization-command")["runtimeCoordinatorFinalizationDispatchOwnerSchema"]
  >;

export type RuntimeCoordinatorFinalizationDispatchFact = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-finalization-command")["runtimeCoordinatorFinalizationDispatchFactSchema"]
>;

export type RuntimeCoordinatorFinalizationAcceptedResult =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-coordinator-finalization-command")["runtimeCoordinatorFinalizationAcceptedResultSchema"]
  >;

export type RuntimeCoordinatorFinalizationCommand = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-finalization-command")["runtimeCoordinatorFinalizationCommandSchema"]
>;

export type RuntimeCoordinatorFinalizationOutcome = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-finalization-command")["runtimeCoordinatorFinalizationOutcomeSchema"]
>;

export type RuntimeCoordinatorFinalizationClaimRead = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-coordinator-finalization-command")["runtimeCoordinatorFinalizationClaimReadSchema"]
>;
