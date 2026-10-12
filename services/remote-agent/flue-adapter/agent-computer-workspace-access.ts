import { setTimeout as delay } from "node:timers/promises";
import { getWorkspace, type WorkspaceClient } from "@cloudflare/computer";
import {
  type CloudComputerOperation,
  cloudComputerOperationResultSchema,
  type PluginConnectionGrant,
  type RemoteAgentGitPackStart,
  type RemoteAgentGitPackStatus,
  type RemoteAgentGitTransferGrant,
  remoteAgentGitPackStatusSchema,
} from "@openmeld/schemas";
import type { RemoteAgentCallbackContext } from "../agent-core/callback-context";
import { createAgentComputerFileHandoff } from "./computer-file-handoff";
import { ensureAgentComputerLayout } from "./computer-workspace-config";
import { createMemberProfileReportComputerFileStore } from "./member-profile-report-computer-files";
import type { OrganizationDocumentsComputerSnapshot } from "./organization-document-computer-snapshot";
import {
  createOrganizationDocumentComputerWorkingCopyStore,
  type OrganizationDocumentComputerWorkingCopyStore,
} from "./organization-document-computer-working-copies";

const AGENT_COMPUTER_MATERIALIZATION_MAX_ATTEMPTS = 2;

export type AgentComputerNamespace = {
  get(id: DurableObjectId): DurableObjectStub;
  idFromName(name: string): DurableObjectId;
};

export type AgentComputerWorkspaceAccess = {
  registerPluginConnectionGrant?(grant: PluginConnectionGrant): Promise<void>;
  computerOperation?(request: CloudComputerOperation): Promise<unknown>;
  writeComputerFile?(path: string, content: string | Uint8Array): Promise<void>;
  withWorkspace<T>(
    operation: (workspace: WorkspaceClient) => Promise<T>
  ): Promise<T>;
  registerGitTransferGrant?(grant: RemoteAgentGitTransferGrant): Promise<void>;
  startGitPackTransfer?(
    request: RemoteAgentGitPackStart
  ): Promise<RemoteAgentGitPackStatus>;
};

/**
 * Keep the durable computer identity stable while acquiring a new RPC client
 * for each logical operation. The caller owns the operation; this boundary
 * owns and always disposes the remote Workspace stub.
 */
export function createAgentComputerWorkspaceAccess(input: {
  computerId: DurableObjectId;
  namespace: AgentComputerNamespace;
  authorize?: () => Promise<unknown>;
}): AgentComputerWorkspaceAccess {
  return {
    async registerPluginConnectionGrant(grant) {
      await input.authorize?.();
      const stub = input.namespace.get(input.computerId) as DurableObjectStub<
        import("./computer-workspace").AgentComputer
      >;
      await stub.registerPluginConnectionGrant(grant);
      await input.authorize?.();
    },
    async computerOperation(request) {
      const waitMs =
        request.action === "command" && request.command.action === "poll"
          ? (request.command.waitSeconds ?? 0) * 1000
          : 0;
      const deadline = Date.now() + waitMs;
      let operation = request;
      for (;;) {
        await input.authorize?.();
        const stub = input.namespace.get(input.computerId) as DurableObjectStub<
          import("./computer-workspace").AgentComputer
        >;
        // Each RPC advances one bounded preparation step. Waiting belongs to
        // this caller, so a large tree cannot drain inside one Computer event.
        const result = await stub.computerOperation(operation);
        await input.authorize?.();
        const parsed = cloudComputerOperationResultSchema.safeParse(result);
        if (
          operation.action !== "command" ||
          operation.command.action !== "poll" ||
          !parsed.success ||
          Array.isArray(parsed.data) ||
          !("phase" in parsed.data) ||
          parsed.data.phase !== "accepted" ||
          !("reference" in parsed.data) ||
          !parsed.data.reference ||
          Date.now() >= deadline
        ) {
          return result;
        }
        await delay(Math.min(250, deadline - Date.now()));
        if (Date.now() >= deadline) {
          return result;
        }
        operation = {
          ...operation,
          command: {
            ...operation.command,
            reference: parsed.data.reference,
            waitSeconds: Math.min(
              20,
              Math.ceil((deadline - Date.now()) / 1000)
            ),
          },
        };
      }
    },
    async writeComputerFile(path, content) {
      await input.authorize?.();
      const stub = input.namespace.get(input.computerId) as DurableObjectStub<
        import("./computer-workspace").AgentComputer
      >;
      await stub.writeComputerFile(path, content);
      await input.authorize?.();
    },
    async startGitPackTransfer(request) {
      await input.authorize?.();
      const stub = input.namespace.get(input.computerId) as DurableObjectStub<
        import("./computer-workspace").AgentComputer
      >;
      const status = remoteAgentGitPackStatusSchema.parse(
        await stub.startGitPackTransfer(request)
      );
      await input.authorize?.();
      return status;
    },
    async registerGitTransferGrant(grant) {
      await input.authorize?.();
      const stub = input.namespace.get(input.computerId) as DurableObjectStub<
        import("./computer-workspace").AgentComputer
      >;
      await stub.registerGitTransferGrant(grant);
      await input.authorize?.();
    },
    async withWorkspace(operation) {
      await input.authorize?.();
      const stub = input.namespace.get(input.computerId);
      using workspace = await getWorkspace(
        stub as unknown as Parameters<typeof getWorkspace>[0]
      );
      const result = await operation(workspace);
      // A permission revoked during a read must not release its bytes after the
      // authorization boundary has closed. This never reruns the operation.
      await input.authorize?.();
      return result;
    },
  };
}

