import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { SpaceApi } from "@openmeld/api-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenMeldProfile } from "../src/config/openmeld-profiles-api";
import { DISPATCH_OWNED_RUNTIME_MODE } from "../src/runtime/dispatch-runtime-env";
import {
  createDispatchSpaceActionContext,
  readDispatchSpaceActionRecord,
} from "../src/runtime/dispatch-space-action-context";
import { createSpaceActionMcpServer } from "../src/space/action-mcp-server";
import { readDispatchSpaceHistory } from "../src/space/dispatch-history-read";

const { listSignals, requireProfile } = vi.hoisted(() => ({
  listSignals: vi.fn<SpaceApi["listSignals"]>(),
  requireProfile: vi.fn(),
}));
vi.mock("../src/space/cli-space-api", () => ({
  createCliSpaceApi: () => ({ listSignals }),
}));
vi.mock("../src/config/resolve-openmeld-profile", () => ({
  requireOpenMeldProfile: requireProfile,
}));
vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: async () => "https://test.invalid",
}));
// Public Space-history envelope captured during the 2026-09-15 local smoke;
// identity and text anonymized, canonical envelope/message shape preserved.
const signal = {
  v: 1,
  id: "11111111-1111-4111-8111-111111111111",
  spaceId: "test-space",
  ts: 1_789_404_393_677,
  profile: {
    kind: "human",
    profileId: "22222222-2222-4222-8222-222222222222",
    profileHandle: "casey",
    profileName: "Casey",
  },
  type: "signal.text",
  data: {
    text: "Summarize our recent topic.",
    messageEnvelope: {
      activationTargets: ["agt_33333333-3333-4333-8333-333333333333"],
      referenceTargets: [],
      text: "Summarize our recent topic.",
    },
    meta: { clientMessageId: "44444444-4444-4444-8444-444444444444" },
  },
};
const profile: OpenMeldProfile = {
  openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
  profileKind: "agent",
  profileName: "Reader",
  profileHandle: "reader",
  ownerUserId: "owner",
  status: "active",
  source: "user",
  createdByUserId: "owner",
  lastUsedAt: null,
  createdAt: "2026-09-15",
  updatedAt: "2026-09-15",
};
const homes: string[] = [];
beforeEach(() => {
  listSignals
    .mockReset()
    .mockResolvedValue({ signals: [signal], nextCursor: null });
  requireProfile.mockReset().mockResolvedValue(profile);
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});
function setup(ttlMs = 60_000) {
  const home = mkdtempSync(join(tmpdir(), "openmeld-dispatch-history-"));
  homes.push(home);
  const result = createDispatchSpaceActionContext({
    attemptId: "attempt",
    dispatchId: "dispatch",
    sourceEventId: signal.id,
    taskId: "task",
    spaceId: signal.spaceId,
    targetProfileId: profile.openMeldProfileId,
    ttlMs,
    env: { OPENMELD_HOME: home },
    sendTargetReference: {
      status: "loaded",
      projection: [],
      referenceLines: [],
    },
    spaceContractSnapshot: {
      allowedActions: ["post_message"],
      publicationMode: "collaboration",
    },
  });
  for (const [key, value] of Object.entries({
    OPENMELD_HOME: home,
    OPENMELD_SPACE_ACTION_CONTEXT_PATH: result.contextPath,
    OPENMELD_DISPATCH_RUNTIME_MODE: DISPATCH_OWNED_RUNTIME_MODE,
    OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID: result.context.dispatchId,
    OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID: result.context.targetProfileId,
  })) {
    vi.stubEnv(key, value);
  }
  return result;
}

describe("dispatch Space history reader", () => {
  it("reads a fixed current-Wake window through MCP as the current Agent without finalizing", async () => {
    const { context } = setup();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createSpaceActionMcpServer();
    const client = new Client({ name: "history-test", version: "1" });
    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const catalog = await client.listTools();
      expect(
        catalog.tools.find((tool) => tool.name === "read_history")?.outputSchema
      ).toMatchObject({
        type: "object",
        properties: { signals: { type: "array", maxItems: 21 } },
      });
      const result = await client.callTool({
        name: "read_history",
        arguments: {},
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        spaceId: context.spaceId,
        sourceSignalId: context.sourceEventId,
        beforeCount: 20,
        afterCount: 0,
        signals: [{ id: signal.id }],
      });
      expect(listSignals).toHaveBeenCalledWith({
        spaceId: context.spaceId,
        requestContext: expect.objectContaining({
          actorContext: expect.objectContaining({
            openMeldProfileId: context.targetProfileId,
          }),
        }),
        query: {
          aroundSignalId: context.sourceEventId,
          beforeCount: 20,
          afterCount: 0,
          kinds: ["text"],
        },
      });
      expect(requireProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          openMeldProfileId: context.targetProfileId,
          persistSelection: false,
        })
      );
      expect(readDispatchSpaceActionRecord({ context }).status).toBe("missing");
      const rejected = await client.callTool({
        name: "read_history",
        arguments: { spaceId: "other-space" },
      });
      expect(rejected.isError).toBe(true);
      expect(listSignals).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each([
    "expired",
    "denied",
    "wrong Space",
    "wrong Profile",
    "expired during read",
    "too many signals",
  ])("preserves a %s failure without exposing history or recording a reply", async (kind) => {
    const { context, contextPath } = setup(kind === "expired" ? -1 : 60_000);
    if (kind === "denied") {
      listSignals.mockRejectedValue(new Error("space.access_denied"));
    }
    if (kind === "wrong Space") {
      listSignals.mockResolvedValue({
        signals: [{ ...signal, spaceId: "other" }],
        nextCursor: null,
      });
    }
    if (kind === "wrong Profile") {
      requireProfile.mockResolvedValue({
        ...profile,
        openMeldProfileId: "other",
      });
    }
    if (kind === "too many signals") {
      listSignals.mockResolvedValue({
        signals: new Array(22).fill(signal),
        nextCursor: null,
      });
    }
    if (kind === "expired during read") {
      listSignals.mockImplementation(() => {
        const stored = JSON.parse(readFileSync(contextPath, "utf8"));
        writeFileSync(
          contextPath,
          JSON.stringify({ ...stored, expiresAtMs: Date.now() - 1 })
        );
        return Promise.resolve({ signals: [signal], nextCursor: null });
      });
    }
    await expect(readDispatchSpaceHistory()).rejects.toThrow();
    expect(readDispatchSpaceActionRecord({ context }).status).toBe("missing");
    if (kind === "expired" || kind === "wrong Profile") {
      expect(listSignals).not.toHaveBeenCalled();
    }
  });
});
