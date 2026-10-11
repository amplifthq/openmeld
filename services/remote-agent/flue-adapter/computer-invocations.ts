import {
  type CloudComputerInvocationState,
  cloudComputerInvocationOwnerSchema,
  cloudComputerRecoveryQuerySchema,
  cloudComputerRecoveryResultSchema,
} from "@openmeld/schemas";
import type { RemoteAgentStorage } from "../agent-core/callback-context";
import { readStoredComputerInvocation } from "./computer-command";
import {
  COMPUTER_INVOCATION_OWNER_PREFIX,
  type ComputerCommandSqlStorage,
} from "./computer-command-storage";

const ownerKey = (id: string) =>
  COMPUTER_INVOCATION_OWNER_PREFIX + encodeURIComponent(id);

export async function registerComputerInvocation(
  storage: RemoteAgentStorage,
  value: unknown
) {
  const owner = cloudComputerInvocationOwnerSchema.parse(value);
  const key = ownerKey(owner.invocationId);
  await storage.putIfAbsent(key, owner);
  const previous = cloudComputerInvocationOwnerSchema.parse(
    await storage.get(key)
  );
  if (
    previous.organizationId !== owner.organizationId ||
    previous.spaceId !== owner.spaceId ||
    previous.agentProfileId !== owner.agentProfileId
  ) {
    throw new Error("computer.recovery_identity_mismatch");
  }
}

export async function readComputerRecovery(
  storage: ComputerCommandSqlStorage,
  value: unknown
) {
  const query = cloudComputerRecoveryQuerySchema.parse(value);
  const exact = query.invocationId
    ? await storage.get(ownerKey(query.invocationId))
    : undefined;
  if (query.invocationId && !exact) {
    throw new Error("computer.recovery_identity_mismatch");
  }
  const owners = query.invocationId
    ? [cloudComputerInvocationOwnerSchema.parse(exact)]
    : storage.listInvocationOwners(query);
  const invocations: CloudComputerInvocationState[] = [];
  for (const owner of owners.slice(0, 32)) {
    if (
      owner.organizationId !== query.organizationId ||
      owner.spaceId !== query.spaceId ||
      owner.agentProfileId !== query.agentProfileId
    ) {
      throw new Error("computer.recovery_identity_mismatch");
    }
    invocations.push(
      await readStoredComputerInvocation({
        storage,
        context: { submissionId: owner.invocationId },
      })
    );
  }
  return cloudComputerRecoveryResultSchema.parse({
    invocations,
    nextCursor: owners.length > 32 ? owners[31]?.invocationId : null,
  });
}
