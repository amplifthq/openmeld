import type { z } from "zod/v4";

type OpenMeldDaemonControlPlaneRequestSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonControlPlaneRequestSchema"];
type OpenMeldDaemonControlPlaneResponseSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonControlPlaneResponseSchema"];
type OpenMeldDaemonControlPlaneErrorPayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonControlPlaneErrorPayloadSchema"];
type OpenMeldDaemonConversationExecutionControllerLaunchStatusSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonConversationExecutionControllerLaunchStatusSchema"];
type OpenMeldDaemonProviderConversationProofSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonProviderConversationProofSchema"];
type OpenMeldDaemonProviderConversationProofStatusSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonProviderConversationProofStatusSchema"];
type OpenMeldDaemonProviderConversationProofProviderSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonProviderConversationProofProviderSchema"];
type OpenMeldDaemonProviderConversationProofMethodSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonProviderConversationProofMethodSchema"];
type OpenMeldDaemonConversationExecutionLocalRuntimeContextStatusSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonConversationExecutionLocalRuntimeContextStatusSchema"];
type OpenMeldDaemonSyncRouteCatalogPayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonSyncRouteCatalogPayloadSchema"];
type DaemonProfileSkipReasonSchema =
  typeof import("../../schemas/daemon/control-plane")["daemonProfileSkipReasonSchema"];
type SkippedDaemonProfileSchema =
  typeof import("../../schemas/daemon/control-plane")["skippedDaemonProfileSchema"];
type OpenMeldDaemonSyncRouteCatalogRequestPayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonSyncRouteCatalogRequestPayloadSchema"];
type OpenMeldDaemonSetLocalAgentEnabledPayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonSetLocalAgentEnabledPayloadSchema"];
type OpenMeldDaemonSetLocalAgentEnabledRequestPayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonSetLocalAgentEnabledRequestPayloadSchema"];
type LocalAgentInstallationOptionSchema =
  typeof import("../../schemas/daemon/control-plane")["localAgentInstallationOptionSchema"];
type OpenMeldDaemonManageLocalAgentInstallationPayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonManageLocalAgentInstallationPayloadSchema"];
type OpenMeldDaemonManageLocalAgentInstallationRequestPayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonManageLocalAgentInstallationRequestPayloadSchema"];
type OpenMeldDaemonSetProfileWorkspacePayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonSetProfileWorkspacePayloadSchema"];
type OpenMeldDaemonSetProfileWorkspaceRequestPayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonSetProfileWorkspaceRequestPayloadSchema"];
type OpenMeldDaemonConversationExecutionStatusPayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonConversationExecutionStatusPayloadSchema"];
type OpenMeldDaemonConversationExecutionStatusRequestPayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonConversationExecutionStatusRequestPayloadSchema"];
type OpenMeldDaemonConversationExecutionRuntimeWorkspaceSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonConversationExecutionRuntimeWorkspaceSchema"];
type OpenMeldDaemonControlTargetSelectorSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonControlTargetSelectorSchema"];
type OpenMeldDaemonCancelRequestPayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonCancelRequestPayloadSchema"];
type OpenMeldDaemonCancelPayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonCancelPayloadSchema"];
type OpenMeldDaemonHealthPayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonHealthPayloadSchema"];
type OpenMeldDaemonHistoryEntrySchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonHistoryEntrySchema"];
type OpenMeldDaemonInterruptRequestPayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonInterruptRequestPayloadSchema"];
type OpenMeldDaemonInterruptPayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonInterruptPayloadSchema"];
type OpenMeldDaemonShutdownRequestPayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonShutdownRequestPayloadSchema"];
type OpenMeldDaemonStatusPayloadSchema =
  typeof import("../../schemas/daemon/control-plane")["openMeldDaemonStatusPayloadSchema"];

export type OpenMeldDaemonControlPlaneRequest =
  z.infer<OpenMeldDaemonControlPlaneRequestSchema>;
export type OpenMeldDaemonControlPlaneResponse =
  z.infer<OpenMeldDaemonControlPlaneResponseSchema>;
export type LocalAgentInstallationOption =
  z.infer<LocalAgentInstallationOptionSchema>;
export type OpenMeldDaemonManageLocalAgentInstallationPayload =
  z.infer<OpenMeldDaemonManageLocalAgentInstallationPayloadSchema>;
