import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  cloudComputerResponseSchema,
  cloudComputerRpcRequestSchema,
} from "@openmeld/schemas";
import type { CoreBindings } from "../lib/bindings";
import { requireAuthenticatedOwnerUserId } from "../rpc/methods";
import { ensurePersonalComputer } from "./personal-computer";

export async function personalComputerRpc(env: CoreBindings, value: unknown) {
  const request = cloudComputerRpcRequestSchema.parse(value);
  const ownerUserId = requireAuthenticatedOwnerUserId(request.context);
  const computer = await ensurePersonalComputer(
    getPostgresDatabase(env),
    ownerUserId
  );
  if (!request.operation) {
    return cloudComputerResponseSchema.parse({
      computer,
      observedAtMs: Date.now(),
    });
  }
  const execute = env.OPENMELD_REMOTE_AGENT_WORKER?.cloudComputerOperation;
  if (!execute) {
    throw new Error("computer.runtime_unavailable");
  }
  const operation =
    request.operation.action === "command"
      ? {
          ...request.operation,
          invocationId: `local:${request.operation.invocationId}`,
        }
      : request.operation;
  const result = await execute({ computer, operation });
  return cloudComputerResponseSchema.parse({
    computer,
    result,
    observedAtMs: Date.now(),
  });
}
