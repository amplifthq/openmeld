import { afterEach, describe, expect, it, vi } from "vitest";
import { createRemoteAgentCallbackContext } from "../agent-core/callback-context";
import {
  readComputerDataSources,
  recordComputerDataSource,
} from "../flue-adapter/computer-data-sources";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

function fixture() {
  const request = createSubmitTurnRequest();
  const context = createRemoteAgentCallbackContext({
    request,
    nowMs: TEST_NOW_MS,
    ack: {
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      requestId: "sources",
      submissionId: "sources",
      status: "pending",
    },
  });
  return { context, storage: new InMemoryDurableObjectStorage() };
}
const source = {
  kind: "plugin_connection" as const,
  service: "github" as const,
  connectionName: "original",
  connectionUpdatedAtMs: 42,
};
afterEach(() => vi.useRealTimers());
describe("Computer data provenance", () => {
  it("retains independent imported sources across subsequent executions and operation expiry", async () => {
    const f = fixture();
    await Promise.all([
      recordComputerDataSource({ ...f, source }),
      recordComputerDataSource({
        ...f,
        source: { ...source, connectionName: "other" },
      }),
    ]);
    await recordComputerDataSource({ ...f, source });
    expect(await readComputerDataSources(f)).toHaveLength(2);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 48 * 60 * 60 * 1000);
    await f.storage.deleteExpired({
      prefix: "github-working-copy:v1:",
      limit: 64,
      nowMs: Date.now(),
    });
    expect(
      await readComputerDataSources({
        ...f,
        context: { ...f.context, submissionId: "next-execution" },
      })
    ).toContainEqual(source);
  });
  it("never shares source provenance with another admitted conversation", async () => {
    const f = fixture();
    await recordComputerDataSource({ ...f, source });
    expect(
      await readComputerDataSources({
        ...f,
        context: { ...f.context, conversationId: "different-conversation" },
      })
    ).toEqual([]);
  });
});
