import type { Executor } from "@cloudflare/codemode";
import { createCodeTool } from "@cloudflare/codemode/ai";
import {
  CENTER_AGENT_DELEGATION_COMPLETION_MODES,
  DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
} from "@openmeld/schemas";
import { asSchema, type ToolExecutionOptions, type ToolSet } from "ai";
import { pipe, rawCheck, strictObject, string } from "valibot";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  readRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { ConnectorActionOutcomeUnknownError } from "../agent-core/connector-tools";
import {
  buildRemoteAgentExecutionIdentity,
  initializeRemoteAgentExecutionState,
} from "../agent-core/execution-state";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import { RemoteAgentToolCallBudgetExceededError } from "../agent-core/tool-progress";
import { isRemoteAgentToolResultWithinLimit } from "../agent-core/tool-result-boundary";
import { getRemoteAgentOpenMeldToolDefinitions } from "../agent-core/tools";
import {
  createRemoteAgentCodeModeFlueTool,
  type RemoteAgentCodeModeRuntime,
} from "../flue-adapter/code-mode";
import { createNativeComputerTool } from "../flue-adapter/computer-native";
import { createRemoteAgentReadToolResultDefinition } from "../flue-adapter/retained-tool-results";
import {
  createRemoteAgentStreamPublisher,
  type RemoteAgentStreamPublisher,
} from "../flue-adapter/streaming";
import { getRemoteAgentFlueTools } from "../flue-adapter/tools";
import { executionAccessFixture } from "./execution-access-fixture";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const SUBMISSION_ID = "submission_code_mode";
const AGENT_PROFILE_ID = "agent_profile_code_mode";
const HUMAN_PROFILE_ID = "human_profile_code_mode";
const SPACE_ID = "space_code_mode";
const TOOL_OPTIONS = {
  messages: [],
  toolCallId: "codemode-inner-call",
} satisfies ToolExecutionOptions;

async function runCodeModeTool(
  tool: Awaited<ReturnType<typeof createRemoteAgentCodeModeFlueTool>>,
  context: { input: { code: string }; signal?: AbortSignal }
) {
  const result = await tool.run({
    data: context.input,
    signal: context.signal,
    log: console,
    toolCallId: "codemode-test-call",
  });
  if (!result || typeof result !== "object") {
    throw new Error("Code Mode must return a Flue tool output envelope.");
  }
  return result.output;
}

