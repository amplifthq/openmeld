import { defineTool } from "@flue/runtime";
import { toJsonSchema } from "@valibot/to-json-schema";
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
  executeRemoteAgentToolDefinition,
  requireRemoteAgentToolExecutionContext,
  toFlueJsonValue,
} from "./tool-execution";
import {
  emitRemoteAgentToolUsage,
  type RemoteAgentToolUsageObservabilityEnv,
} from "./tool-usage-observability";
import { resolveRemoteAgentToolWorkActivity } from "./tool-work-activity";

export const REMOTE_AGENT_CODE_MODE_TOOL_NAME = "codemode";

const CODE_MODE_TIMEOUT_MS = 60_000;
const CODE_MODE_INPUT_MAX_CHARS = 24_000;
const CODE_MODE_OUTPUT_MAX_CHARS = 24_000;
const CODE_MODE_LOG_MAX_COUNT = 10;
const CODE_MODE_LOG_MAX_CHARS = 1000;
const CODE_MODE_DESCRIPTION = `Use Code Mode to call the available tools, including simple calls and tasks that benefit from composing several tools, looping over results, filtering data, branching, or shaping one compact result.

Available tools:
{{types}}

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
  truncateResult(value: unknown, options: { maxChars: number }): unknown;
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
    run: async ({ input: toolInput, signal }) => {
      const context = await requireRemoteAgentToolExecutionContext(input);
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
          result: runtime.truncateResult(rawOutput.result, {
            maxChars: CODE_MODE_OUTPUT_MAX_CHARS,
          }),
          ...(rawOutput.logs
            ? { logs: boundCodeModeLogs(rawOutput.logs) }
            : {}),
        };
        outcome = "succeeded";
        return toFlueJsonValue(output);
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
          });
          return toFlueJsonValue(result) ?? null;
        },
      }),
    ])
  );
}

function toCodeModeInputSchema(schema: RemoteAgentToolInputSchema) {
  return jsonSchema(
    toJsonSchema(schema, {
      // JSON Schema cannot represent runtime-only normalization or custom
      // predicates. Ignore only the two actions used intentionally by current
      // tool schemas; every newly unsupported action must fail catalog
      // construction instead of degrading the model-visible type.
      errorMode: "throw",
      ignoreActions: ["check", "trim"],
      typeMode: "input",
    }),
    {
      validate: (value) => {
        const result = safeParse(schema, value);
        return result.success
          ? { success: true, value: result.output }
          : { error: new ValiError(result.issues), success: false };
      },
    }
  );
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
}): Promise<void> {
  const work = resolveRemoteAgentToolWorkActivity(
    input.toolName,
    input.toolInput
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
  const [{ DynamicWorkerExecutor, truncateResult }, { createCodeTool }] =
    await Promise.all([
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
    truncateResult,
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
