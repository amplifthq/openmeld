import type { z } from "zod/v4";

type ReconcileDeletedAgentProfileRequestSchema =
  typeof import("../../schemas/http/agent-profile-lifecycle")["reconcileDeletedAgentProfileRequestSchema"];
type ReconcileDeletedAgentProfileResponseSchema =
  typeof import("../../schemas/http/agent-profile-lifecycle")["reconcileDeletedAgentProfileResponseSchema"];
type ReconcileDeletedAgentProfileSpaceOutcomeSchema =
  typeof import("../../schemas/http/agent-profile-lifecycle")["reconcileDeletedAgentProfileSpaceOutcomeSchema"];

export type ReconcileDeletedAgentProfileRequest =
  z.infer<ReconcileDeletedAgentProfileRequestSchema>;
export type ReconcileDeletedAgentProfileResponse =
  z.infer<ReconcileDeletedAgentProfileResponseSchema>;
export type ReconcileDeletedAgentProfileSpaceOutcome =
  z.infer<ReconcileDeletedAgentProfileSpaceOutcomeSchema>;