describe("Remote Agent Code Mode", () => {
  it("marks only the uncertain write in a multi-write script as awaiting confirmation", async () => {
    const storage = await createStorage(createSubmitTurnRequest());
    const definition = {
      name: "github_create_issue_comment",
      description: "Post an authorized comment.",
      input: strictObject({ operationId: string() }),
      execute: ({ operationId }) => {
        if (operationId === "comment-2") {
          return Promise.reject(
            new ConnectorActionOutcomeUnknownError({
              actionId: "github.create_issue_comment",
              operationId,
              cause: new Error("private provider transport detail"),
              input: {
                owner: "amplifthq",
                repo: "openmeld",
                issueNumber: 1397,
              },
            })
          );
        }
        return Promise.resolve({ status: "completed", operationId });
      },
    } satisfies RemoteAgentToolDefinition;
    const submitRemoteAgentStreamPart = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const runtime = createRuntime({
      executorOptions: [],
      execute: async (tools) => {
        const results: unknown[] = [];
        for (const operationId of ["comment-1", "comment-2", "comment-3"]) {
          results.push(
            await tools.github_create_issue_comment?.execute?.(
              { operationId },
              { ...TOOL_OPTIONS, toolCallId: operationId }
            )
          );
        }
        return { result: results };
      },
    });
    const tool = await createRemoteAgentCodeModeFlueTool({
      definitions: [definition],
      coreWorker: { submitRemoteAgentStreamPart },
      env: {},
      loader: {} as WorkerLoader,
      runtime,
      storage,
      streamPublisher: createRemoteAgentStreamPublisher(),
      submissionId: SUBMISSION_ID,
    });
    const output = await runCodeModeTool(tool, {
      input: { code: "async () => null" },
    });
    expect(output).toMatchObject({
      result: [
        { status: "completed", operationId: "comment-1" },
        {
          status: "outcome_unknown",
          operationId: "comment-2",
          replay: { allowed: false, reason: "window_unverified" },
          message: expect.stringContaining("Do not retry this write"),
        },
        { status: "completed", operationId: "comment-3" },
      ],
    });
    const parts = submitRemoteAgentStreamPart.mock.calls.map(
      ([body]) =>
        body as unknown as {
          part: {
            state: string;
            toolCallId: string;
            work: { outcome?: string };
          };
        }
    );
    expect(parts.filter(({ part }) => part.state === "output-error")).toEqual(
      []
    );
    expect(
      parts
        .filter(({ part }) => part.work.outcome === "outcome_unknown")
        .map(({ part }) => part.toolCallId)
    ).toEqual(["comment-2"]);
    expect(
      parts
        .filter(({ part }) => part.state === "output-available")
        .map(({ part }) => part.toolCallId)
    ).toEqual(["comment-1", "comment-2", "comment-3"]);
    expect(JSON.stringify(output)).not.toContain(
      "private provider transport detail"
    );
  });

  it.each([
    "bash",
    "console",
  ])("retains the middle of actual %s output before display shortening", async (carrier) => {
    const storage = await createStorage(createSubmitTurnRequest());
    const context = await readRemoteAgentCallbackContext(
      storage,
      SUBMISSION_ID
    );
    if (!context) {
      throw new Error("Missing admitted context");
    }
    const coreWorker = {
      authorizeRemoteAgentExecutionAccess: executionAccessFixture(context),
    };
    const text = `${"start\\n".repeat(30_000)}UNIQUE_RAW_LOG_MIDDLE${"end\\n".repeat(30_000)}`;
    const exec = vi.fn(async () => ({ stdout: text, stderr: "", exitCode: 0 }));
    const definitions: RemoteAgentToolDefinition[] = [
      {
        name: "bash",
        description: "Run a command",
        input: strictObject({ command: string() }),
        execute: exec,
      },
    ];
    const reader = createRemoteAgentReadToolResultDefinition({
      storage,
      coreWorker,
      submissionId: SUBMISSION_ID,
    });
    const runtime = createRuntime({
      executorOptions: [],
      execute: async (tools) => {
        if (carrier === "console") {
          return { result: null, logs: [text] };
        }
        const shown = await tools.bash?.execute?.(
          { command: "build-once" },
          TOOL_OPTIONS
        );
        const id = (
          shown as { presentation: { continuation: { resultId: string } } }
        ).presentation.continuation.resultId;
        return {
          result: await reader.execute({
            resultId: id,
            query: "UNIQUE_RAW_LOG_MIDDLE",
          }),
        };
      },
    });
    const tool = await createRemoteAgentCodeModeFlueTool({
      storage,
      coreWorker,
      submissionId: SUBMISSION_ID,
      definitions,
      env: {},
      loader: {} as WorkerLoader,
      runtime,
    });
    const shown = await runCodeModeTool(tool, {
      input: { code: "async () => null" },
    });
    expect(isRemoteAgentToolResultWithinLimit(shown)).toBe(true);
    if (carrier === "console") {
      const id = (
        shown as { presentation: { continuation: { resultId: string } } }
      ).presentation.continuation.resultId;
      expect(
        JSON.stringify(
          await reader.execute({ resultId: id, query: "UNIQUE_RAW_LOG_MIDDLE" })
        )
      ).toContain("UNIQUE_RAW_LOG_MIDDLE");
    } else {
      expect(JSON.stringify(shown)).toContain("UNIQUE_RAW_LOG_MIDDLE");
      expect(exec).toHaveBeenCalledOnce();
    }
  });

  it.each([
    3000, 30_000,
  ])("reads a %i-line inner result without repeating the write", async (lines) => {
    const storage = await createStorage(createSubmitTurnRequest());
    const context = await readRemoteAgentCallbackContext(
      storage,
      SUBMISSION_ID
    );
    if (!context) {
      throw new Error("Expected an admitted execution");
    }
    const coreWorker = {
      authorizeRemoteAgentExecutionAccess: executionAccessFixture(context),
    };
    const write = vi.fn(async () => ({
      status: "completed",
      operationId: "write-once",
      log: `${"before\n".repeat(lines)}UNIQUE_CODEMODE_MIDDLE_FAILURE${"after\n".repeat(lines)}`,
    }));
    const runtime = createRuntime({
      executorOptions: [],
      execute: async (tools) => {
        const displayed = (await tools.example_write?.execute?.(
          {},
          TOOL_OPTIONS
        )) as {
          log?: string;
          presentation: { continuation: { resultId: string } };
        };
        if (lines === 3000) {
          // Internal computation selects the evidence before model display.
          expect(displayed.log).toContain("UNIQUE_CODEMODE_MIDDLE_FAILURE");
          return {
            result: displayed.log?.slice(
              displayed.log.indexOf("UNIQUE_CODEMODE_MIDDLE_FAILURE"),
              displayed.log.indexOf("UNIQUE_CODEMODE_MIDDLE_FAILURE") +
                "UNIQUE_CODEMODE_MIDDLE_FAILURE".length
            ),
          };
        }
        const resultId = displayed.presentation.continuation.resultId;
        return {
          result: await tools.openmeld_read_tool_result?.execute?.(
            { resultId, query: "UNIQUE_CODEMODE_MIDDLE_FAILURE" },
            TOOL_OPTIONS
          ),
        };
      },
    });
    const tool = await createRemoteAgentCodeModeFlueTool({
      coreWorker,
      definitions: [
        {
          name: "example_write",
          description: "Write once and return its log.",
          input: strictObject({}),
          execute: write,
        },
        createRemoteAgentReadToolResultDefinition({
          coreWorker,
          storage,
          submissionId: SUBMISSION_ID,
        }),
      ],
      env: {},
      loader: {} as WorkerLoader,
      runtime,
      storage,
      submissionId: SUBMISSION_ID,
    });
    const result = await runCodeModeTool(tool, {
      input: { code: "async () => null" },
    });
    expect(JSON.stringify(result)).toContain("UNIQUE_CODEMODE_MIDDLE_FAILURE");
    expect(write).toHaveBeenCalledTimes(1);
    expect(isRemoteAgentToolResultWithinLimit(result)).toBe(true);
  });

  it("publishes admitted inner work before the tool finishes", async () => {
    const storage = await createStorage(createSubmitTurnRequest());
    const started = Promise.withResolvers<void>();
    const startPublished = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<{ spaces: [] }>();
    const submitRemoteAgentStreamPart = vi.fn(
      (body: { sequence: number; part: { state: string } }) => {
        if (body.part.state === "input-available") {
          startPublished.resolve();
        }
        return Promise.resolve({
          status: "accepted" as const,
          lastSequence: body.sequence,
        });
      }
    );
    const runtime = createRuntime({
      execute: async (tools) => ({
        result: await tools.openmeld_list_spaces?.execute?.({}, TOOL_OPTIONS),
      }),
      executorOptions: [],
    });
    const tool = await createRemoteAgentCodeModeFlueTool({
      coreWorker: { submitRemoteAgentStreamPart },
      definitions: [
        {
          description: "List Spaces.",
          execute: async () => {
            started.resolve();
            return await finish.promise;
          },
          input: strictObject({}),
          name: "openmeld_list_spaces",
        },
      ],
      env: {},
      loader: {} as WorkerLoader,
      runtime,
      storage,
      streamPublisher: createRemoteAgentStreamPublisher(),
      submissionId: SUBMISSION_ID,
    });

    const running = runCodeModeTool(tool, {
      input: { code: "async () => null" },
    });
    await started.promise;
    await startPublished.promise;
    expect(submitRemoteAgentStreamPart).toHaveBeenCalledOnce();
    expect(submitRemoteAgentStreamPart).toHaveBeenCalledWith(
      expect.objectContaining({
        part: expect.objectContaining({ state: "input-available" }),
      })
    );
    finish.resolve({ spaces: [] });
    await running;
    expect(submitRemoteAgentStreamPart).toHaveBeenCalledTimes(2);
  });

  it("cancels inner work through the SDK wrapper and prevents queued work from starting", async () => {
    const storage = await createStorage(createSubmitTurnRequest());
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const following = vi.fn(async () => "unexpected");
    const executor: Executor = {
      async execute(_code, providers) {
        if (!Array.isArray(providers)) {
          throw new Error("Expected SDK-resolved providers");
        }
        const tools = providers[0]?.fns;
        if (!(tools?.blocking && tools.following)) {
          throw new Error("Expected both inner operations");
        }
        const results = await Promise.allSettled([
          tools.blocking({}),
          tools.following({}),
        ]);
        expect(results.map((result) => result.status)).toEqual([
          "rejected",
          "rejected",
        ]);
        return { result: null };
      },
    };
    const tool = await createRemoteAgentCodeModeFlueTool({
      definitions: [
        {
          name: "blocking",
          description: "Wait for cancellation",
          input: strictObject({}),
          execute: async (_input, options) => {
            expect(options?.signal).toBe(controller.signal);
            const pending = new Promise<never>((_resolve, reject) => {
              options?.signal?.addEventListener(
                "abort",
                () => reject(options.signal?.reason),
                { once: true }
              );
            });
            started.resolve();
            return await pending;
          },
        },
        {
          name: "following",
          description: "Must not start",
          input: strictObject({}),
          execute: following,
        },
      ],
      env: {},
      loader: {} as WorkerLoader,
      runtime: {
        createExecutor: () => executor,
        createCodeTool: (input) => createCodeTool({ ...input, executor }),
      },
      storage,
      submissionId: SUBMISSION_ID,
    });
    const running = runCodeModeTool(tool, {
      input: { code: "async () => {}" },
      signal: controller.signal,
    });
    await started.promise;
    controller.abort(new Error("Stopped by user"));
    await running;
    expect(following).not.toHaveBeenCalled();
  });
  it("checks personal execution authority before direct and Code Mode computer calls", async () => {
    const storage = await createStorage(createSubmitTurnRequest());
    const execute = vi.fn(async () => ({ result: "computer-result" }));
    const authorize = vi.fn(async () => ({ kind: "authorize" }));
    const runtime = createRuntime({
      executorOptions: [],
      execute: async (tools) => {
        const tool = tools.computer;
        if (!tool?.execute) {
          throw new Error("Computer missing from Code Mode");
        }
        return {
          result: await tool.execute({ code: "computer" }, TOOL_OPTIONS),
        };
      },
    });
    const { tools } = await getRemoteAgentFlueTools({
      personalAgent: true,
      storage,
      submissionId: SUBMISSION_ID,
      coreWorker: { personalRemoteAgentSpaceTool: authorize },
      env: { LOADER: {} as WorkerLoader },
      codeModeRuntime: runtime,
      sandboxDefinitions: [
        {
          name: "computer",
          description: "Use computer",
          input: strictObject({ code: string() }),
          execute,
        },
      ],
    });
    const names = tools.map((tool) => tool.name);
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("openmeld_read_org_documents");
    expect(names).not.toContain("openmeld_create_project");
    expect(names).not.toContain("openmeld_create_routine");
    const direct = tools.find((tool) => tool.name === "computer");
    const codeMode = tools.find((tool) => tool.name === "codemode");
    if (!(direct && codeMode)) {
      throw new Error("Expected both execution paths");
    }
    const run = (tool: typeof direct, data: { code: string }) =>
      tool.run({ data, log: console, toolCallId: "personal-authority" });
    await run(direct, { code: "computer" });
    await run(codeMode, { code: "computer" });
    expect(execute).toHaveBeenCalledTimes(2);
    authorize.mockRejectedValue(
      new Error("remote_agent.space_membership_revoked")
    );
    await expect(run(direct, { code: "computer" })).rejects.toThrow(
      "space_membership_revoked"
    );
    await expect(run(codeMode, { code: "computer" })).rejects.toThrow(
      "space_membership_revoked"
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it.each([
    { status: "destructive_confirmation_required", needsHuman: true },
    { status: "destructive_action_preview", needsHuman: false },
  ])("keeps $status tokens private without misreporting a preview as waiting", async ({
    status,
    needsHuman,
  }) => {
    const storage = await createStorage(createSubmitTurnRequest());
    const submitRemoteAgentStreamPart = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const result = {
      status,
      sideEffects: 0,
      confirmationToken: "private-confirmation",
    };
    const definition = {
      name: "openmeld_prepare_remove_project",
      description: "Prepare removal.",
      input: strictObject({}),
      execute: async () => result,
    } satisfies RemoteAgentToolDefinition;
    const runtime = createRuntime({
      executorOptions: [],
      execute: async (tools) => {
        const prepare = tools.openmeld_prepare_remove_project;
        if (!prepare?.execute) {
          throw new Error("Code Mode preparation tool is unavailable.");
        }
        return { result: await prepare.execute({}, TOOL_OPTIONS) };
      },
    });
    const tool = await createRemoteAgentCodeModeFlueTool({
      definitions: [definition],
      env: {},
      loader: {} as WorkerLoader,
      runtime,
      storage,
      submissionId: SUBMISSION_ID,
      coreWorker: { submitRemoteAgentStreamPart },
      streamPublisher: createRemoteAgentStreamPublisher(),
    });
    await runCodeModeTool(tool, { input: { code: "async () => null" } });
    const confirmationEvent = expect.objectContaining({
      part: expect.objectContaining({
        work: expect.objectContaining({ outcome: "confirmation_required" }),
      }),
    });
    if (needsHuman) {
      expect(submitRemoteAgentStreamPart).toHaveBeenCalledWith(
        confirmationEvent
      );
    } else {
      expect(submitRemoteAgentStreamPart).toHaveBeenCalled();
      expect(submitRemoteAgentStreamPart).not.toHaveBeenCalledWith(
        confirmationEvent
      );
    }
    expect(
      JSON.stringify(submitRemoteAgentStreamPart.mock.calls)
    ).not.toContain("private-confirmation");
  });
  it("keeps the executable catalog fixed without embedding every schema in the prompt", async () => {
    const storage = await createStorage(createSubmitTurnRequest());
    const definitions = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: {},
      storage,
      submissionId: SUBMISSION_ID,
    });
    const runtime: RemoteAgentCodeModeRuntime = {
      createCodeTool: ({ description }) => ({ description }),
      createExecutor: () => ({}),
    };

    const tool = await createRemoteAgentCodeModeFlueTool({
      definitions,
      env: {},
      loader: {} as WorkerLoader,
      runtime,
      storage,
      submissionId: SUBMISSION_ID,
    });

    expect(tool.description).toContain("openmeld_search_capabilities");
    expect(tool.description).toContain("openmeld_describe_capabilities");
    expect(tool.description).not.toContain("openmeld_create_task");
    expect(tool.description).not.toContain("openmeld_create_space");
    expect(tool.description).not.toContain("declare const codemode");
  });

  it("exposes structured Space addressing input in the generated Code Mode catalog", async () => {
    const storage = await createStorage(createSubmitTurnRequest());
    const definitions = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: {},
      storage,
      submissionId: SUBMISSION_ID,
    });
    let wakeInputSchema: ReturnType<typeof asSchema> | undefined;
    const runtime: RemoteAgentCodeModeRuntime = {
      createCodeTool: ({ tools }) => {
        const wakeTool = tools.openmeld_wake_agent_profiles_in_space;
        if (!wakeTool) {
          throw new Error("Center Agent Wake tool is unavailable.");
        }
        wakeInputSchema = asSchema(wakeTool.inputSchema);
        return {
          description: JSON.stringify(wakeInputSchema.jsonSchema),
        };
      },
      createExecutor: () => ({}),
    };
    const tool = await createRemoteAgentCodeModeFlueTool({
      definitions,
      env: {},
      loader: {} as WorkerLoader,
      runtime,
      storage,
      submissionId: SUBMISSION_ID,
    });

    expect(JSON.parse(tool.description ?? "{}")).toMatchObject({
      properties: {
        agentProfileIds: {
          items: { type: "string" },
          maxItems: 25,
          minItems: 1,
          type: "array",
        },
        completionMode: {
          enum: [...CENTER_AGENT_DELEGATION_COMPLETION_MODES],
          type: "string",
        },
        mentionProfileIds: {
          description:
            "Every exact Human Profile ID this Space message should notify with a Human Mention. Pass an empty array only when no person should be notified.",
          items: { type: "string" },
          maxItems: 25,
          type: "array",
        },
        referenceProfileIds: {
          description:
            "Every exact Agent Profile ID that this Space message includes as context without assigning work. Pass an empty array only when no Agent Reference is requested.",
          items: { type: "string" },
          maxItems: 25,
          type: "array",
        },
      },
      required: [
        "agentProfileIds",
        "mentionProfileIds",
        "referenceProfileIds",
        "completionMode",
        "spaceId",
        "text",
      ],
      type: "object",
    });
    if (!wakeInputSchema?.validate) {
      throw new Error("Center Agent Wake input validation is unavailable.");
    }
    expect(
      wakeInputSchema.validate({
        agentProfileIds: [AGENT_PROFILE_ID],
        completionMode: "child_reports_directly",
        mentionProfileIds: [HUMAN_PROFILE_ID],
        referenceProfileIds: [],
        spaceId: SPACE_ID,
        text: "Please review this.",
      })
    ).toMatchObject({
      success: true,
      value: {
        agentProfileIds: [AGENT_PROFILE_ID],
        completionMode: "child_reports_directly",
        mentionProfileIds: [HUMAN_PROFILE_ID],
        referenceProfileIds: [],
      },
    });
    expect(
      wakeInputSchema.validate({
        agentProfileIds: [],
        completionMode: "child_reports_directly",
        mentionProfileIds: [],
        referenceProfileIds: [],
        spaceId: SPACE_ID,
        text: "Please review this.",
      })
    ).toMatchObject({ success: false });
    expect(
      wakeInputSchema.validate({
        agentProfileIds: [AGENT_PROFILE_ID],
        completionMode: "child_reports_directly",
        spaceId: SPACE_ID,
        text: "Please review this.",
      })
    ).toMatchObject({ success: false });
  });

  it("fails catalog construction for newly unsupported input schema actions", async () => {
    const storage = await createStorage(createSubmitTurnRequest());
    const definition = {
      description: "Uses an unsupported model-visible validation action.",
      execute: async () => ({ ok: true }),
      input: strictObject({
        value: pipe(
          string(),
          rawCheck(() => undefined)
        ),
      }),
      name: "unsupported_raw_check",
    } satisfies RemoteAgentToolDefinition;

    await expect(
      createRemoteAgentCodeModeFlueTool({
        definitions: [definition],
        env: {},
        loader: {} as WorkerLoader,
        runtime: createRuntime({
          execute: async () => ({ result: null }),
          executorOptions: [],
        }),
        storage,
        submissionId: SUBMISSION_ID,
      })
    ).rejects.toThrow('The "raw_check" action cannot be converted');
  });

  it("runs active tools through an isolated Worker Loader executor", async () => {
    const request = createSubmitTurnRequest();
    const storage = await createStorage(request);
    const executeLookup = vi.fn(async () => ({ spaces: [] }));
    const definition = {
      description: "List Spaces.",
      execute: executeLookup,
      input: strictObject({}),
      name: "openmeld_list_spaces",
    } satisfies RemoteAgentToolDefinition;
    const executorOptions: unknown[] = [];
    const runtime = createRuntime({
      execute: async (tools, code) => {
        expect(code).toContain("codemode.openmeld_list_spaces");
        const lookup = tools.openmeld_list_spaces;
        if (!lookup?.execute) {
          throw new Error("Code Mode lookup tool is unavailable.");
        }
        return {
          logs: ["looked up one value"],
          result: await lookup.execute({}, TOOL_OPTIONS),
        };
      },
      executorOptions,
    });
    const writeDataPoint = vi.fn();
    const submitRemoteAgentStreamPart = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const tool = await createRemoteAgentCodeModeFlueTool({
      coreWorker: { submitRemoteAgentStreamPart },
      definitions: [definition],
      env: {
        OPENMELD_OBSERVABILITY: {
          writeDataPoint,
        } as unknown as AnalyticsEngineDataset,
      },
      loader: {} as WorkerLoader,
      runtime,
      storage,
      streamPublisher: createRemoteAgentStreamPublisher(),
      submissionId: SUBMISSION_ID,
    });

    await expect(
      runCodeModeTool(tool, {
        input: {
          code: "async () => codemode.openmeld_list_spaces({})",
        },
      })
    ).resolves.toEqual({
      logs: ["looked up one value"],
      result: { spaces: [] },
    });
    expect(tool.name).toBe("codemode");
    expect(tool.description).toContain("declare const codemode");
    expect(executeLookup).toHaveBeenCalledWith({});
    expect(submitRemoteAgentStreamPart).toHaveBeenCalledTimes(2);
    expect(submitRemoteAgentStreamPart).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        part: expect.objectContaining({
          state: "input-available",
          toolCallId: "codemode-inner-call",
        }),
      })
    );
    expect(submitRemoteAgentStreamPart).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        part: {
          type: "tool",
          toolCallId: "codemode-inner-call",
          toolName: "openmeld_list_spaces",
          state: "output-available",
          work: {
            v: 1,
            key: "spaces.read",
          },
        },
      })
    );
    expect(executorOptions).toEqual([
      {
        globalOutbound: null,
        loader: expect.any(Object),
        timeout: 60_000,
      },
    ]);
    expect(writeDataPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        blobs: [
          "remote_agent.tool_usage.v1",
          "codemode",
          "cloudflare_codemode",
          "execute",
          "succeeded",
          request.spaceId,
          SUBMISSION_ID,
          expect.any(String),
        ],
        doubles: [
          expect.any(Number),
          1,
          expect.any(Number),
          expect.any(Number),
          0,
          0,
        ],
        indexes: [request.organizationId],
      })
    );
  });

  it("preserves a bounded structured inner result without Code Mode truncation", async () => {
    const storage = await createStorage(createSubmitTurnRequest());
    const boundedResult = {
      data: {
        contentSegment: {
          endOffsetUtf16Exclusive: 24_000,
          hasMore: true,
          nextOffsetUtf16: 24_000,
          startOffsetUtf16: 0,
          totalUtf16CodeUnits: 48_000,
        },
        decoded_content: "A".repeat(24_000),
      },
      status: "completed",
    };
    const definition = {
      description: "Read one bounded GitHub file segment.",
      execute: async () => boundedResult,
      input: strictObject({}),
      name: "github_get_file_contents",
    } satisfies RemoteAgentToolDefinition;
    const legacyTruncateResult = vi.fn(() => "truncated");
    const runtime = createRuntime({
      execute: async (tools) => {
        const readFile = tools.github_get_file_contents;
        if (!readFile?.execute) {
          throw new Error("GitHub file tool is unavailable.");
        }
        return {
          result: await readFile.execute({}, TOOL_OPTIONS),
        };
      },
      executorOptions: [],
      truncateResult: legacyTruncateResult,
    });
    const tool = await createRemoteAgentCodeModeFlueTool({
      definitions: [definition],
      env: {},
      loader: {} as WorkerLoader,
      runtime,
      storage,
      submissionId: SUBMISSION_ID,
    });

    await expect(
      runCodeModeTool(tool, { input: { code: "async () => null" } })
    ).resolves.toEqual({ result: boundedResult });
    expect(legacyTruncateResult).not.toHaveBeenCalled();
  });

  it("uses the same Remote creation contract and truthful accepted result through Code Mode", async () => {
    const storage = await createStorage(createSubmitTurnRequest());
    const response = {
      replayed: false,
      request: {
        actorProfileId: AGENT_PROFILE_ID,
        completedAt: null,
        configuration: {
          ...DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
          agentControllerRef: "hosted:remote-agent",
        },
        createdAgentProfileId: null,
        createdAt: new Date(TEST_NOW_MS).toISOString(),
        decidedAt: new Date(TEST_NOW_MS).toISOString(),
        failureMessage: null,
        id: "request-code-mode",
        nativeSessionId: null,
        organizationId: "org_123",
        profileName: "Research Partner",
        requestedSpaceId: null,
        requesterUserId: "user_1",
        sessionStrategy: "new",
        source: "center_agent",
        status: "approved",
        statusReason: "self_request",
        targetOwnerUserId: "user_1",
        updatedAt: new Date(TEST_NOW_MS).toISOString(),
      },
    };
    const create = vi.fn(async () => response);
    const definitions = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: { centerAgentCreateAgentProfileCreationRequest: create },
      storage,
      submissionId: SUBMISSION_ID,
    }).filter(
      (definition) =>
        definition.name === "openmeld_create_agent_profile_request"
    );
    const tool = await createRemoteAgentCodeModeFlueTool({
      definitions,
      env: {},
      loader: {} as WorkerLoader,
      storage,
      submissionId: SUBMISSION_ID,
      runtime: createRuntime({
        executorOptions: [],
        execute: async (tools) => {
          const creation = tools.openmeld_create_agent_profile_request;
          if (!creation?.execute) {
            throw new Error("Creation tool is unavailable");
          }
          return {
            result: await creation.execute(
              {
                connectionSelection: { kind: "remote" },
                profileName: "Research Partner",
                sessionStrategy: "new",
                targetOwnerUserId: "user_1",
              },
              TOOL_OPTIONS
            ),
          };
        },
      }),
    });
    await expect(
      runCodeModeTool(tool, { input: { code: "async () => null" } })
    ).resolves.toEqual({ result: response });
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ configuration: response.request.configuration })
    );
  });

  it("returns a bounded partial inner result without repeating a completed operation", async () => {
    const storage = await createStorage(createSubmitTurnRequest());
    const context = await readRemoteAgentCallbackContext(
      storage,
      SUBMISSION_ID
    );
    if (!context) {
      throw new Error("Missing admitted context");
    }
    const coreWorker = {
      authorizeRemoteAgentExecutionAccess: executionAccessFixture(context),
    };
    vi.spyOn(storage, "putExpiring").mockRejectedValue(
      new Error("retention store unavailable")
    );
    const execute = vi.fn(async () => ({
      content: "A".repeat(200_000),
      operationId: "write-1",
      status: "completed",
    }));
    const definition = {
      description: "Return an oversized result.",
      execute,
      input: strictObject({}),
      name: "github_list_pull_request_files",
    } satisfies RemoteAgentToolDefinition;
    const runtime = createRuntime({
      execute: async (tools) => {
        const listFiles = tools.github_list_pull_request_files;
        if (!listFiles?.execute) {
          throw new Error("GitHub pull request file tool is unavailable.");
        }
        return {
          result: await listFiles.execute({}, TOOL_OPTIONS),
        };
      },
      executorOptions: [],
    });
    const tool = await createRemoteAgentCodeModeFlueTool({
      coreWorker,
      definitions: [definition],
      env: {},
      loader: {} as WorkerLoader,
      runtime,
      storage,
      submissionId: SUBMISSION_ID,
    });

    const output = await runCodeModeTool(tool, {
      input: { code: "async () => null" },
    });
    expect(output).toMatchObject({
      result: {
        toolExecution: "returned",
        resultMetadata: { operationId: "write-1", status: "completed" },
        presentation: { kind: "partial", continuation: null },
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(isRemoteAgentToolResultWithinLimit(output)).toBe(true);
  });

  it("gives the exact callable name when a discovered capability is used as a global", async () => {
    const storage = await createStorage(createSubmitTurnRequest());
    const execute = vi.fn();
    const runtime = createRuntime({
      executorOptions: [],
      execute: () => {
        throw new ReferenceError("openmeld_create_routine is not defined");
      },
    });
    const tool = await createRemoteAgentCodeModeFlueTool({
      definitions: [
        {
          name: "openmeld_create_routine",
          description: "Create a Routine",
          input: strictObject({}),
          execute,
        },
      ],
      env: {},
      loader: {} as WorkerLoader,
      runtime,
      storage,
      submissionId: SUBMISSION_ID,
    });
    await expect(
      runCodeModeTool(tool, {
        input: { code: "async () => openmeld_create_routine({})" },
      })
    ).rejects.toThrow("codemode.openmeld_create_routine(input)");
    expect(execute).not.toHaveBeenCalled();
  });

  it("records failures without exposing generated code or tool arguments", async () => {
    const request = createSubmitTurnRequest();
    const storage = await createStorage(request);
    const writeDataPoint = vi.fn();
    const runtime = createRuntime({
      execute: () => {
        throw new Error("isolated execution failed");
      },
      executorOptions: [],
    });
    const tool = await createRemoteAgentCodeModeFlueTool({
      definitions: [],
      env: {
        OPENMELD_OBSERVABILITY: {
          writeDataPoint,
        } as unknown as AnalyticsEngineDataset,
      },
      loader: {} as WorkerLoader,
      runtime,
      storage,
      submissionId: SUBMISSION_ID,
    });

    await expect(
      runCodeModeTool(tool, {
        input: {
          code: 'async () => "secret generated code"',
        },
      })
    ).rejects.toThrow("isolated execution failed");

    const serializedPoint = JSON.stringify(
      writeDataPoint.mock.calls.at(-1)?.[0]
    );
    expect(serializedPoint).toContain("cloudflare_codemode");
    expect(serializedPoint).not.toContain("secret generated code");
    expect(serializedPoint).not.toContain("isolated execution failed");
  });

  it("counts outer Code Mode calls toward the submission tool budget", async () => {
    const storage = await createStorage(createSubmitTurnRequest());
    await initializeRemoteAgentExecutionState({
      identity: buildRemoteAgentExecutionIdentity({
        ...createSubmitTurnRequest(),
        submissionId: SUBMISSION_ID,
      }),
      acceptedAtMs: TEST_NOW_MS,
      storage,
    });
    const tool = await createRemoteAgentCodeModeFlueTool({
      callLimit: 64,
      definitions: [],
      env: {},
      loader: {} as WorkerLoader,
      runtime: createRuntime({
        execute: async () => ({ result: null }),
        executorOptions: [],
      }),
      storage,
      submissionId: SUBMISSION_ID,
    });

    for (let index = 0; index < 64; index += 1) {
      await expect(
        runCodeModeTool(tool, { input: { code: "async () => null" } })
      ).resolves.toEqual({ result: null });
    }
    await expect(
      runCodeModeTool(tool, { input: { code: "async () => null" } })
    ).rejects.toBeInstanceOf(RemoteAgentToolCallBudgetExceededError);
  });

  it("shows an admitted inner tool failure without publishing private error text", async () => {
    const request = createSubmitTurnRequest();
    const storage = await createStorage(request);
    const submitRemoteAgentStreamPart = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const definition = {
      description: "Read Space context.",
      execute: () => {
        throw new Error("private internal failure");
      },
      input: strictObject({}),
      name: "openmeld_read_space_context",
    } satisfies RemoteAgentToolDefinition;
    const runtime = createRuntime({
      execute: async (tools) => {
        const lookup = tools.openmeld_read_space_context;
        if (!lookup?.execute) {
          throw new Error("Code Mode lookup tool is unavailable.");
        }
        return {
          result: await lookup.execute({}, TOOL_OPTIONS),
        };
      },
      executorOptions: [],
    });
    const tool = await createRemoteAgentCodeModeFlueTool({
      coreWorker: { submitRemoteAgentStreamPart },
      definitions: [definition],
      env: {},
      loader: {} as WorkerLoader,
      runtime,
      storage,
      streamPublisher: createRemoteAgentStreamPublisher(),
      submissionId: SUBMISSION_ID,
    });

    await expect(
      runCodeModeTool(tool, { input: { code: "async () => null" } })
    ).rejects.toThrow("private internal failure");
    expect(submitRemoteAgentStreamPart).toHaveBeenCalledTimes(2);
    expect(submitRemoteAgentStreamPart).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        part: expect.objectContaining({ state: "input-available" }),
      })
    );
    expect(submitRemoteAgentStreamPart).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        part: expect.objectContaining({ state: "output-error" }),
      })
    );
    expect(
      JSON.stringify(submitRemoteAgentStreamPart.mock.calls)
    ).not.toContain("private internal failure");
  });

  it("does not let optional Work summary publishing change tool truth", async () => {
    const request = createSubmitTurnRequest();
    const storage = await createStorage(request);
    const executeLookup = vi.fn(async () => ({ spaces: [] }));
    const definition = {
      description: "List Spaces.",
      execute: executeLookup,
      input: strictObject({}),
      name: "openmeld_list_spaces",
    } satisfies RemoteAgentToolDefinition;
    const runtime = createRuntime({
      execute: async (tools) => {
        const lookup = tools.openmeld_list_spaces;
        if (!lookup?.execute) {
          throw new Error("Code Mode lookup tool is unavailable.");
        }
        return {
          result: await lookup.execute({}, TOOL_OPTIONS),
        };
      },
      executorOptions: [],
    });
    const streamPublisher = {
      pushPart: vi.fn(() =>
        Promise.reject(new Error("presentation unavailable"))
      ),
    } as unknown as RemoteAgentStreamPublisher;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const tool = await createRemoteAgentCodeModeFlueTool({
      definitions: [definition],
      env: {},
      loader: {} as WorkerLoader,
      runtime,
      storage,
      streamPublisher,
      submissionId: SUBMISSION_ID,
    });

    await expect(
      runCodeModeTool(tool, { input: { code: "async () => null" } })
    ).resolves.toEqual({ result: { spaces: [] } });
    expect(executeLookup).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "[remote_agent.code_mode_work_publish_failed]",
      expect.objectContaining({
        submissionId: SUBMISSION_ID,
        toolName: "openmeld_list_spaces",
      })
    );
    warn.mockRestore();
  });

  it("composes the personal Computer interface inside Code Mode", async () => {
    const storage = await createStorage(createSubmitTurnRequest());
    const execute = vi.fn(async () => ({
      kind: "files",
      result: { isError: false, content: [{ type: "text", text: "hello" }] },
    }));
    const definition = createNativeComputerTool({
      invocationId: SUBMISSION_ID,
      workingDirectory: "/computer/tasks/test",
      workspaceAccess: {
        computerOperation: execute,
        withWorkspace: () => {
          throw new Error("Use the operation owner");
        },
      },
    });
    const runtime = createRuntime({
      execute: async (tools) => ({
        result: await tools.computer?.execute?.(
          {
            action: "files",
            tool: "read",
            input: { path: "/computer/home/test.txt" },
          },
          TOOL_OPTIONS
        ),
      }),
      executorOptions: [],
    });
    const tool = await createRemoteAgentCodeModeFlueTool({
      definitions: [definition],
      env: {},
      loader: {} as WorkerLoader,
      runtime,
      storage,
      submissionId: SUBMISSION_ID,
    });
    await expect(
      runCodeModeTool(tool, { input: { code: "async () => null" } })
    ).resolves.toMatchObject({ result: { kind: "files" } });
    expect(execute).toHaveBeenCalledWith({
      action: "files",
      tool: "read",
      input: { path: "/computer/home/test.txt" },
    });
  });
});

