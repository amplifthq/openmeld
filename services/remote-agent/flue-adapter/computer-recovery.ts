import {
  type CloudComputerOperation,
  cloudComputerRecoveryResultSchema,
} from "@openmeld/schemas";
import { optional, parse, picklist, strictObject, string } from "valibot";
import {
  type RemoteAgentCallbackContext,
  type RemoteAgentStorage,
  readRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import type { AgentComputerNamespace } from "./agent-computer-workspace-access";
import {
  bindComputerCommandTarget,
  readBoundComputerName,
  readComputerTarget,
} from "./computer-command";
import type { AgentComputer } from "./computer-workspace";
import {
  type ComputerCleanupHandoff,
  listComputerCleanupHandoffs,
  readComputerFinishState,
  requestComputerCleanup,
} from "./execution-cleanup";

type RecoveryInput = {
  context: RemoteAgentCallbackContext;
  storage: RemoteAgentStorage;
  env: { AGENT_COMPUTER?: unknown };
  computerName?: string;
};

/** An original invocation/key is also a recovery address when a launch reply
 * was lost. It needs the same scope check as a complete command reference. */
export async function authorizeComputerObservation(
  input: Omit<RecoveryInput, "storage"> & {
    storage?: RemoteAgentStorage;
    operation: CloudComputerOperation;
  }
): Promise<CloudComputerOperation> {
  const operation = input.operation;
  if (
    operation.action !== "command" ||
    operation.command.action === "start" ||
    operation.command.action === "list"
  ) {
    return operation;
  }
  const invocationId =
    operation.command.reference?.invocationId ?? operation.invocationId;
  if (invocationId === input.context.submissionId) {
    return { ...operation, invocationId };
  }
  if (!input.storage) {
    throw new Error("computer.recovery_storage_unavailable");
  }
  const original = await requireComputerRecoveryContext({
    ...input,
    storage: input.storage,
    invocationId,
  });
  return { ...operation, invocationId: original.submissionId };
}

async function readRecoveryTarget(input: RecoveryInput) {
  if (!input.computerName) {
    return await readComputerTarget(input);
  }
  if (!input.env.AGENT_COMPUTER) {
    throw new Error("computer.binding_unavailable");
  }
  const namespace = input.env.AGENT_COMPUTER as AgentComputerNamespace;
  return namespace.get(
    namespace.idFromName(input.computerName)
  ) as DurableObjectStub<AgentComputer>;
}

// Recovery stays in this exact conversation and personal Computer. A reference
// copied from another Space/Agent/account does not grant authority over it.
export async function requireComputerRecoveryContext(
  input: RecoveryInput & { invocationId: string }
) {
  const previous = await readRemoteAgentCallbackContext(
    input.storage,
    input.invocationId
  );
  const currentComputer =
    input.computerName ??
    (await readBoundComputerName(input.storage, input.context.submissionId));
  if (!previous) {
    const target = await readRecoveryTarget(input);
    if (!(target && currentComputer)) {
      throw new Error("computer.recovery_identity_mismatch");
    }
    // Only the original Computer may resolve a reference across Flue rollover.
    // This is a receipt route, not a new execution or callback authority.
    const recovered = cloudComputerRecoveryResultSchema.parse(
      await target.readComputerRecovery({
        organizationId: input.context.organizationId,
        spaceId: input.context.spaceId,
        agentProfileId: input.context.agentProfileId,
        invocationId: input.invocationId,
      })
    );
    if (recovered.invocations[0]?.invocationId !== input.invocationId) {
      throw new Error("computer.recovery_identity_mismatch");
    }
    await bindComputerCommandTarget({
      storage: input.storage,
      submissionId: input.invocationId,
      computerName: currentComputer,
    });
    return {
      ...input.context,
      submissionId: input.invocationId,
      outputFiles: [],
      outputAttachments: [],
    };
  }
  if (
    previous.organizationId !== input.context.organizationId ||
    previous.spaceId !== input.context.spaceId ||
    previous.agentProfileId !== input.context.agentProfileId ||
    !currentComputer ||
    currentComputer !==
      (await readBoundComputerName(input.storage, previous.submissionId))
  ) {
    throw new Error("computer.recovery_identity_mismatch");
  }
  return previous;
}

export async function assertComputerMutationCanContinue(input: RecoveryInput) {
  const handoffs = await listComputerCleanupHandoffs(input.storage);
  for (const handoff of handoffs) {
    if (handoff.submissionId === input.context.submissionId) {
      throw new Error(
        "computer.invocation_stopped: Use computer_recovery to inspect or stop original commands. Continue independent non-Computer work if authorized."
      );
    }
  }
}

async function listLegacyComputerRecovery(input: RecoveryInput) {
  const results: ComputerCleanupHandoff[] = [];
  for (const handoff of (await listComputerCleanupHandoffs(input.storage))
    .slice(-32)
    .reverse()) {
    try {
      await requireComputerRecoveryContext({
        ...input,
        invocationId: handoff.submissionId,
      });
      results.push(handoff);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "computer.recovery_identity_mismatch"
      ) {
        throw error;
      }
      // References from another personal Computer are not disclosed.
    }
  }
  return results;
}

export function createComputerRecoveryTool(
  input: RecoveryInput & {
    authorize: () => Promise<unknown>;
  }
): RemoteAgentToolDefinition {
  const schema = strictObject({
    action: picklist(["list", "inspect", "stop"]),
    invocationId: optional(string()),
    cursor: optional(string()),
  });
  return {
    name: "computer_recovery",
    description:
      "Read retained Computer results and cleanup facts from this conversation. list returns original invocation IDs; inspect refreshes their original command receipts and saved file references. stop resumes bounded Stop delivery and observation for that exact invocation, including after its model reply finished. A Stop acknowledgement is not proof of exit. This never starts or replays a command. Use computer_command poll/stop with an exact returned reference to collect a retained result.",
    input: schema,
    async execute(value) {
      const request = parse(schema, value);
      await input.authorize();
      if (request.action === "list") {
        const target = await readRecoveryTarget(input);
        if (target) {
          const results = cloudComputerRecoveryResultSchema.parse(
            await target.readComputerRecovery({
              organizationId: input.context.organizationId,
              spaceId: input.context.spaceId,
              agentProfileId: input.context.agentProfileId,
              cursor: request.cursor,
            })
          );
          await input.authorize();
          return results;
        }
        const results = await listLegacyComputerRecovery(input);
        await input.authorize();
        return {
          invocations: results,
          note: "Snapshots are last-observed facts. Inspect an invocation before deciding whether to continue.",
        };
      }
      if (!request.invocationId) {
        throw new Error("computer.recovery_invocation_required");
      }
      const context = await requireComputerRecoveryContext({
        ...input,
        invocationId: request.invocationId,
      });
      const state =
        request.action === "stop"
          ? await requestComputerCleanup({ ...input, context, resume: true })
          : await readComputerFinishState({ ...input, context });
      await input.authorize();
      return {
        invocationId: context.submissionId,
        state,
        savedFiles: context.outputFiles ?? [],
        savedAttachments: context.outputAttachments ?? [],
      };
    },
  };
}
