import type { SessionEnv } from "@flue/runtime";
import { CENTER_AGENT_DELEGATION_COMPLETION_MODES } from "@openmeld/schemas";
import { asSchema, type ToolExecutionOptions, type ToolSet } from "ai";
import { pipe, rawCheck, strictObject, string } from "valibot";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import { getRemoteAgentOpenMeldToolDefinitions } from "../agent-core/tools";
import {
  createRemoteAgentCodeModeFlueTool,
  type RemoteAgentCodeModeRuntime,
} from "../flue-adapter/code-mode";
import {
  getRemoteAgentSandboxToolDefinitions,
  REMOTE_AGENT_SANDBOX_TOOL_NAMES,
} from "../flue-adapter/sandbox-tools";
import {
  createRemoteAgentStreamPublisher,
  type RemoteAgentStreamPublisher,
} from "../flue-adapter/streaming";
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

describe("Remote Agent Code Mode", () => {
  it("exposes structured Space Reference input in the generated Code Mode catalog", async () => {
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
      truncateResult: (value) => value,
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
        referenceProfileIds: {
          description:
            "Every exact Human or Agent Profile ID that this Space message includes as context without assigning work. Pass an empty array only when no context-only profile is requested.",
          items: { type: "string" },
          maxItems: 25,
          type: "array",
        },
      },
      required: [
        "agentProfileIds",
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
        referenceProfileIds: [HUMAN_PROFILE_ID],
        spaceId: SPACE_ID,
        text: "Please review this.",
      })
    ).toMatchObject({
      success: true,
      value: {
        agentProfileIds: [AGENT_PROFILE_ID],
        completionMode: "child_reports_directly",
        referenceProfileIds: [HUMAN_PROFILE_ID],
      },
    });
    expect(
      wakeInputSchema.validate({
        agentProfileIds: [],
        completionMode: "child_reports_directly",
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
      tool.run({
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
    expect(submitRemoteAgentStreamPart).toHaveBeenCalledOnce();
    expect(submitRemoteAgentStreamPart).toHaveBeenCalledWith(
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
        indexes: [request.organizationId, request.spaceId, SUBMISSION_ID],
      })
    );
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
      tool.run({
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

  it("keeps inner tool failures out of Work summary", async () => {
    const request = createSubmitTurnRequest();
    const storage = await createStorage(request);
    const submitRemoteAgentStreamPart = vi.fn();
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
      tool.run({ input: { code: "async () => null" } })
    ).rejects.toThrow("private internal failure");
    expect(submitRemoteAgentStreamPart).not.toHaveBeenCalled();
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
      tool.run({ input: { code: "async () => null" } })
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

  it("composes the exact active Sandbox tools inside Code Mode", async () => {
    const request = createSubmitTurnRequest();
    const storage = await createStorage(request);
    const exec = vi.fn(async () => ({
      exitCode: 0,
      stderr: "",
      stdout: "sandbox-composition-ok\n",
    }));
    const definitions = getRemoteAgentSandboxToolDefinitions({
      env: { exec } as unknown as SessionEnv,
    });
    const runtime = createRuntime({
      execute: async (tools) => {
        const bash = tools.bash;
        if (!bash?.execute) {
          throw new Error("Code Mode Sandbox bash tool is unavailable.");
        }
        const executeBash = bash.execute as (
          input: Record<string, unknown>
        ) => PromiseLike<unknown> | unknown;
        return {
          result: await executeBash({
            command: "printf 'sandbox-composition-ok\\n'",
          }),
        };
      },
      executorOptions: [],
    });
    const tool = await createRemoteAgentCodeModeFlueTool({
      definitions,
      env: {},
      loader: {} as WorkerLoader,
      runtime,
      storage,
      submissionId: SUBMISSION_ID,
    });

    expect(definitions.map((definition) => definition.name)).toEqual(
      REMOTE_AGENT_SANDBOX_TOOL_NAMES
    );
    expect(tool.description).toContain("bash");
    await expect(
      tool.run({
        input: {
          code: `async () => codemode.bash({ command: "printf 'sandbox-composition-ok\\\\n'" })`,
        },
      })
    ).resolves.toEqual({
      result: {
        exitCode: 0,
        stderr: "",
        stdout: "sandbox-composition-ok\n",
      },
    });
    expect(exec).toHaveBeenCalledWith(
      "printf 'sandbox-composition-ok\\n'",
      expect.objectContaining({ signal: undefined })
    );
  });
});

function createRuntime(input: {
  execute(
    tools: ToolSet,
    code: string
  ): Promise<{ logs?: string[]; result: unknown }>;
  executorOptions: unknown[];
}): RemoteAgentCodeModeRuntime {
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
    truncateResult: (value) => value,
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
