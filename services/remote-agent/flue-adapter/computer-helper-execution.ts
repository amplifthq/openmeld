import type { ShellResult } from "@flue/runtime";
import {
  cloudComputerCommandSchema,
  cloudComputerOperationResultSchema,
} from "@openmeld/schemas";
import { digestCanonicalJson } from "@openmeld/utils";
import type { AgentComputerWorkspaceAccess } from "./agent-computer-workspace-access";

export type ComputerHelperExecutionOptions = {
  backend?: string;
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  receiptScope?: string;
};

type HelperResult = ReturnType<typeof cloudComputerOperationResultSchema.parse>;
async function collectHelperResult(input: {
  invoke: (command: unknown) => Promise<HelperResult>;
  result: HelperResult;
  key: string;
  signal: AbortSignal;
}): Promise<ShellResult> {
  let result = input.result;
  let after = 0;
  let stdout = "";
  let stderr = "";
  for (;;) {
    input.signal.throwIfAborted();
    if (Array.isArray(result) || !("status" in result)) {
      throw new Error("computer.invalid_command_result");
    }
    stdout = (stdout + (result.stdout ?? "")).slice(-50_000);
    stderr = (stderr + (result.stderr ?? "")).slice(-50_000);
    after = result.after ?? after;
    if (result.syncError || result.nextAction === "inspect") {
      throw new Error(
        `computer.helper_sync_unconfirmed: ${JSON.stringify({ reference: result.reference, code: result.syncError, skipped: result.syncSkipped })}`
      );
    }
    if (result.status === "completed" && typeof result.exitCode === "number") {
      return { stdout, stderr, exitCode: result.exitCode };
    }
    result = await input.invoke({
      action: "poll",
      key: input.key,
      after,
      waitSeconds: 1,
    });
  }
}

/** Trusted Git/video helpers use the same receipts and collector as model
 * commands. An uncertain earlier helper for this resource cannot be replayed. */
export async function executeComputerHelper(input: {
  workspaceAccess: AgentComputerWorkspaceAccess;
  invocationId: string;
  command: string;
  options?: ComputerHelperExecutionOptions;
}): Promise<ShellResult> {
  const operation = input.workspaceAccess.computerOperation;
  if (!operation) {
    throw new Error("computer.operations_unavailable");
  }
  const options = input.options;
  const signal = options?.signal
    ? AbortSignal.any([
        options.signal,
        AbortSignal.timeout(options.timeoutMs ?? 120_000),
      ])
    : AbortSignal.timeout(options?.timeoutMs ?? 120_000);
  signal.throwIfAborted();
  const prefix = `helper:${await digestCanonicalJson(options?.receiptScope ?? { command: input.command, cwd: options?.cwd, env: options?.env, backend: options?.backend })}:`;
  const invoke = async (command: unknown) =>
    cloudComputerOperationResultSchema.parse(
      await operation({
        action: "command",
        invocationId: input.invocationId,
        cwd: options?.cwd,
        command: cloudComputerCommandSchema.parse(command),
      })
    );
  const receipts = await invoke({
    action: "list",
    includeReceiptDetails: true,
  });
  if (!Array.isArray(receipts)) {
    throw new Error("computer.invalid_command_receipts");
  }
  const owned = receipts.filter((receipt) => receipt.key.startsWith(prefix));
  const unresolved = owned.find((receipt) => receipt.phase !== "completed");
  if (unresolved) {
    throw new Error(
      `computer.helper_result_unconfirmed: Inspect the original command ${JSON.stringify(unresolved.reference)} before retrying this operation. It was not restarted.`
    );
  }
  const key = prefix + owned.length;
  let acknowledged = false;
  try {
    signal.throwIfAborted();
    const result = await invoke({
      action: "start",
      key,
      command: input.command,
      backend: options?.backend ?? "worker-shell",
      env: options?.env,
      timeoutSeconds: Math.max(
        1,
        Math.ceil((options?.timeoutMs ?? 120_000) / 1000)
      ),
    });
    acknowledged = true;
    return await collectHelperResult({ invoke, result, key, signal });
  } catch (error) {
    if (!acknowledged) {
      // A rejected same-key contender has no authority to stop the winner.
      // A lost launch acknowledgement remains owned by the durable receipt;
      // finish/Stop and the collector inspect that original invocation.
      throw new Error(
        `computer.helper_result_unconfirmed: invocation ${input.invocationId}, key ${key}. Inspect the original receipt; it was not restarted.`,
        { cause: error }
      );
    }
    // Stop is an intent. Receipt collection remains live after this helper
    // returns; neither a lost reply nor a kill acknowledgement proves exit.
    try {
      await invoke({ action: "stop", key });
    } catch (stopError) {
      throw new AggregateError(
        [error, stopError],
        `computer.helper_result_unconfirmed: invocation ${input.invocationId}, key ${key}. Inspect the original receipt; it was not restarted.`
      );
    }
    throw new Error(
      `computer.helper_result_unconfirmed: invocation ${input.invocationId}, key ${key}. Stop was requested; inspect the original receipt before retrying.`,
      { cause: error }
    );
  }
}
