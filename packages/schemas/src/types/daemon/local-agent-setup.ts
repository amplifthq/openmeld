import type { z } from "zod/v4";
import type {
  localAgentSetupOperationSchema,
  localAgentSetupRequestSchema,
  localAgentSetupStateSchema,
} from "../../schemas/daemon/local-agent-setup";
export type LocalAgentSetupRequest = z.infer<
  typeof localAgentSetupRequestSchema
>;
export type LocalAgentSetupOperation = z.infer<
  typeof localAgentSetupOperationSchema
>;
export type LocalAgentSetupState = z.infer<typeof localAgentSetupStateSchema>;
