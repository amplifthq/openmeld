import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { prepareFlueCenterAgentAdmission } from "../flue-adapter/center-agent-admission";

const CENTER_AGENT_SOURCE = fileURLToPath(
  new URL("../.flue/agents/center-agent.ts", import.meta.url)
);

describe("Center Agent admission concurrency", () => {
  it("routes the callback alarm through the single reconciliation and redelivery owner", async () => {
    const source = await readFile(CENTER_AGENT_SOURCE, "utf8");
    const methodStart = source.indexOf("async retryRemoteAgentCallbacks()");
    const methodEnd = source.indexOf("async readExecutionState(", methodStart);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodEnd).toBeGreaterThan(methodStart);
    expect(source.slice(methodStart, methodEnd)).toContain(
      "await reconcileAndRedeliverRemoteAgentCallbacks({"
    );
  });

  it("lets Flue own conversation serialization without an outer Durable Object lock", async () => {
    const source = await readFile(CENTER_AGENT_SOURCE, "utf8");
    const methodStart = source.indexOf("async submitConversationTurn(");
    const methodEnd = source.indexOf(
      "async retryRemoteAgentCallbacks()",
      methodStart
    );

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodEnd).toBeGreaterThan(methodStart);

    const admissionMethod = source.slice(methodStart, methodEnd);

    expect(admissionMethod).not.toContain("blockConcurrencyWhile");
  });

  it("routes Flue operations in-process without re-entering Durable Object fetch", async () => {
    const source = await readFile(CENTER_AGENT_SOURCE, "utf8");
    const extensionStart = source.indexOf("async submitConversationTurn(");
    const extensionEnd = source.indexOf(
      "function requireRemoteAgentDurableObjectName(",
      extensionStart
    );

    expect(extensionStart).toBeGreaterThanOrEqual(0);
    expect(extensionEnd).toBeGreaterThan(extensionStart);

    const extensionMethods = source.slice(extensionStart, extensionEnd);

    expect(extensionMethods).not.toContain("this.fetch");
    expect(extensionMethods).toContain("await this.onRequest(request)");
  });

  it("honors durable receipts before checking new-admission footprint", async () => {
    const assertConversationFootprintSchema = vi.fn();
    const cleanupFinalizedSubmissionReplay = vi.fn(async () => undefined);
    const readConversationFootprint = vi.fn(() => ({
      batchCount: 1,
      canonicalBytes: 13 * 1024 * 1024,
      largestBatchBytes: 13 * 1024 * 1024,
      level: "hard_limit" as const,
    }));
    const reportConversationFootprint = vi.fn();
    const finalizedReceipt = {
      result: { ack: { submissionId: "submission-finalized" } },
      status: "finalized" as const,
    };

    await expect(
      prepareFlueCenterAgentAdmission({
        assertConversationFootprintSchema,
        cleanupFinalizedSubmissionReplay,
        readConversationFootprint,
        readExistingSubmission: async () => finalizedReceipt,
        reportConversationFootprint,
      })
    ).resolves.toEqual({
      outcome: "finalized",
      submission: finalizedReceipt,
    });
    expect(readConversationFootprint).not.toHaveBeenCalled();
    expect(assertConversationFootprintSchema).not.toHaveBeenCalled();
    expect(cleanupFinalizedSubmissionReplay).toHaveBeenCalledOnce();

    await expect(
      prepareFlueCenterAgentAdmission({
        assertConversationFootprintSchema,
        cleanupFinalizedSubmissionReplay,
        readConversationFootprint,
        readExistingSubmission: async () => ({
          claimedAtMs: 1000,
          status: "claimed",
        }),
        reportConversationFootprint,
      })
    ).resolves.toMatchObject({ admission: "claimed", outcome: "ready" });
    expect(readConversationFootprint).not.toHaveBeenCalled();
    expect(assertConversationFootprintSchema).toHaveBeenCalledOnce();
    expect(cleanupFinalizedSubmissionReplay).toHaveBeenCalledOnce();

    assertConversationFootprintSchema.mockClear();
    await expect(
      prepareFlueCenterAgentAdmission({
        assertConversationFootprintSchema,
        cleanupFinalizedSubmissionReplay,
        readConversationFootprint,
        readExistingSubmission: async () => null,
        reportConversationFootprint,
      })
    ).resolves.toMatchObject({ outcome: "rejected" });
    expect(readConversationFootprint).toHaveBeenCalledTimes(1);
    expect(assertConversationFootprintSchema).not.toHaveBeenCalled();
    expect(cleanupFinalizedSubmissionReplay).toHaveBeenCalledOnce();
  });

  it("admits and reports a soft-limit conversation", async () => {
    const callOrder: string[] = [];
    const footprint = {
      batchCount: 8,
      canonicalBytes: 9 * 1024 * 1024,
      largestBatchBytes: 2 * 1024 * 1024,
      level: "soft_limit" as const,
    };

    await expect(
      prepareFlueCenterAgentAdmission({
        assertConversationFootprintSchema: () => undefined,
        cleanupFinalizedSubmissionReplay: async () => undefined,
        readConversationFootprint: () => footprint,
        readExistingSubmission: async () => null,
        reportConversationFootprint: (observedFootprint) => {
          callOrder.push(`footprint:${observedFootprint.level}`);
        },
      })
    ).resolves.toEqual({ admission: "new", footprint, outcome: "ready" });

    expect(callOrder).toEqual(["footprint:soft_limit"]);
  });

  it("persists evidence after its SQL adapter is initialized", async () => {
    const source = await readFile(CENTER_AGENT_SOURCE, "utf8");
    const methodStart = source.indexOf("async submitConversationTurn(");
    const methodEnd = source.indexOf(
      "async retryRemoteAgentCallbacks()",
      methodStart
    );

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodEnd).toBeGreaterThan(methodStart);

    const admissionMethod = source.slice(methodStart, methodEnd);
    const storageInitialization = admissionMethod.indexOf(
      "const storage = createRemoteAgentSqlStorage(this.ctx.storage.sql);"
    );
    const storageEvidence = admissionMethod.indexOf(
      'operation: "storage_initialized"'
    );

    expect(storageInitialization).toBeGreaterThanOrEqual(0);
    expect(storageEvidence).toBeGreaterThan(storageInitialization);
    expect(storageEvidence).toBeLessThan(
      admissionMethod.indexOf('operation: "submission_started"')
    );
  });
});
