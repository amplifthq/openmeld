import {
  remoteAgentExecutionAccessRequestSchema,
  resolveRemoteAgentExecutionScope,
} from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { readRemoteAgentResultSources } from "../agent-core/result-access";
import { buildRemoteAgentName } from "../agent-core/submission";
import {
  createRemoteAgentCodeModeFlueTool,
  type RemoteAgentCodeModeRuntime,
} from "../flue-adapter/code-mode";
import { resolveRemoteAgentComputerName } from "../flue-adapter/computer-identity";
import { createRemoteAgentComputerCapability } from "../flue-adapter/computer-sandbox";
import {
  createRemoteAgentReadToolResultDefinition,
  prepareRemoteAgentToolResult,
} from "../flue-adapter/retained-tool-results";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { createComputerSourceFixture } from "./helpers/computer-source-fixture.test-support";
import { InMemoryDurableObjectStorage } from "./storage";

const workspace = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@cloudflare/computer", () => ({ getWorkspace: workspace.get }));
const source = {
  kind: "plugin_connection" as const,
  service: "github" as const,
  connectionName: "private-import",
  connectionUpdatedAtMs: 42,
};
const secret = "PRIVATE_RESULT_SENTINEL";
const options = { messages: [], toolCallId: "inner-read" };
afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const owner = createComputerSourceFixture();
  owner.store.record(source);
  const request = createSubmitTurnRequest();
  const context = createRemoteAgentCallbackContext({
    request,
    nowMs: TEST_NOW_MS,
    ack: {
      accepted: true,
      status: "pending",
      createdAt: TEST_NOW_MS,
      requestId: "read",
      submissionId: "read",
      idempotencyKey: request.idempotencyKey,
    },
  });
  const storage = new InMemoryDurableObjectStorage();
  await putRemoteAgentCallbackContext(storage, context);
  const state = { revoked: false };
  const authorize = vi.fn(async (raw: unknown) => {
    const value = remoteAgentExecutionAccessRequestSchema.parse(raw);
    if (
      state.revoked &&
      value.sources?.some(
        (item) => item.connectionName === source.connectionName
      )
    ) {
      throw new Error("source_revoked");
    }
    return await Promise.resolve({
      submissionId: value.submissionId,
      scope: resolveRemoteAgentExecutionScope(context),
    });
  });
  const coreWorker = { authorizeRemoteAgentExecutionAccess: authorize };
  workspace.get.mockResolvedValue({
    [Symbol.dispose]: vi.fn(),
    fs: {
      mkdir: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      readFile: vi.fn(async () => secret + "界".repeat(48_000)),
    },
  });
  const env = {
    AGENT_COMPUTER: {
      idFromName: (name: string) => name,
      get: () => owner.dataSources,
    },
  };
  const deps = {
    context,
    storage,
    coreWorker,
    env,
    includeOrganizationDocuments: false,
  };
  const capability = await createRemoteAgentComputerCapability(deps);
  const read = capability.definitions.find((tool) => tool.name === "read");
  if (!read) {
    throw new Error("Missing Computer read");
  }
  return {
    ...owner,
    ...deps,
    state,
    capability,
    read,
    submissionId: context.submissionId,
  };
}
function resultId(value: unknown) {
  const reference = (
    value as { presentation?: { continuation?: { resultId?: string } } }
  ).presentation?.continuation?.resultId;
  if (!reference) {
    throw new Error("Expected a retained result reference");
  }
  return reference;
}

describe("Computer results retain their authorization across owners", () => {
  it("denies the same Computer through a fresh generation/runtime storage after source revocation", async () => {
    const f = await fixture();
    expect(
      JSON.stringify(await f.read.execute({ path: "/computer/private.txt" }))
    ).toContain(secret);
    f.state.revoked = true;
    const next = {
      ...f.context,
      runtimeConversationId: "generation-2",
      submissionId: "next",
    };
    expect(buildRemoteAgentName(next)).not.toBe(
      buildRemoteAgentName(f.context)
    );
    expect(resolveRemoteAgentComputerName(next)).toBe(
      resolveRemoteAgentComputerName(f.context)
    );
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(storage, next);
    await expect(
      createRemoteAgentComputerCapability({ ...f, context: next, storage })
    ).rejects.toThrow("source_revoked");
  });

  it.each([
    "direct",
    "code_mode",
  ])("keeps actual Computer read provenance through %s and blocks retained reads", async (carrier) => {
    const f = await fixture();
    const retained = createRemoteAgentReadToolResultDefinition(f);
    let id = "";
    if (carrier === "direct") {
      const raw = await f.read.execute({ path: "/computer/private.txt" });
      expect(readRemoteAgentResultSources(raw)).toEqual([source]);
      id = resultId(
        await prepareRemoteAgentToolResult({
          ...f,
          toolName: "read",
          value: raw,
        })
      );
    } else {
      const runtime: RemoteAgentCodeModeRuntime = {
        createExecutor: () => ({}),
        createCodeTool: ({ tools }) => ({
          description: "Computer result access contract",
          execute: async () => {
            const first = await tools.read?.execute?.(
              { path: "/computer/private.txt" },
              options
            );
            id = resultId(first);
            f.state.revoked = true;
            await expect(
              tools.openmeld_read_tool_result?.execute?.(
                { resultId: id },
                options
              )
            ).rejects.toThrow("source_revoked");
            return { result: { privateField: secret } };
          },
        }),
      };
      const tool = await createRemoteAgentCodeModeFlueTool({
        ...f,
        definitions: [...f.capability.definitions, retained],
        env: {},
        loader: {} as WorkerLoader,
        runtime,
      });
      const output = await tool.run({
        data: { code: "async () => null" },
        log: console,
        toolCallId: "code",
      });
      expect(JSON.stringify(output)).not.toContain(secret);
    }
    f.state.revoked = true;
    await expect(
      f.read.execute({ path: "/computer/private.txt" })
    ).rejects.toThrow("source_revoked");
    await expect(
      retained.execute({ resultId: id, query: secret })
    ).rejects.toThrow("source_revoked");
  });
});
