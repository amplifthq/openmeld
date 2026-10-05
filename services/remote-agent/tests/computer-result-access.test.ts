import {
  remoteAgentExecutionAccessRequestSchema,
  resolveRemoteAgentExecutionScope,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { createRemoteAgentCallbackContext } from "../agent-core/callback-context";
import { readRemoteAgentResultSources } from "../agent-core/result-access";
import { createRemoteAgentComputerCapability } from "../flue-adapter/computer-sandbox";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";

const workspace = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@cloudflare/computer", () => ({ getWorkspace: workspace.get }));

describe("personal Computer copies", () => {
  it("keeps completed copies readable after a provider disconnect without attaching unrelated historical sources", async () => {
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
    let disconnected = false;
    const authorize = vi.fn(async (raw: unknown) => {
      const input = remoteAgentExecutionAccessRequestSchema.parse(raw);
      if (disconnected && input.sources?.length) {
        throw new Error("source_revoked");
      }
      return await Promise.resolve({
        submissionId: context.submissionId,
        scope: resolveRemoteAgentExecutionScope(context),
        ...(input.includeComputer
          ? {
              computer: {
                id: "personal-one",
                ownerUserId: "human-one",
                provider: "cloudflare",
                createdAtMs: 1,
              },
            }
          : {}),
      });
    });
    workspace.get.mockResolvedValue({
      [Symbol.dispose]: vi.fn(),
      fs: { mkdir: vi.fn(), readFile: vi.fn(async () => "downloaded report") },
    });
    const capability = await createRemoteAgentComputerCapability({
      context,
      coreWorker: { authorizeRemoteAgentExecutionAccess: authorize },
      env: {
        AGENT_COMPUTER: { idFromName: (name: string) => name, get: () => ({}) },
      },
      includeOrganizationDocuments: false,
    });
    disconnected = true;
    const result = await capability.definitions
      .find((tool) => tool.name === "read")
      ?.execute({ path: "/computer/home/report.txt" });
    expect(JSON.stringify(result)).toContain("downloaded report");
    expect(readRemoteAgentResultSources(result)).toEqual([]);
  });
});