type LegacyCodeModeTruncateResult = (
  value: unknown,
  options: { maxChars: number }
) => unknown;

function createRuntime(input: {
  execute(
    tools: ToolSet,
    code: string
  ): Promise<{ logs?: string[]; result: unknown }>;
  executorOptions: unknown[];
  truncateResult?: LegacyCodeModeTruncateResult;
}): RemoteAgentCodeModeRuntime & {
  truncateResult: LegacyCodeModeTruncateResult;
} {
  return {
    createCodeTool: ({ tools }) => ({
      description:
        "Execute JavaScript with these tools.\n\n" +
        `declare const codemode: { ${Object.keys(tools)
          .map((name) => `${name}(input: unknown): Promise<unknown>`)
          .join("; ")} };`,
      execute: ({ code }) => input.execute(tools, code),
    }),
    createExecutor: (options) => {
      input.executorOptions.push(options);
      return {};
    },
    truncateResult: input.truncateResult ?? ((value) => value),
  };
}

async function createStorage(
  request: ReturnType<typeof createSubmitTurnRequest>
): Promise<InMemoryDurableObjectStorage> {
  const storage = new InMemoryDurableObjectStorage();
  await putRemoteAgentCallbackContext(
    storage,
    createRemoteAgentCallbackContext({
      ack: {
        accepted: true,
        createdAt: TEST_NOW_MS,
        requestId: SUBMISSION_ID,
        status: "pending",
        submissionId: SUBMISSION_ID,
      },
      nowMs: TEST_NOW_MS,
      request,
    })
  );
  return storage;
}
