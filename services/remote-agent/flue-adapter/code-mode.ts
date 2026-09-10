import { defineTool } from "@flue/runtime";
import { jsonSchema, type ToolExecutionOptions, type ToolSet, tool } from "ai";
import {
  maxLength,
  minLength,
  pipe,
  safeParse,
  strictObject,
  string,
  trim,
  ValiError,
} from "valibot";
import type {
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import type {
  RemoteAgentToolDefinition,
  RemoteAgentToolInputSchema,
} from "../agent-core/tool-definition";
import { remoteAgentStreamPublisher } from "./stream-publisher-instance";
import {
  isRemoteAgentStreamEligible,
  type RemoteAgentStreamPublisher,
  resolveRemoteAgentStreamContext,
} from "./streaming";
import {
  beginRemoteAgentToolExecutionAttempt,
  executeRemoteAgentToolDefinition,
  requireRemoteAgentToolExecutionContext,
  toBoundedRemoteAgentToolResult,
} from "./tool-execution";
import { toRemoteAgentToolJsonSchema } from "./tool-json-schema";
import {
  emitRemoteAgentToolUsage,
  type RemoteAgentToolUsageObservabilityEnv,
} from "./tool-usage-observability";
import { resolveRemoteAgentToolWorkActivity } from "./tool-work-activity";

export const REMOTE_AGENT_CODE_MODE_TOOL_NAME = "codemode";

const CODE_MODE_TIMEOUT_MS = 60_000;
const CODE_MODE_INPUT_MAX_CHARS = 24_000;
const CODE_MODE_LOG_MAX_COUNT = 10;
const CODE_MODE_LOG_MAX_CHARS = 1000;
const UNDEFINED_CAPABILITY = /\b([A-Za-z_$][\w$]*) is not defined\b/u;

function withCodeModeCallableHint(
  error: unknown,
  definitions: RemoteAgentToolDefinition[]
): unknown {
  if (!(error instanceof Error)) {
    return error;
  }
  const name = UNDEFINED_CAPABILITY.exec(error.message)?.[1];
  if (!(name && definitions.some((definition) => definition.name === name))) {
    return error;
  }
  return new Error(
    `${error.message}. This capability is available as codemode.${name}(input), not a global function. Use that exact callable name; capability discovery does not require another activation step.`,
    { cause: error }
  );
}
const CODE_MODE_DESCRIPTION = `Use Code Mode after loading the capabilities you need with openmeld_search_capabilities and openmeld_describe_capabilities. Follow each model-visible input schema and description; runtime validation remains authoritative for normalization and custom constraints. Do not guess capability names or undeclared fields. A described capability named example_tool is available here as codemode.example_tool(input).

Write one async JavaScript arrow function that returns the final result. Do not use TypeScript syntax, named top-level functions, Node.js APIs, process, require, direct fetch, or direct network connections. Generated code can reach external systems only through the typed tools above. Tool authorization, confirmation, identity, and audit rules still apply to every call.`;

const codeModeInputSchema = strictObject({
  code: pipe(
    string(),
    trim(),
    minLength(1),
    maxLength(CODE_MODE_INPUT_MAX_CHARS)
  ),
});

type RemoteAgentCodeModeOutput = {
  logs?: string[];
  result: unknown;
};

type RemoteAgentCodeModeTool = {
  description?: string;
  execute?: (
    input: { code: string },
    options: ToolExecutionOptions
  ) =>
    | AsyncIterable<RemoteAgentCodeModeOutput>
    | PromiseLike<RemoteAgentCodeModeOutput>
    | RemoteAgentCodeModeOutput;
};

type RemoteAgentCodeModeExecutorOptions = {
  globalOutbound: null;
  loader: WorkerLoader;
  timeout: number;
};

export type RemoteAgentCodeModeRuntime = {
  createCodeTool(input: {
    description: string;
    executor: unknown;
    tools: ToolSet;
  }): RemoteAgentCodeModeTool;
  createExecutor(options: RemoteAgentCodeModeExecutorOptions): unknown;
};

export async function createRemoteAgentCodeModeFlueTool(input: {
  coreWorker?: RemoteAgentCoreWorkerBinding;
  definitions: RemoteAgentToolDefinition[];
  env: RemoteAgentToolUsageObservabilityEnv;
  loader: WorkerLoader;
  runtime?: RemoteAgentCodeModeRuntime;
  storage: RemoteAgentStorage;
  streamPublisher?: RemoteAgentStreamPublisher;
  submissionId: string;
}) {
  const runtime = input.runtime ?? (await loadCloudflareCodeModeRuntime());
  const executor = runtime.createExecutor({
    globalOutbound: null,
    loader: input.loader,
    timeout: CODE_MODE_TIMEOUT_MS,
  });
  const descriptionTool = runtime.createCodeTool({
    description: CODE_MODE_DESCRIPTION,
    executor,
    tools: buildCodeModeToolSet({
      definitions: input.definitions,
      coreWorker: input.coreWorker,
      onToolCall: () => undefined,
      storage: input.storage,
      streamPublisher: input.streamPublisher ?? remoteAgentStreamPublisher,
      submissionId: input.submissionId,
    }),
  });
  const description = descriptionTool.description?.trim();
  if (!description) {
    throw new Error("Cloudflare Code Mode tool description is unavailable.");
  }

  return defineTool({
    name: REMOTE_AGENT_CODE_MODE_TOOL_NAME,
    description,
    input: codeModeInputSchema,
    run: async ({ data: toolInput, signal }) => {
      const context = await requireRemoteAgentToolExecutionContext(input);
      await beginRemoteAgentToolExecutionAttempt({
        storage: input.storage,
        submissionId: input.submissionId,
        source: "direct",
        toolInput,
        toolName: REMOTE_AGENT_CODE_MODE_TOOL_NAME,
      });
      const startedAtMs = Date.now();
      let innerToolCallCount = 0;
      let output: RemoteAgentCodeModeOutput | undefined;
      let outcome: "failed" | "succeeded" = "failed";
      try {
        const codeTool = runtime.createCodeTool({
          description: CODE_MODE_DESCRIPTION,
          executor,
          tools: buildCodeModeToolSet({
            definitions: input.definitions,
            coreWorker: input.coreWorker,
            onToolCall: () => {
              innerToolCallCount += 1;
            },
            storage: input.storage,
            streamPublisher:
              input.streamPublisher ?? remoteAgentStreamPublisher,
            submissionId: input.submissionId,
          }),
        });
        if (!codeTool.execute) {
          throw new Error("Cloudflare Code Mode execution is unavailable.");
        }
        const rawOutput = await codeTool.execute(
          { code: toolInput.code },
          {
            abortSignal: signal,
            messages: [],
            toolCallId: `codemode:${input.submissionId}`,
          }
        );
        if (isAsyncIterable(rawOutput)) {
          throw new Error(
            "Cloudflare Code Mode returned an unsupported streaming tool result."
          );
        }
        output = {
          result:
            toBoundedRemoteAgentToolResult({
              toolName: REMOTE_AGENT_CODE_MODE_TOOL_NAME,
              value: rawOutput.result,
            }) ?? null,
          ...(rawOutput.logs
            ? { logs: boundCodeModeLogs(rawOutput.logs) }
            : {}),
        };
        const boundedOutput = toBoundedRemoteAgentToolResult({
          toolName: REMOTE_AGENT_CODE_MODE_TOOL_NAME,
          value: output,
        });
        outcome = "succeeded";
        return { output: boundedOutput };
      } catch (error) {
        throw withCodeModeCallableHint(error, input.definitions);
      } finally {
        emitRemoteAgentToolUsage(input.env, {
          durationMs: Date.now() - startedAtMs,
          inputBytes: utf8ByteLength(toolInput.code),
          operation: "execute",
          organizationId: context.organizationId,
          outcome,
          outputBytes: output ? jsonByteLength(output) : 0,
          provider: "cloudflare_codemode",
          recordedAt: new Date().toISOString(),
          requestCount: innerToolCallCount,
          spaceId: context.spaceId,
          submissionId: input.submissionId,
          toolName: REMOTE_AGENT_CODE_MODE_TOOL_NAME,
        });
      }
    },
  });
}

function buildCodeModeToolSet(input: {
  coreWorker?: RemoteAgentCoreWorkerBinding;
  definitions: RemoteAgentToolDefinition[];
  onToolCall(): void;
  storage: RemoteAgentStorage;
  streamPublisher: RemoteAgentStreamPublisher;
  submissionId: string;
}): ToolSet {
  let fallbackToolCallSequence = 0;
  return Object.fromEntries(
    input.definitions.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: toCodeModeInputSchema(definition.input) as never,
        execute: async (
          toolInput: Record<string, unknown>,
          options?: ToolExecutionOptions
        ) => {
          input.onToolCall();
          fallbackToolCallSequence += 1;
          const toolCallId =
            options?.toolCallId ??
            `codemode:${definition.name}:${String(fallbackToolCallSequence)}`;
          const result = await executeRemoteAgentToolDefinition({
            definition,
            signal: options?.abortSignal,
            source: "code_mode",
            storage: input.storage,
            submissionId: input.submissionId,
            toolInput,
          });
          await publishCodeModeInnerWorkBestEffort({
            coreWorker: input.coreWorker,
            observedAtMs: Date.now(),
            storage: input.storage,
            streamPublisher: input.streamPublisher,
            submissionId: input.submissionId,
            toolCallId,
            toolInput,
            toolName: definition.name,
            toolResult: result,
          });
          return (
            toBoundedRemoteAgentToolResult({
              toolName: definition.name,
              value: result,
            }) ?? null
          );
        },
      }),
    ])
  );
}

