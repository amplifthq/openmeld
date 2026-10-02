import {
  REMOTE_AGENT_RETAINED_RESULT_MAX_BYTES,
  REMOTE_AGENT_RETAINED_RESULT_TTL_MS,
  remoteAgentReadToolResultResponseSchema,
} from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { tagRemoteAgentResultSources } from "../agent-core/result-access";
import {
  cleanupExpiredRemoteAgentToolResults,
  REMOTE_AGENT_RETAINED_RESULT_PREFIX,
} from "../agent-core/result-retention";
import { isRemoteAgentToolResultWithinLimit } from "../agent-core/tool-result-boundary";
import {
  createRemoteAgentReadToolResultDefinition,
  prepareRemoteAgentToolResult,
} from "../flue-adapter/retained-tool-results";
import { executionAccessFixture } from "./execution-access-fixture";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

async function fixture(submissionId = "result-execution") {
  const request = createSubmitTurnRequest();
  const context = createRemoteAgentCallbackContext({
    request,
    nowMs: TEST_NOW_MS,
    ack: {
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      requestId: submissionId,
      status: "pending",
      submissionId,
    },
  });
  const storage = new InMemoryDurableObjectStorage();
  await putRemoteAgentCallbackContext(storage, context);
  const authorize = vi.fn(executionAccessFixture(context));
  const dependencies = {
    storage,
    submissionId,
    coreWorker: { authorizeRemoteAgentExecutionAccess: authorize },
  };
  const tool = createRemoteAgentReadToolResultDefinition(dependencies);
  return { ...dependencies, context, authorize, tool };
}

function continuation(value: unknown) {
  const result = value as {
    presentation: {
      continuation: { resultId: string; expiresAtMs: number } | null;
    };
  };
  if (!result.presentation.continuation) {
    throw new Error("Expected a retained result reference");
  }
  return result.presentation.continuation;
}

const largeValue = () => ({
  status: "completed",
  operationId: "write-once",
  log: `${"first 🐈\n".repeat(11_000)}UNIQUE_MIDDLE_FAILURE${"last 🚀\n".repeat(11_000)}`,
});

