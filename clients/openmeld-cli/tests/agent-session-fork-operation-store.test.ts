import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeTransportLocalAgentControlForkSessionFramePayload } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentSessionForkOperation } from "../src/local-service/session-control/session-fork-operation-store";

const request: RuntimeTransportLocalAgentControlForkSessionFramePayload["request"] =
  {
    agentControllerRef: "builtin:codex",
    operationId: "request-1",
    organizationId: "organization-1",
    profileName: "Research Agent",
    projectId: "project-1",
    sourceNativeSessionId: "source-session-1",
  };

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("Agent Session Fork operation store", () => {
  it("replays the child Session id without calling the provider twice", async () => {
    const ledgerRootPath = await createLedgerRoot();
    const execute = vi.fn(async () => ({
      childNativeSessionId: "child-session-1",
    }));

    const first = await runAgentSessionForkOperation({
      execute,
      ledgerRootPath,
      request,
    });
    const replayExecute = vi.fn(() =>
      Promise.reject(new Error("the provider must not run twice"))
    );
    const replay = await runAgentSessionForkOperation({
      execute: replayExecute,
      ledgerRootPath,
      request,
    });

    expect(first).toMatchObject({
      childNativeSessionId: "child-session-1",
      status: "completed",
    });
    expect(replay).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(replayExecute).not.toHaveBeenCalled();
  });

  it("keeps an unknown provider outcome from creating a second child Session", async () => {
    const ledgerRootPath = await createLedgerRoot();
    const execute = vi.fn(() =>
      Promise.reject(new Error("the provider response was lost"))
    );

    const first = await runAgentSessionForkOperation({
      execute,
      ledgerRootPath,
      request,
    });
    const retryExecute = vi.fn(async () => ({
      childNativeSessionId: "duplicate-child",
    }));
    const retry = await runAgentSessionForkOperation({
      execute: retryExecute,
      ledgerRootPath,
      request,
    });

    expect(first).toMatchObject({
      reasonCode: "agent_session_fork.provider_outcome_unknown",
      status: "outcome_unknown",
    });
    expect(retry).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(retryExecute).not.toHaveBeenCalled();
  });

  it("rejects a reused operation id with different Session details", async () => {
    const ledgerRootPath = await createLedgerRoot();
    await runAgentSessionForkOperation({
      execute: async () => ({ childNativeSessionId: "child-session-1" }),
      ledgerRootPath,
      request,
    });
    const execute = vi.fn(async () => ({
      childNativeSessionId: "child-session-2",
    }));

    const result = await runAgentSessionForkOperation({
      execute,
      ledgerRootPath,
      request: { ...request, sourceNativeSessionId: "different-source" },
    });

    expect(result).toMatchObject({
      reasonCode: "agent_session_fork.operation_identity_conflict",
      status: "rejected",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed without changing a corrupt operation store", async () => {
    const ledgerRootPath = await createLedgerRoot();
    const storePath = join(
      ledgerRootPath,
      "agent-session-fork-operations.json"
    );
    const corruptSource = "{not valid json";
    await writeFile(storePath, corruptSource);
    const execute = vi.fn(async () => ({
      childNativeSessionId: "child-session-1",
    }));

    const result = await runAgentSessionForkOperation({
      execute,
      ledgerRootPath,
      request,
    });

    expect(result).toMatchObject({
      reasonCode: "agent_session_fork.operation_store_invalid",
      status: "rejected",
    });
    expect(execute).not.toHaveBeenCalled();
    expect(await readFile(storePath, "utf8")).toBe(corruptSource);
  });
});

async function createLedgerRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openmeld-session-fork-"));
  roots.push(root);
  return root;
}
