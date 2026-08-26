import { getWorkspace, type WorkspaceClient } from "@cloudflare/computer";
import type { CenterAgentOrganizationDocumentsComputerSnapshotResponse } from "@openmeld/schemas/types";
import type { RemoteAgentCallbackContext } from "../agent-core/callback-context";
import { createAgentComputerFileHandoff } from "./computer-file-handoff";
import { ensureAgentComputerLayout } from "./computer-workspace";
import { createMemberProfileReportComputerFileStore } from "./member-profile-report-computer-files";
import {
  clearOrganizationDocumentsComputerProjection,
  materializeOrganizationDocumentsComputerProjection,
  type OrganizationDocumentsComputerProjection,
} from "./organization-document-computer-projection";
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
  withWorkspace<T>(
    operation: (workspace: WorkspaceClient) => Promise<T>
  ): Promise<T>;
};

/**
 * Keep the durable computer identity stable while acquiring a new RPC client
 * for each logical operation. The caller owns the operation; this boundary
 * owns and always disposes the remote Workspace stub.
 */
export function createAgentComputerWorkspaceAccess(input: {
  computerId: DurableObjectId;
  namespace: AgentComputerNamespace;
}): AgentComputerWorkspaceAccess {
  return {
    async withWorkspace(operation) {
      const stub = input.namespace.get(input.computerId);
      using workspace = await getWorkspace(
        stub as unknown as Parameters<typeof getWorkspace>[0]
      );
      return await operation(workspace);
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
  organizationDocumentsSnapshot: CenterAgentOrganizationDocumentsComputerSnapshotResponse | null;
  workspaceAccess: AgentComputerWorkspaceAccess;
}): Promise<{
  documents: Awaited<
    ReturnType<typeof materializeOrganizationDocumentsComputerProjection>
  > | null;
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
            conversationId: input.context.conversationId ?? null,
            routineId: resolveComputerRoutineId(input.context),
            spaceId: input.context.spaceId ?? null,
          }
        );
        const documents = input.organizationDocumentsSnapshot
          ? await materializeOrganizationDocumentsComputerProjection(
              workspace,
              input.organizationDocumentsSnapshot
            )
          : null;
        if (!documents) {
          await clearOrganizationDocumentsComputerProjection(workspace);
        }
        return { documents, workingDirectory };
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
    writeSlackFile: async (file) =>
      await input.workspaceAccess.withWorkspace(
        async (workspace) =>
          await createAgentComputerFileHandoff({
            workspace,
            workingDirectory: input.workingDirectory,
          }).writeSlackFile(file)
      ),
  };
}

export function createReacquiringOrganizationDocumentWorkingCopyStore(input: {
  projection: OrganizationDocumentsComputerProjection;
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