export type OpenMeldDaemonManageLocalAgentInstallationRequestPayload =
  z.infer<OpenMeldDaemonManageLocalAgentInstallationRequestPayloadSchema>;
export type OpenMeldDaemonControlPlaneErrorPayload =
  z.infer<OpenMeldDaemonControlPlaneErrorPayloadSchema>;
export type OpenMeldDaemonConversationExecutionControllerLaunchStatus =
  z.infer<OpenMeldDaemonConversationExecutionControllerLaunchStatusSchema>;
export type OpenMeldDaemonProviderConversationProof =
  z.infer<OpenMeldDaemonProviderConversationProofSchema>;
export type OpenMeldDaemonProviderConversationProofStatus =
  z.infer<OpenMeldDaemonProviderConversationProofStatusSchema>;
export type OpenMeldDaemonProviderConversationProofProvider =
  z.infer<OpenMeldDaemonProviderConversationProofProviderSchema>;
export type OpenMeldDaemonProviderConversationProofMethod =
  z.infer<OpenMeldDaemonProviderConversationProofMethodSchema>;
export type OpenMeldDaemonConversationExecutionLocalRuntimeContextStatus =
  z.infer<OpenMeldDaemonConversationExecutionLocalRuntimeContextStatusSchema>;
export type OpenMeldDaemonSyncRouteCatalogPayload =
  z.infer<OpenMeldDaemonSyncRouteCatalogPayloadSchema>;
export type DaemonProfileSkipReason = z.infer<DaemonProfileSkipReasonSchema>;
export type SkippedDaemonProfile = z.infer<SkippedDaemonProfileSchema>;
export type OpenMeldDaemonSyncRouteCatalogRequestPayload =
  z.infer<OpenMeldDaemonSyncRouteCatalogRequestPayloadSchema>;
export type OpenMeldDaemonSetLocalAgentEnabledPayload =
  z.infer<OpenMeldDaemonSetLocalAgentEnabledPayloadSchema>;
export type OpenMeldDaemonSetLocalAgentEnabledRequestPayload =
  z.infer<OpenMeldDaemonSetLocalAgentEnabledRequestPayloadSchema>;
export type OpenMeldDaemonSetProfileWorkspacePayload =
  z.infer<OpenMeldDaemonSetProfileWorkspacePayloadSchema>;
export type OpenMeldDaemonSetProfileWorkspaceRequestPayload =
  z.infer<OpenMeldDaemonSetProfileWorkspaceRequestPayloadSchema>;
export type OpenMeldDaemonConversationExecutionStatusPayload =
  z.infer<OpenMeldDaemonConversationExecutionStatusPayloadSchema>;
export type OpenMeldDaemonConversationExecutionStatusRequestPayload =
  z.infer<OpenMeldDaemonConversationExecutionStatusRequestPayloadSchema>;
export type OpenMeldDaemonConversationExecutionRuntimeWorkspace =
  z.infer<OpenMeldDaemonConversationExecutionRuntimeWorkspaceSchema>;
export type OpenMeldDaemonControlTargetSelector =
  z.infer<OpenMeldDaemonControlTargetSelectorSchema>;
export type OpenMeldDaemonCancelPayload =
  z.infer<OpenMeldDaemonCancelPayloadSchema>;
export type OpenMeldDaemonCancelRequestPayload =
  z.infer<OpenMeldDaemonCancelRequestPayloadSchema>;
export type OpenMeldDaemonHealthPayload =
  z.infer<OpenMeldDaemonHealthPayloadSchema>;
export type OpenMeldDaemonHistoryEntry =
  z.infer<OpenMeldDaemonHistoryEntrySchema>;
export type OpenMeldDaemonInterruptRequestPayload =
  z.infer<OpenMeldDaemonInterruptRequestPayloadSchema>;
export type OpenMeldDaemonInterruptPayload =
  z.infer<OpenMeldDaemonInterruptPayloadSchema>;
export type OpenMeldDaemonShutdownRequestPayload =
  z.infer<OpenMeldDaemonShutdownRequestPayloadSchema>;
export type OpenMeldDaemonStatusPayload =
  z.infer<OpenMeldDaemonStatusPayloadSchema>;