export function createFixedAgentComputerWorkspaceAccess(
  workspace: WorkspaceClient
): AgentComputerWorkspaceAccess {
  // The caller supplied this client and therefore retains disposal ownership.
  return {
    withWorkspace: async (operation) => await operation(workspace),
  };
}

export async function materializeAgentComputerWorkspace(input: {
  context: RemoteAgentCallbackContext;
  workspaceAccess: AgentComputerWorkspaceAccess;
}): Promise<{
  workingDirectory: string;
}> {
  let lastError: unknown;
  for (
    let attempt = 1;
    attempt <= AGENT_COMPUTER_MATERIALIZATION_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await input.workspaceAccess.withWorkspace(async (workspace) => {
        const { workingDirectory } = await ensureAgentComputerLayout(
          workspace,
          {
            taskId: input.context.submissionId,
            conversationId: input.context.conversationId ?? null,
            routineId: resolveComputerRoutineId(input.context),
            spaceId: input.context.spaceId ?? null,
          }
        );
        return { workingDirectory };
      });
    } catch (error) {
      lastError = error;
      if (attempt < AGENT_COMPUTER_MATERIALIZATION_MAX_ATTEMPTS) {
        console.warn("[remote_agent.computer_workspace_reacquiring]", {
          attempt,
          errorName: error instanceof Error ? error.name : "UnknownError",
          maxAttempts: AGENT_COMPUTER_MATERIALIZATION_MAX_ATTEMPTS,
          submissionId: input.context.submissionId,
        });
      }
    }
  }
  throw lastError;
}

export function createReacquiringAgentComputerFileHandoff(input: {
  workspaceAccess: AgentComputerWorkspaceAccess;
  workingDirectory: string;
}): ReturnType<typeof createAgentComputerFileHandoff> {
  return {
    readBinaryFile: async (path) =>
      await input.workspaceAccess.withWorkspace(
        async (workspace) =>
          await createAgentComputerFileHandoff({
            workspace,
            workingDirectory: input.workingDirectory,
          }).readBinaryFile(path)
      ),
    readTextFiles: async (paths) =>
      await input.workspaceAccess.withWorkspace(
        async (workspace) =>
          await createAgentComputerFileHandoff({
            workspace,
            workingDirectory: input.workingDirectory,
          }).readTextFiles(paths)
      ),
    writeChannelFile: async (file) =>
      await input.workspaceAccess.withWorkspace(
        async (workspace) =>
          await createAgentComputerFileHandoff({
            workspace,
            workingDirectory: input.workingDirectory,
          }).writeChannelFile(file)
      ),
  };
}

export function createReacquiringOrganizationDocumentWorkingCopyStore(input: {
  projection: OrganizationDocumentsComputerSnapshot;
  workspaceAccess: AgentComputerWorkspaceAccess;
  workingDirectory: string;
}): OrganizationDocumentComputerWorkingCopyStore {
  return {
    checkout: async (documentId) =>
      await input.workspaceAccess.withWorkspace(
        async (workspace) =>
          await createOrganizationDocumentComputerWorkingCopyStore({
            projection: input.projection,
            workspace,
            workingDirectory: input.workingDirectory,
          }).checkout(documentId)
      ),
    read: async (path) =>
      await input.workspaceAccess.withWorkspace(
        async (workspace) =>
          await createOrganizationDocumentComputerWorkingCopyStore({
            projection: input.projection,
            workspace,
            workingDirectory: input.workingDirectory,
          }).read(path)
      ),
  };
}

export function createReacquiringMemberProfileReportFileStore(input: {
  workspaceAccess: AgentComputerWorkspaceAccess;
}): ReturnType<typeof createMemberProfileReportComputerFileStore> {
  return {
    write: async (report) =>
      await input.workspaceAccess.withWorkspace(
        async (workspace) =>
          await createMemberProfileReportComputerFileStore({ workspace }).write(
            report
          )
      ),
  };
}

function resolveComputerRoutineId(
  context: RemoteAgentCallbackContext
): string | null {
  return context.turnEnvelope?.trigger.source === "routine"
    ? context.turnEnvelope.trigger.routineId
    : null;
}
