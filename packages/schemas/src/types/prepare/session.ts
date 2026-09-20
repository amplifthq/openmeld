import type { z } from "zod/v4";

export type PrepareSessionContinuation = z.infer<
  typeof import("../../schemas/prepare/session")["prepareSessionContinuationSchema"]
>;

export type PrepareBlocker = z.infer<
  typeof import("../../schemas/prepare/session")["prepareBlockerSchema"]
>;
export type PrepareDiagnosticResponse = z.infer<
  typeof import("../../schemas/prepare/session")["prepareDiagnosticResponseSchema"]
>;
export type PrepareOpaqueToken = z.infer<
  typeof import("../../schemas/prepare/session")["prepareOpaqueTokenSchema"]
>;
export type PrepareStepDiagnosticsBundle = z.infer<
  typeof import("../../schemas/prepare/session")["prepareStepDiagnosticsBundleSchema"]
>;
export type PrepareSessionEvent = z.infer<
  typeof import("../../schemas/prepare/session")["prepareSessionEventSchema"]
>;
export type PrepareSessionLifecycleStatus = z.infer<
  typeof import("../../schemas/prepare/session")["prepareSessionLifecycleStatusSchema"]
>;
export type PrepareLocalAgentCatalog = z.infer<
  typeof import("../../schemas/prepare/session")["prepareLocalAgentCatalogSchema"]
>;
export type PrepareLocalReadinessSnapshot = z.infer<
  typeof import("../../schemas/prepare/session")["prepareLocalReadinessSnapshotSchema"]
>;
export type PrepareSessionPhase = z.infer<
  typeof import("../../schemas/prepare/session")["prepareSessionPhaseSchema"]
>;
export type PrepareSessionSnapshot = z.infer<
  typeof import("../../schemas/prepare/session")["prepareSessionSnapshotSchema"]
>;
export type PrepareSessionResponse = z.infer<
  typeof import("../../schemas/prepare/session")["prepareSessionResponseSchema"]
>;
export type PrepareSessionStreamClientFrame = z.infer<
  typeof import("../../schemas/prepare/session")["prepareSessionStreamClientFrameSchema"]
>;
export type PrepareSessionStreamRole = z.infer<
  typeof import("../../schemas/prepare/session")["prepareSessionStreamRoleSchema"]
>;
export type PrepareSessionStreamServerFrame = z.infer<
  typeof import("../../schemas/prepare/session")["prepareSessionStreamServerFrameSchema"]
>;
export type PrepareSessionWithTokenResponse = z.infer<
  typeof import("../../schemas/prepare/session")["prepareSessionWithTokenResponseSchema"]
>;
export type PrepareSetupBootstrapProfileSummary = z.infer<
  typeof import("../../schemas/prepare/session")["prepareSetupBootstrapProfileSummarySchema"]
>;
export type PrepareSetupBootstrapFacts = z.infer<
  typeof import("../../schemas/prepare/session")["prepareSetupBootstrapFactsSchema"]
>;
export type PrepareSetupBootstrapResult = z.infer<
  typeof import("../../schemas/prepare/session")["prepareSetupBootstrapResultSchema"]
>;
export type PrepareSetupBootstrapStep = z.infer<
  typeof import("../../schemas/prepare/session")["prepareSetupBootstrapStepSchema"]
>;
export type PrepareSetupBootstrapWrite = z.infer<
  typeof import("../../schemas/prepare/session")["prepareSetupBootstrapWriteSchema"]
>;
export type PrepareStep = z.infer<
  typeof import("../../schemas/prepare/session")["prepareStepSchema"]
>;
export type PrepareStepId = z.infer<
  typeof import("../../schemas/prepare/session")["prepareStepIdSchema"]
>;
export type PrepareStepState = z.infer<
  typeof import("../../schemas/prepare/session")["prepareStepStateSchema"]
>;
export type PrepareTerminalConnection = z.infer<
  typeof import("../../schemas/prepare/session")["prepareTerminalConnectionSchema"]
>;
export type CreatePrepareSessionRequest = z.infer<
  typeof import("../../schemas/prepare/session")["createPrepareSessionRequestSchema"]
>;
export type CreatePrepareSessionResponse = z.infer<
  typeof import("../../schemas/prepare/session")["createPrepareSessionResponseSchema"]
>;
export type TerminalStepWrite = z.infer<
  typeof import("../../schemas/prepare/session")["terminalStepWriteSchema"]
>;
export type TerminalLocalAgentCatalogWrite = z.infer<
  typeof import("../../schemas/prepare/session")["terminalLocalAgentCatalogWriteSchema"]
>;
export type TerminalAgentSelectionWrite = z.infer<
  typeof import("../../schemas/prepare/session")["terminalAgentSelectionWriteSchema"]
>;
export type WebAgentSelectionWrite = z.infer<
  typeof import("../../schemas/prepare/session")["webAgentSelectionWriteSchema"]
>;
