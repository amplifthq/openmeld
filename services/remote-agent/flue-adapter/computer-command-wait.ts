import { setTimeout as delay } from "node:timers/promises";
import {
  type CloudComputerOperation,
  cloudComputerOperationResultSchema,
} from "@openmeld/schemas";

export async function executeAgentComputerCommand(input: {
  operation: Extract<CloudComputerOperation, { action: "command" }>;
  execute: (operation: CloudComputerOperation) => Promise<unknown>;
  signal?: AbortSignal;
  hasPendingInput?: () => Promise<boolean>;
}): Promise<unknown> {
  let operation = input.operation;
  for (;;) {
    input.signal?.throwIfAborted();
    const startedAt = Date.now();
    const result = await input.execute(operation);
    input.signal?.throwIfAborted();
    if (await input.hasPendingInput?.()) {
      return result;
    }
    // Only an Agent's explicit blocking poll waits here. Start remains exactly
    // once, and waitSeconds: 0 remains available for independent-work checks.
    if (
      operation.command.action !== "poll" ||
      operation.command.waitSeconds === 0
    ) {
      return result;
    }
    const parsed = cloudComputerOperationResultSchema.safeParse(result);
    if (
      !parsed.success ||
      Array.isArray(parsed.data) ||
      !("status" in parsed.data)
    ) {
      return result;
    }
    const command = parsed.data;
    if (
      !command.reference ||
      command.observation?.status === "timed_out" ||
      command.status === "stop_requested" ||
      command.phase === "completed" ||
      command.phase === "result_unavailable" ||
      command.syncError ||
      command.nextAction === "inspect" ||
      !command.collection ||
      (command.collection.nextAttemptAtMs === null &&
        (command.collection.observationExpiresAtMs ?? 0) <= Date.now())
    ) {
      return result;
    }
    // The Computer remains the receipt, recovery and Stop owner. Reacquire its
    // authorized RPC for each bounded read; never start or clean up a command.
    // Preserve the caller's output cursor so final output is not consumed by
    // intermediate reads that the model never saw.
    operation = {
      ...operation,
      command: {
        ...operation.command,
        reference: command.reference,
        waitSeconds: 20,
      },
    };
    const remaining = 1000 - (Date.now() - startedAt);
    if (remaining > 0) {
      await delay(remaining, undefined, { signal: input.signal });
    }
  }
}