describe("retained tool results", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns small results directly without creating a second result store entry", async () => {
    const f = await fixture();
    const value = { count: 3 };
    expect(
      await prepareRemoteAgentToolResult({ ...f, toolName: "example", value })
    ).toEqual(value);
    expect(f.authorize).not.toHaveBeenCalled();
    expect(
      (await f.storage.list({ prefix: REMOTE_AGENT_RETAINED_RESULT_PREFIX }))
        .size
    ).toBe(0);
  });

  it.each([
    largeValue,
    () => ({
      status: "completed",
      operationId: "write-once",
      log: `${"first ".repeat(3000)}UNIQUE_MIDDLE_FAILURE${"last ".repeat(3500)}`,
    }),
  ])("finds omitted evidence and reconstructs exact JSON without repeating the action", async (makeValue) => {
    const f = await fixture();
    const execute = vi.fn(async () => makeValue());
    const raw = await execute();
    const displayed = await prepareRemoteAgentToolResult({
      ...f,
      toolName: "github_get_job_logs",
      value: raw,
    });
    expect(isRemoteAgentToolResultWithinLimit(displayed)).toBe(true);
    expect(displayed).toMatchObject({
      toolExecution: "returned",
      resultMetadata: { status: "completed", operationId: "write-once" },
    });
    const { resultId } = continuation(displayed);
    const search = remoteAgentReadToolResultResponseSchema.parse(
      await f.tool.execute({ resultId, query: "UNIQUE_MIDDLE_FAILURE" })
    );
    expect(search.kind).toBe("search");
    if (search.kind !== "search") {
      throw new Error("Expected search");
    }
    expect(search.matches).toHaveLength(1);
    expect(search.matches[0]?.text).toContain("UNIQUE_MIDDLE_FAILURE");
    let offset: number | null = 0;
    let full = "";
    while (offset !== null) {
      const page = remoteAgentReadToolResultResponseSchema.parse(
        await f.tool.execute({ resultId, offset, limit: 11_999 })
      );
      if (page.kind !== "read") {
        throw new Error("Expected a page");
      }
      expect(page.offset).toBe(offset);
      expect(page.text.isWellFormed()).toBe(true);
      expect(isRemoteAgentToolResultWithinLimit(page)).toBe(true);
      full += page.text;
      offset = page.nextOffset;
    }
    expect(full).toBe(JSON.stringify(raw));
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not re-retain a bounded Unicode continuation page", async () => {
    const f = await fixture();
    const page = { text: "猫".repeat(12_000), nextOffset: null };
    expect(
      await prepareRemoteAgentToolResult({
        ...f,
        toolName: "openmeld_read_tool_result",
        value: page,
      })
    ).toEqual(page);
  });

  it("does not disclose a guessed reference from a different execution even in the same audience", async () => {
    const original = await fixture();
    const other = await fixture("other-execution");
    const { resultId } = continuation(
      await prepareRemoteAgentToolResult({
        ...original,
        toolName: "example",
        value: largeValue(),
      })
    );
    await putRemoteAgentCallbackContext(original.storage, other.context);
    const tool = createRemoteAgentReadToolResultDefinition({
      ...other,
      storage: original.storage,
    });
    await expect(tool.execute({ resultId })).rejects.toThrow(
      "not part of this execution"
    );
    expect(other.authorize).not.toHaveBeenCalled();
  });

  it("rechecks current source connection permissions, and never trusts provenance in provider JSON", async () => {
    const f = await fixture();
    const source = {
      kind: "plugin_connection" as const,
      service: "github" as const,
      connectionName: "connection-from-core",
      connectionUpdatedAtMs: 123,
    };
    const raw = tagRemoteAgentResultSources(
      {
        ...largeValue(),
        sources: [{ connectionName: "forged-provider-field" }],
      },
      [source]
    );
    const { resultId } = continuation(
      await prepareRemoteAgentToolResult({
        ...f,
        toolName: "github_get_job_logs",
        value: raw,
      })
    );
    await f.tool.execute({ resultId, query: "UNIQUE_MIDDLE_FAILURE" });
    expect(f.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ sources: [source] })
    );
    f.authorize.mockRejectedValueOnce(new Error("plugin.action_forbidden"));
    await expect(f.tool.execute({ resultId })).rejects.toThrow(
      "plugin.action_forbidden"
    );
  });

  it.each([
    0,
    180_000,
    REMOTE_AGENT_RETAINED_RESULT_MAX_BYTES + 1,
  ])("withholds private fields and excerpts after denial at size %i", async (size) => {
    const f = await fixture();
    f.authorize.mockRejectedValue(new Error("plugin.action_forbidden"));
    const value = tagRemoteAgentResultSources(
      {
        privateField: "PRIVATE_SENTINEL",
        log: `PRIVATE_SENTINEL${"x".repeat(size)}`,
      },
      [
        {
          kind: "plugin_connection",
          service: "github",
          connectionName: "source",
          connectionUpdatedAtMs: 1,
        },
      ]
    );
    const result = await prepareRemoteAgentToolResult({
      ...f,
      toolName: "write",
      value,
    });
    expect(f.authorize).toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
    expect(result).toMatchObject({
      toolExecution: "returned",
      presentation: { kind: "withheld", continuation: null },
    });
    expect(result).not.toHaveProperty("resultMetadata");
  });

  it.each([
    false,
    true,
  ])("withholds results revoked during retention (storage failure: %s)", async (failStorage) => {
    const f = await fixture();
    const put = f.storage.putExpiring.bind(f.storage);
    vi.spyOn(f.storage, "putExpiring").mockImplementation(
      async (key, value, expiry) => {
        f.authorize.mockRejectedValue(new Error("revoked during persistence"));
        if (failStorage) {
          throw new Error("storage failed");
        }
        return await put(key, value, expiry);
      }
    );
    const result = await prepareRemoteAgentToolResult({
      ...f,
      toolName: "read",
      value: { ...largeValue(), privateField: "PRIVATE_SENTINEL" },
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
    expect(result).toMatchObject({ presentation: { kind: "withheld" } });
  });

  it("blocks retained reads when current execution authorization is revoked", async () => {
    const f = await fixture();
    const { resultId } = continuation(
      await prepareRemoteAgentToolResult({
        ...f,
        toolName: "example",
        value: largeValue(),
      })
    );
    f.authorize.mockRejectedValueOnce(
      new Error("remote_agent.execution_not_active")
    );
    const get = vi.spyOn(f.storage, "get");
    await expect(f.tool.execute({ resultId })).rejects.toThrow(
      "execution_not_active"
    );
    expect(get.mock.calls.some(([key]) => key.includes(":chunk:"))).toBe(false);
  });

  it("expires references and reclaims their chunks through the existing cleanup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_NOW_MS);
    const f = await fixture();
    const { resultId } = continuation(
      await prepareRemoteAgentToolResult({
        ...f,
        toolName: "example",
        value: largeValue(),
      })
    );
    await f.storage.put("unrelated", "leave it alone");
    vi.setSystemTime(TEST_NOW_MS + REMOTE_AGENT_RETAINED_RESULT_TTL_MS + 1);
    await expect(f.tool.execute({ resultId })).rejects.toThrow("expired");
    expect(
      (await cleanupExpiredRemoteAgentToolResults({ storage: f.storage }))
        .deleted
    ).toBeGreaterThan(0);
    expect(
      (await f.storage.list({ prefix: REMOTE_AGENT_RETAINED_RESULT_PREFIX }))
        .size
    ).toBe(0);
    expect(await f.storage.get("unrelated")).toBe("leave it alone");
  });

  it("does not turn a retention-store failure into failure of an already returned write", async () => {
    const f = await fixture();
    const put = f.storage.putExpiring.bind(f.storage);
    let chunks = 0;
    vi.spyOn(f.storage, "putExpiring").mockImplementation(
      async (key, value, expiry) => {
        if (key.includes(":chunk:") && ++chunks === 2) {
          throw new Error("storage unavailable");
        }
        return await put(key, value, expiry);
      }
    );
    const result = await prepareRemoteAgentToolResult({
      ...f,
      toolName: "create_pull_request",
      value: largeValue(),
    });
    expect(result).toMatchObject({
      toolExecution: "returned",
      resultMetadata: { status: "completed", operationId: "write-once" },
      presentation: { continuation: null },
    });
    await cleanupExpiredRemoteAgentToolResults({ storage: f.storage });
    expect(
      (await f.storage.list({ prefix: REMOTE_AGENT_RETAINED_RESULT_PREFIX }))
        .size
    ).toBe(0);
  });

  it("reports the storage size boundary honestly while preserving operation receipts", async () => {
    const f = await fixture();
    const result = await prepareRemoteAgentToolResult({
      ...f,
      toolName: "write",
      value: {
        status: "completed",
        operationId: "saved",
        data: "x".repeat(REMOTE_AGENT_RETAINED_RESULT_MAX_BYTES + 1),
      },
    });
    expect(result).toMatchObject({
      resultMetadata: { status: "completed", operationId: "saved" },
      presentation: { continuation: null },
    });
    expect(f.authorize).toHaveBeenCalledTimes(2);
  });

  it("enforces the snapshot budget under concurrent writes without losing already retained results", async () => {
    const f = await fixture();
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        prepareRemoteAgentToolResult({
          ...f,
          toolName: `read_${index}`,
          value: largeValue(),
        })
      )
    );
    const retained = outcomes.filter(
      (result) =>
        (result as { presentation: { continuation: unknown } }).presentation
          .continuation
    );
    expect(retained.length).toBeGreaterThan(0);
    expect(retained.length).toBeLessThanOrEqual(16);
    for (const result of retained) {
      const { resultId } = continuation(result);
      expect(
        await f.tool.execute({ resultId, query: "UNIQUE_MIDDLE_FAILURE" })
      ).toMatchObject({
        kind: "search",
        matches: [{ text: expect.stringContaining("UNIQUE_MIDDLE_FAILURE") }],
      });
    }
    expect(outcomes.every(isRemoteAgentToolResultWithinLimit)).toBe(true);
  });

  it("does not return retained data if permission is revoked during the read", async () => {
    const f = await fixture();
    const { resultId } = continuation(
      await prepareRemoteAgentToolResult({
        ...f,
        toolName: "example",
        value: largeValue(),
      })
    );
    const get = f.storage.get.bind(f.storage);
    vi.spyOn(f.storage, "get").mockImplementation(async (key) => {
      if (key.includes(":chunk:")) {
        f.authorize.mockRejectedValue(new Error("revoked during read"));
      }
      return await get(key);
    });
    await expect(f.tool.execute({ resultId })).rejects.toThrow(
      "revoked during read"
    );
  });

  it("reuses the immutable reference for an identical result without extending retention", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_NOW_MS);
    const f = await fixture();
    const first = continuation(
      await prepareRemoteAgentToolResult({
        ...f,
        toolName: "example",
        value: largeValue(),
      })
    );
    vi.setSystemTime(TEST_NOW_MS + 1000);
    const next = continuation(
      await prepareRemoteAgentToolResult({
        ...f,
        toolName: "example",
        value: largeValue(),
      })
    );
    expect(next).toEqual(first);
  });
});
