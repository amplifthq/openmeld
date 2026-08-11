import type { z } from "zod/v4";

type SpaceDispatchTraceAttemptStatusSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceAttemptStatusSchema"];
type SpaceDispatchTraceDispatchExecutionSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceDispatchExecutionSchema"];
type SpaceDispatchTraceExecutionIdentitySchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceExecutionIdentitySchema"];
type SpaceDispatchTraceRuntimeCoordinatorCreationDiagnosticSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceRuntimeCoordinatorCreationDiagnosticSchema"];
type SpaceDispatchTraceRuntimeCoordinatorExecutionSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceRuntimeCoordinatorExecutionSchema"];
type SpaceDispatchTraceRuntimeCoordinatorEventSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceRuntimeCoordinatorEventSchema"];
type SpaceDispatchTraceRuntimeCoordinatorHeadLifecycleSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceRuntimeCoordinatorHeadLifecycleSchema"];
type SpaceDispatchTraceClaimLeaseSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceClaimLeaseSchema"];
type SpaceDispatchTraceDispatchSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceDispatchSchema"];
type SpaceDispatchTraceDispatchStatusSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceDispatchStatusSchema"];
type SpaceDispatchTraceFinalVisibleMessageFactSourceSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceFinalVisibleMessageFactSourceSchema"];
type SpaceDispatchTraceFinalVisibleMessageLinkageSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceFinalVisibleMessageLinkageSchema"];
type SpaceDispatchTraceFinalVisibleMessageLinkageSourceFactSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceFinalVisibleMessageLinkageSourceFactSchema"];
type SpaceDispatchTraceFinalVisibleMessageLinkageStatusSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceFinalVisibleMessageLinkageStatusSchema"];
type SpaceDispatchTraceFinalVisibleMessageSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceFinalVisibleMessageSchema"];
type SpaceDispatchTraceFinalVisibleOutcomePublicationKindSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceFinalVisibleOutcomePublicationKindSchema"];
type SpaceDispatchTraceFinalVisibleOutcomeSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceFinalVisibleOutcomeSchema"];
type SpaceDispatchTraceFinalVisibleOutcomeSourceFactSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceFinalVisibleOutcomeSourceFactSchema"];
type SpaceDispatchTraceFinalVisibleOutcomeStatusSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceFinalVisibleOutcomeStatusSchema"];
type SpaceDispatchTraceLatestAttemptSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceLatestAttemptSchema"];
type SpaceDispatchTraceOpsDecisionSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceOpsDecisionSchema"];
type SpaceDispatchTraceQuerySchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceQuerySchema"];
type SpaceDispatchTraceReplySignalSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceReplySignalSchema"];
type SpaceDispatchTraceResponseSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceResponseSchema"];
type SpaceDispatchTraceResultInboxPublishStateSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceResultInboxPublishStateSchema"];
type SpaceDispatchTraceResultInboxSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceResultInboxSchema"];
type SpaceDispatchTraceResultSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceResultSchema"];
type SpaceDispatchTraceSnapshotSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceSnapshotSchema"];
type SpaceDispatchTraceStreamingSchema =
  typeof import("../../schemas/http/space-dispatch-trace")["spaceDispatchTraceStreamingSchema"];

export type SpaceDispatchTraceAttemptStatus =
  z.infer<SpaceDispatchTraceAttemptStatusSchema>;
export type SpaceDispatchTraceDispatchExecution =
  z.infer<SpaceDispatchTraceDispatchExecutionSchema>;
export type SpaceDispatchTraceExecutionIdentity =
  z.infer<SpaceDispatchTraceExecutionIdentitySchema>;
export type SpaceDispatchTraceRuntimeCoordinatorCreationDiagnostic =
  z.infer<SpaceDispatchTraceRuntimeCoordinatorCreationDiagnosticSchema>;
export type SpaceDispatchTraceRuntimeCoordinatorExecution =
  z.infer<SpaceDispatchTraceRuntimeCoordinatorExecutionSchema>;
export type SpaceDispatchTraceRuntimeCoordinatorEvent =
  z.infer<SpaceDispatchTraceRuntimeCoordinatorEventSchema>;
export type SpaceDispatchTraceRuntimeCoordinatorHeadLifecycle =
  z.infer<SpaceDispatchTraceRuntimeCoordinatorHeadLifecycleSchema>;
export type SpaceDispatchTraceClaimLease =
  z.infer<SpaceDispatchTraceClaimLeaseSchema>;
export type SpaceDispatchTraceDispatch =
  z.infer<SpaceDispatchTraceDispatchSchema>;
export type SpaceDispatchTraceDispatchStatus =
  z.infer<SpaceDispatchTraceDispatchStatusSchema>;
export type SpaceDispatchTraceFinalVisibleMessageFactSource =
  z.infer<SpaceDispatchTraceFinalVisibleMessageFactSourceSchema>;
export type SpaceDispatchTraceFinalVisibleMessageLinkage =
  z.infer<SpaceDispatchTraceFinalVisibleMessageLinkageSchema>;
export type SpaceDispatchTraceFinalVisibleMessageLinkageSourceFact =
  z.infer<SpaceDispatchTraceFinalVisibleMessageLinkageSourceFactSchema>;
export type SpaceDispatchTraceFinalVisibleMessageLinkageStatus =
  z.infer<SpaceDispatchTraceFinalVisibleMessageLinkageStatusSchema>;
export type SpaceDispatchTraceFinalVisibleMessage =
  z.infer<SpaceDispatchTraceFinalVisibleMessageSchema>;
export type SpaceDispatchTraceFinalVisibleOutcome =
  z.infer<SpaceDispatchTraceFinalVisibleOutcomeSchema>;
export type SpaceDispatchTraceFinalVisibleOutcomePublicationKind =
  z.infer<SpaceDispatchTraceFinalVisibleOutcomePublicationKindSchema>;
export type SpaceDispatchTraceFinalVisibleOutcomeSourceFact =
  z.infer<SpaceDispatchTraceFinalVisibleOutcomeSourceFactSchema>;
export type SpaceDispatchTraceFinalVisibleOutcomeStatus =
  z.infer<SpaceDispatchTraceFinalVisibleOutcomeStatusSchema>;
export type SpaceDispatchTraceLatestAttempt =
  z.infer<SpaceDispatchTraceLatestAttemptSchema>;
export type SpaceDispatchTraceOpsDecision =
  z.infer<SpaceDispatchTraceOpsDecisionSchema>;
export type SpaceDispatchTraceQuery = z.infer<SpaceDispatchTraceQuerySchema>;
export type SpaceDispatchTraceReplySignal =
  z.infer<SpaceDispatchTraceReplySignalSchema>;
export type SpaceDispatchTraceResponse =
  z.infer<SpaceDispatchTraceResponseSchema>;
export type SpaceDispatchTraceResultInboxPublishState =
  z.infer<SpaceDispatchTraceResultInboxPublishStateSchema>;
export type SpaceDispatchTraceResultInbox =
  z.infer<SpaceDispatchTraceResultInboxSchema>;
export type SpaceDispatchTraceResult = z.infer<SpaceDispatchTraceResultSchema>;
export type SpaceDispatchTraceSnapshot =
  z.infer<SpaceDispatchTraceSnapshotSchema>;
export type SpaceDispatchTraceStreaming =
  z.infer<SpaceDispatchTraceStreamingSchema>;
