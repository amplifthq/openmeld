import {
  remoteAgentExecutionScopeKey,
  remoteAgentGitCheckoutInputSchema,
  remoteAgentGitTransferGrantSchema,
} from "@openmeld/schemas";
import { digestCanonicalJson } from "@openmeld/utils";
import { picklist, strictObject, string } from "valibot";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import {
  isDelegatedGitHubTurn,
  requireRemoteAgentExecutionAccess,
} from "../agent-core/execution-access";
import { resolveGitHubActionContext } from "../agent-core/github-tools";
import {
  buildRemoteAgentCoreContext,
  buildRemoteAgentToolContext,
} from "../agent-core/tool-context";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import type { AgentComputerWorkspaceAccess } from "./agent-computer-workspace-access";

/** Connect native programs to an existing Plugin account without installing
 * credentials or changing the Computer's global Git configuration. */
export function createComputerGitConnectionTool(input: {
  context: RemoteAgentCallbackContext;
  coreWorker: RemoteAgentCoreWorkerBinding;
  storage: RemoteAgentStorage;
  workspaceAccess: AgentComputerWorkspaceAccess;
}): RemoteAgentToolDefinition {
  return {
    name: "computer_git_connection",
    description:
      "Use an existing GitHub Plugin connection with native Git in your Linux Computer. Select owner, repo and githubActor (organization or requester), and reuse a stable key. Returns a temporary repository URL for ordinary git clone or git fetch; credentials stay at the provider. Run and poll the Git command with computer. No files are downloaded by this tool. Renew with the same inputs if the URL expires. Public repositories and Git authenticated independently inside the Computer need no Plugin connection. This transport supports reading Git history; use existing GitHub write tools for publication. Do not use the legacy snapshot checkout for a new native checkout.",
    input: strictObject({
      key: string(),
      owner: string(),
      repo: string(),
      githubActor: picklist(["requester", "organization"]),
    }),
    async execute(raw) {
      const request = remoteAgentGitCheckoutInputSchema.parse({
        ...(raw as object),
        ref: "HEAD",
      });
      const scope = await requireRemoteAgentExecutionAccess(input);
      const toolContext = await buildRemoteAgentToolContext({
        storage: input.storage,
        submissionId: input.context.submissionId,
        toolName: "computer_git_connection",
      });
      const selected = await resolveGitHubActionContext({
        ...input,
        submissionId: input.context.submissionId,
        toolContext,
        githubActor: request.githubActor,
        includeAccessPolicy: true,
      });
      if (!selected.requesterUserId) {
        throw new Error("computer.git_requester_unavailable");
      }
      const connection = selected.selection.connection;
      const scopeKey = remoteAgentExecutionScopeKey(scope);
      const operationId = await digestCanonicalJson([
        scopeKey,
        input.context.submissionId,
        request.key,
      ]);
      const expiresAtMs = Date.now() + 29 * 60 * 1000;
      const register = input.workspaceAccess.registerGitTransferGrant;
      if (!register) {
        throw new Error("computer.git_connection_unavailable");
      }
      await register(
        remoteAgentGitTransferGrantSchema.parse({
          operationId,
          organizationId: input.context.organizationId,
          requesterUserId: selected.requesterUserId,
          connectionScope: connection.scope,
          owner: request.owner,
          repo: request.repo,
          scopeKey,
          expiresAtMs,
          authorization: {
            context: buildRemoteAgentCoreContext(
              input.context,
              `git-transfer:${operationId}`
            ),
            submissionId: input.context.submissionId,
            effect: "read",
            ...(isDelegatedGitHubTurn(input.context)
              ? { includeDelegatedRequester: true }
              : {}),
            sources: [
              {
                kind: "plugin_connection",
                service: "github",
                connectionName: connection.connectionName,
                connectionUpdatedAtMs: connection.updatedAtMs,
              },
            ],
          },
        })
      );
      return {
        url: `http://computer.internal/${operationId}/${request.owner}/${request.repo}.git`,
        expiresAtMs,
        backend: "container",
        connectionScope: connection.scope,
        nextAction:
          "Run git clone <url> <directory>, or git -C <directory> fetch <url>, with computer action=command and backend=container. Preserve the command key for poll, stop and recovery. This URL works only inside this Computer and while this execution and connection remain authorized.",
      };
    },
  };
}