function toCodeModeInputSchema(schema: RemoteAgentToolInputSchema) {
  return jsonSchema(toRemoteAgentToolJsonSchema(schema), {
    validate: (value) => {
      const result = safeParse(schema, value);
      return result.success
        ? { success: true, value: result.output }
        : { error: new ValiError(result.issues), success: false };
    },
  });
}

async function publishCodeModeInnerWorkBestEffort(input: {
  coreWorker?: RemoteAgentCoreWorkerBinding;
  observedAtMs: number;
  storage: RemoteAgentStorage;
  streamPublisher: RemoteAgentStreamPublisher;
  submissionId: string;
  toolCallId: string;
  toolInput: unknown;
  toolName: string;
  toolResult: unknown;
}): Promise<void> {
  const work = resolveRemoteAgentToolWorkActivity(
    input.toolName,
    input.toolInput,
    input.toolResult
  );
  if (!work) {
    return;
  }
  try {
    const context = await resolveRemoteAgentStreamContext({
      storage: input.storage,
      submissionId: input.submissionId,
    });
    if (!(context && isRemoteAgentStreamEligible(context))) {
      return;
    }
    await input.streamPublisher.pushPart({
      context,
      coreWorker: input.coreWorker,
      observedAtMs: input.observedAtMs,
      part: {
        type: "tool",
        state: "output-available",
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        work,
      },
      storage: input.storage,
    });
  } catch (error) {
    console.warn("[remote_agent.code_mode_work_publish_failed]", {
      errorName: error instanceof Error ? error.name : "unknown",
      event: "remote_agent.code_mode_work_publish_failed",
      submissionId: input.submissionId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
    });
  }
}

async function loadCloudflareCodeModeRuntime(): Promise<RemoteAgentCodeModeRuntime> {
  const [{ DynamicWorkerExecutor }, { createCodeTool }] = await Promise.all([
    import("@cloudflare/codemode"),
    import("@cloudflare/codemode/ai"),
  ]);
  return {
    createCodeTool: (input) =>
      createCodeTool({
        description: input.description,
        executor: input.executor as never,
        tools: input.tools,
      }),
    createExecutor: (options) => new DynamicWorkerExecutor(options),
  };
}

function boundCodeModeLogs(logs: string[]): string[] {
  return logs
    .slice(0, CODE_MODE_LOG_MAX_COUNT)
    .map((log) => log.slice(0, CODE_MODE_LOG_MAX_CHARS));
}

function jsonByteLength(value: unknown): number {
  try {
    return utf8ByteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
}
