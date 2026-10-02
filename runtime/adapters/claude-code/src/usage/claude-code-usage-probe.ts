import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  type AdapterProviderUsageLimit,
  createUnavailableProviderUsageLimits,
  type RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import { resolveClaudeAgentSdkExecutable } from "../transport/claude-agent-sdk-transport.js";
import { projectClaudeCodeAccountUsageLimits } from "./claude-code-usage-limits.js";

// A control connection with no user message: no model call, tools, persisted
// session, hooks, MCP connections, or local transcript scan.
export async function probeClaudeCodeUsageLimits(input: {
  expectedEmail: string;
  launchContract: RuntimeAgentControllerLaunchContract;
  workingDirectory: string;
  observedAt: string;
  timeoutMs?: number;
  queryFn?: typeof query;
}): Promise<AdapterProviderUsageLimit[]> {
  const controller = new AbortController();
  const executable = await resolveClaudeAgentSdkExecutable(input);
  const spawnProcess = executable.spawnProcess;
  let connection: ReturnType<typeof query> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Claude usage control connection timed out."));
      }, input.timeoutMs ?? 8000);
    });
    connection = (input.queryFn ?? query)({
      prompt: emptyPrompt(controller.signal),
      options: {
        abortController: controller,
        cwd: input.workingDirectory,
        pathToClaudeCodeExecutable: executable.pathToClaudeCodeExecutable,
        ...(spawnProcess
          ? {
              spawnClaudeCodeProcess: (options) =>
                spawnProcess(options, () => undefined),
            }
          : {}),
        persistSession: false,
        allowedTools: [],
        strictMcpConfig: true,
        mcpServers: {},
        settingSources: ["user"],
        settings: { disableAllHooks: true },
        env: {
          ...process.env,
          ENABLE_CLAUDEAI_MCP_SERVERS: "false",
          CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
          CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "1",
        },
      },
    });
    const activeConnection = connection;
    return await Promise.race([
      deadline,
      (async () => {
        const { account } = await activeConnection.initializationResult();
        if (
          account.apiProvider !== "firstParty" ||
          account.email?.trim().toLowerCase() !==
            input.expectedEmail.trim().toLowerCase() ||
          (account.apiKeySource && account.apiKeySource !== "none")
        ) {
          return createUnavailableProviderUsageLimits(
            input.observedAt,
            undefined,
            { reason: "not_applicable" }
          );
        }
        const value =
          await activeConnection.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(
            { skipBehaviors: true }
          );
        return projectClaudeCodeAccountUsageLimits({
          value,
          observedAt: input.observedAt,
        });
      })(),
    ]);
  } catch {
    return createUnavailableProviderUsageLimits(input.observedAt, undefined, {
      reason: "refresh_failed",
    });
  } finally {
    clearTimeout(timer);
    controller.abort();
    connection?.close();
    await executable.cleanup();
  }
}

async function* emptyPrompt(
  signal: AbortSignal
): AsyncGenerator<SDKUserMessage> {
  if (!signal.aborted) {
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true })
    );
  }
}
