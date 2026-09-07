import type { z } from "zod/v4";
import type {
  remoteAgentWorkerExecutionInputQuerySchema,
  remoteAgentWorkerExecutionInputReceiptSchema,
  remoteAgentWorkerExecutionInputRequestSchema,
  remoteAgentWorkerExecutionInputResponseSchema,
} from "../../schemas/runtime/remote-agent-execution-input";

export type RemoteAgentWorkerExecutionInputRequest = z.infer<
  typeof remoteAgentWorkerExecutionInputRequestSchema
>;
export type RemoteAgentWorkerExecutionInputQuery = z.infer<
  typeof remoteAgentWorkerExecutionInputQuerySchema
>;
export type RemoteAgentWorkerExecutionInputReceipt = z.infer<
  typeof remoteAgentWorkerExecutionInputReceiptSchema
>;
export type RemoteAgentWorkerExecutionInputResponse = z.infer<
  typeof remoteAgentWorkerExecutionInputResponseSchema
>;
