import {
  remoteAgentExecutionScopeKey,
  remoteAgentGitCheckoutInputSchema,
  remoteAgentGitConnectionResultSchema,
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
import { requireCenterAgentCodeTarget } from "./work-target";

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
      "Use an existing GitHub Plugin connection with native Git in your Linux Computer. Select owner, repo and githubActor (organization or requester), and reuse a stable key. Returns repositoryUrl (the stable GitHub identity) and gitArguments (temporary transport configuration for one Git command). Obtain a current connection before clone/fetch, including when reusing a repository in a later turn. Insert gitArguments immediately after git, then clone or fetch repositoryUrl. Never clone the temporary url or save gitArguments in Git configuration. Credentials stay at the provider. Run and poll the command with computer. No files are downloaded by this tool. Public repositories and independently authenticated Git need no Plugin connection. This transport reads Git history; use GitHub write tools for publication.",
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
      await requireCenterAgentCodeTarget(input, request);
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
      const repositoryUrl = `https://github.com/${request.owner}/${request.repo}.git`;
      const url = `http://computer.internal/${operationId}/${request.owner}/${request.repo}.git`;
      return remoteAgentGitConnectionResultSchema.parse({
        url,
        repositoryUrl,
        gitArguments: ["-c", `url.${url}.insteadOf=${repositoryUrl}`],
        expiresAtMs,
        backend: "container",
        connectionScope: connection.scope,
        nextAction:
          "Run git <gitArguments> clone <repositoryUrl> <directory>, or git <gitArguments> -C <directory> fetch <repositoryUrl>, with computer action=command and backend=container. Pass each argument separately or shell-quote it. The clone stores repositoryUrl; the URL rewrite applies only to this Git command. Git may retain the internal transfer address in FETCH_HEAD or command history. It contains no provider credential and does not extend access. Keep it private and obtain current authorization for later commands. For an older checkout, inspect its origin; if it is a computer.internal URL for this exact owner/repository, replace only that origin URL with repositoryUrl before fetching. Do not change branches, reset files, or change another repository's origin. Preserve the command key for poll and recovery. An unavailable transfer grant requires a current computer_git_connection call, not another GitHub login or a repeated write. This transport never authorizes push.",
      });
    },
  };
}
