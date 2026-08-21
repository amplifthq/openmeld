import { forkSession as forkClaudeCodeSession } from "@anthropic-ai/claude-agent-sdk";
import {
  forkCodexAppServerThread,
  resolveInstalledCodexLaunchCandidates,
} from "@openmeld/adapter-codex";
import {
  forkOpenCodeServerSession,
  resolveInstalledOpenCodeLaunchCandidates,
} from "@openmeld/adapter-opencode";
import type { RuntimeTransportLocalAgentControlForkSessionFramePayload } from "@openmeld/schemas/types";
import { listProjectBindings } from "../../agent-activity/project-bindings";
import { recordOpenMeldCreatedLocalAgentSession } from "../../agent-activity/session-inventory-origin-store";
import { discoverLocalAgentSessionProviders } from "../../agent-activity/session-inventory-provider-adapters";

const PROVIDER_PROBE_TIMEOUT_MS = 5000;
const PROVIDER_FORK_TIMEOUT_MS = 30_000;

type ForkRequest =
  RuntimeTransportLocalAgentControlForkSessionFramePayload["request"];

export async function forkAgentSession(input: {
  request: ForkRequest;
  rootDir?: string;
}): Promise<{ childNativeSessionId: string }> {
  const source = await resolveSourceSession({
    request: input.request,
    rootDir: input.rootDir,
  });
  let childNativeSessionId: string;
  switch (input.request.agentControllerRef) {
    case "builtin:codex": {
      const launch = await resolveInstalledCodexLaunchCandidates({
        timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
      });
      if (!(launch.ok && launch.candidates[0])) {
        throw new AgentSessionForkError(
          "agent_session_fork.local_agent_unavailable",
          "Codex is no longer available on this Computer."
        );
      }
      const result = await forkCodexAppServerThread({
        codexTimeoutMs: PROVIDER_FORK_TIMEOUT_MS,
        codexWorkdir: source.workingDirectory,
        launchContract: launch.candidates[0].launchContract,
        sourceThreadId: input.request.sourceNativeSessionId,
        title: buildForkedSessionTitle(input.request.profileName),
      });
      childNativeSessionId = result.threadId;
      break;
    }
    case "builtin:claude-code": {
      const result = await forkClaudeCodeSession(
        input.request.sourceNativeSessionId,
        {
          dir: source.workingDirectory,
          title: buildForkedSessionTitle(input.request.profileName),
        }
      );
      childNativeSessionId = result.sessionId;
      break;
    }
    case "builtin:opencode": {
      const launch = await resolveInstalledOpenCodeLaunchCandidates({
        timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
      });
      if (!(launch.ok && launch.candidates[0])) {
        throw new AgentSessionForkError(
          "agent_session_fork.local_agent_unavailable",
          "OpenCode is no longer available on this Computer."
        );
      }
      const result = await forkOpenCodeServerSession({
        launchContract: launch.candidates[0].launchContract,
        openCodeTimeoutMs: PROVIDER_FORK_TIMEOUT_MS,
        openCodeWorkdir: source.workingDirectory,
        sourceSessionId: input.request.sourceNativeSessionId,
        title: buildForkedSessionTitle(input.request.profileName),
      });
      childNativeSessionId = result.sessionId;
      break;
    }
    default:
      throw new AgentSessionForkError(
        "agent_session_fork.unsupported",
        "This local agent does not currently provide a verified native Fork operation."
      );
  }
  await recordOpenMeldCreatedLocalAgentSession({
    agentControllerRef: input.request.agentControllerRef,
    nativeSessionId: childNativeSessionId,
    rootDir: input.rootDir,
  });
  return { childNativeSessionId };
}

export class AgentSessionForkError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentSessionForkError";
    this.code = code;
  }
}

async function resolveSourceSession(input: {
  request: ForkRequest;
  rootDir?: string;
}): Promise<{ workingDirectory: string }> {
  const bindings = (
    await listProjectBindings({
      organizationId: input.request.organizationId,
      rootDir: input.rootDir,
    })
  ).filter((binding) => binding.projectId === input.request.projectId);
  if (bindings.length === 0) {
    throw new AgentSessionForkError(
      "agent_session_fork.project_unavailable",
      "This Project is no longer connected on the selected Computer."
    );
  }
  const providers = await discoverLocalAgentSessionProviders({
    bindings,
    rootDir: input.rootDir,
  });
  const provider = providers.find(
    (item) => item.agentControllerRef === input.request.agentControllerRef
  );
  if (!provider || provider.result !== "sessions") {
    throw new AgentSessionForkError(
      "agent_session_fork.inventory_unavailable",
      "OpenMeld could not read the selected local agent's current Sessions."
    );
  }
  const source = provider.sessions.find(
    (item) =>
      item.binding.projectId === input.request.projectId &&
      item.session.nativeSessionId === input.request.sourceNativeSessionId &&
      item.session.canFork
  );
  if (!source) {
    throw new AgentSessionForkError(
      "agent_session_fork.source_unavailable",
      "The selected Session is no longer current or forkable."
    );
  }
  return { workingDirectory: source.binding.repositoryPath };
}

function buildForkedSessionTitle(profileName: string): string {
  return `OpenMeld · ${profileName}`;
}
