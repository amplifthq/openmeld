import type { z } from "zod/v4";
import type {
  localAgentUpdateOperationSchema,
  localAgentUpdateRequestSchema,
  localAgentUpdateStateSchema,
} from "../../schemas/daemon/local-agent-update";

export type LocalAgentUpdateOperation = z.infer<
  typeof localAgentUpdateOperationSchema
>;
export type LocalAgentUpdateRequest = z.infer<
  typeof localAgentUpdateRequestSchema
>;
export type LocalAgentUpdateState = z.infer<typeof localAgentUpdateStateSchema>;
