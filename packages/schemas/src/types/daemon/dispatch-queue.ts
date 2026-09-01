export type OpenMeldDaemonDispatchDeliveryRecoveryReason =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/dispatch-queue")["openMeldDaemonDispatchDeliveryRecoveryReasonSchema"]
  >;

export type OpenMeldDaemonDispatchQueueRecoveryReason = import("zod/v4").infer<
  typeof import("../../schemas/daemon/dispatch-queue")["openMeldDaemonDispatchQueueRecoveryReasonSchema"]
>;

export type OpenMeldDaemonDispatchReplyToSnapshot = import("zod/v4").infer<
  typeof import("../../schemas/daemon/dispatch-queue")["openMeldDaemonDispatchReplyToSnapshotSchema"]
>;

export type OpenMeldDaemonDispatchContinuitySnapshot = import("zod/v4").infer<
  typeof import("../../schemas/daemon/dispatch-queue")["openMeldDaemonDispatchContinuitySnapshotSchema"]
>;

export type OpenMeldDaemonAcceptedDispatchSnapshot = import("zod/v4").infer<
  typeof import("../../schemas/daemon/dispatch-queue")["openMeldDaemonAcceptedDispatchSnapshotSchema"]
>;

export type OpenMeldDaemonDispatchControllerSnapshot = import("zod/v4").infer<
  typeof import("../../schemas/daemon/dispatch-queue")["openMeldDaemonDispatchControllerSnapshotSchema"]
>;

export type OpenMeldDaemonDispatchQueueLegacyMessageV1 = import("zod/v4").infer<
  typeof import("../../schemas/daemon/dispatch-queue")["openMeldDaemonDispatchQueueLegacyMessageSchemaV1"]
>;

export type OpenMeldDaemonDispatchQueueIngress = import("zod/v4").infer<
  typeof import("../../schemas/daemon/dispatch-queue")["openMeldDaemonDispatchQueueIngressSchema"]
>;

export type OpenMeldDaemonDispatchQueueMessage = import("zod/v4").infer<
  typeof import("../../schemas/daemon/dispatch-queue")["openMeldDaemonDispatchQueueMessageSchema"]
>;

export type RemoteAgentNativeDeliveryDeadlineProbeQueueMessage =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/dispatch-queue")["remoteAgentNativeDeliveryDeadlineProbeQueueMessageSchema"]
  >;

export type AgentTaskContinuationQueueMessage = import("zod/v4").infer<
  typeof import("../../schemas/daemon/dispatch-queue")["agentTaskContinuationQueueMessageSchema"]
>;

export type AgentTaskObservationRedriveQueueMessage = import("zod/v4").infer<
  typeof import("../../schemas/daemon/dispatch-queue")["agentTaskObservationRedriveQueueMessageSchema"]
>;
