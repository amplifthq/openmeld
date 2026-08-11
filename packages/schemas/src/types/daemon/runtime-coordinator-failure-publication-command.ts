import type { z } from "zod/v4";
import type {
  runtimeCoordinatorFailurePublicationCommandSchema,
  runtimeCoordinatorFailurePublicationFinalMessageKindSchema,
  runtimeCoordinatorFailurePublicationOutcomeSchema,
} from "../../schemas/daemon/runtime-coordinator-failure-publication-command";

export type RuntimeCoordinatorFailurePublicationCommand = z.infer<
  typeof runtimeCoordinatorFailurePublicationCommandSchema
>;

export type RuntimeCoordinatorFailurePublicationFinalMessageKind = z.infer<
  typeof runtimeCoordinatorFailurePublicationFinalMessageKindSchema
>;

export type RuntimeCoordinatorFailurePublicationOutcome = z.infer<
  typeof runtimeCoordinatorFailurePublicationOutcomeSchema
>;
