import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  type CloudComputerOperation,
  cloudComputerCommandErrorSchema,
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
  const operation = resolvePersonalComputerOperation(request.operation);
  const result = await execute({ computer, operation });
  return cloudComputerResponseSchema.parse({
    computer,
    result,
    observedAtMs: Date.now(),
  });
}

/** Legacy CLI keys live in local:. A returned receipt addresses its exact
 * invocation on this account's Computer; it grants no account access. */
export function resolvePersonalComputerOperation(
  operation: CloudComputerOperation
): CloudComputerOperation {
  if (operation.action !== "command") {
    return operation;
  }
  const command = operation.command;
  if ("reference" in command && command.reference) {
    const reference = command.reference;
    if (
      reference.invocationId !== operation.invocationId ||
      reference.key !== command.key
    ) {
      const failure = cloudComputerCommandErrorSchema.parse({
        status: 400,
        code: "computer.command_reference_mismatch",
        message:
          "Use the invocation and key from the original command reference.",
      });
      throw Object.assign(
        new Error(
          `HTTP 400: ${JSON.stringify({ ok: false, error: failure })}`,
          { cause: failure }
        ),
        { code: failure.code, status: failure.status }
      );
    }
    return operation;
  }
  return { ...operation, invocationId: `local:${operation.invocationId}` };
}
