import {
  type CloudComputerOperation,
  resolveRemoteAgentExecutionScope,
} from "@openmeld/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRemoteAgentCallbackContext } from "../agent-core/callback-context";
import { createAgentComputerWorkspaceAccess } from "../flue-adapter/agent-computer-workspace-access";
import { resolveRemoteAgentComputerName } from "../flue-adapter/computer-identity";
import { createRemoteAgentComputerCapability } from "../flue-adapter/computer-sandbox";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";

const getWorkspace = vi.hoisted(() => vi.fn());
vi.mock("@cloudflare/computer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cloudflare/computer")>()),
  getWorkspace,
}));

function context() {
  const request = createSubmitTurnRequest();
  return createRemoteAgentCallbackContext({
    request,
    nowMs: TEST_NOW_MS,
    ack: {
      accepted: true,
      status: "pending",
      createdAt: TEST_NOW_MS,
      requestId: "isolated",
      submissionId: "isolated",
      idempotencyKey: request.idempotencyKey,
    },
  });
}

describe("Computer audience and current access", () => {
  beforeEach(() => getWorkspace.mockReset());

  it("waits across bounded preparation RPCs using the original receipt", async () => {
    const reference = {
      invocationId: "original",
      key: "prepare",
      id: "original-process",
      backend: "container" as const,
    };
    const observed: CloudComputerOperation[] = [];
    const access = createAgentComputerWorkspaceAccess({
      computerId: {} as DurableObjectId,
      namespace: {
        idFromName: vi.fn(),
        get: () =>
          ({
            computerOperation: (request: CloudComputerOperation) => {
              observed.push(request);
              return Promise.resolve({
                id: reference.id,
                key: reference.key,
                reference,
                phase: observed.length === 1 ? "accepted" : "completed",
                status: observed.length === 1 ? "running" : "completed",
                exitCode: observed.length === 1 ? null : 17,
                stdout: observed.length === 1 ? "" : "retained output",
              });
            },
          }) as unknown as DurableObjectStub,
      },
    });
    await expect(
      access.computerOperation?.({
        action: "command",
        invocationId: reference.invocationId,
        command: { action: "poll", key: reference.key, waitSeconds: 1 },
      })
    ).resolves.toMatchObject({
      status: "completed",
      exitCode: 17,
      stdout: "retained output",
    });
    expect(observed).toHaveLength(2);
    expect(observed[1]).toMatchObject({
      invocationId: reference.invocationId,
      command: { action: "poll", key: reference.key, reference },
    });
  });

  it("preserves historical audience addresses for cleanup", () => {
    const original = { ...context(), computerIsolationVersion: 2 as const };
    const envelope = original.turnEnvelope;
    if (!envelope) {
      throw new Error("Expected an admitted turn envelope");
    }
    const name = resolveRemoteAgentComputerName(original);
    expect(
      resolveRemoteAgentComputerName({ ...original, submissionId: "next-turn" })
    ).toBe(name);
    expect(
      resolveRemoteAgentComputerName({
        ...original,
        organizationId: "other-organization",
        turnEnvelope: {
          ...envelope,
          organization: { ...envelope.organization, id: "other-organization" },
        },
      })
    ).not.toBe(name);
    expect(
      resolveRemoteAgentComputerName({
        ...original,
        bindingId: "replaced-binding",
      })
    ).not.toBe(name);
    expect(
      resolveRemoteAgentComputerName({
        ...original,
        agentProfileId: "other-agent",
      })
    ).not.toBe(name);
    expect(
      resolveRemoteAgentComputerName({
        ...original,
        spaceId: "shared-space",
        conversationId: "shared-space",
        turnEnvelope: {
          ...envelope,
          space: { ...envelope.space, id: "shared-space" },
        },
      })
    ).not.toBe(name);
    const sender = envelope.sender;
    if (sender.kind !== "member") {
      throw new Error("Expected the captured member fixture");
    }
    expect(
      resolveRemoteAgentComputerName({
        ...original,
        turnEnvelope: {
          ...envelope,
          sender: { ...sender, ownerUserId: "other-member" },
        },
      })
    ).not.toBe(name);
  });

  it.each([
    undefined,
    1 as const,
    2 as const,
  ])("keeps legacy %s cleanup addressing separate and refuses to open that shared workspace for new tools", async (computerIsolationVersion) => {
    const legacy = { ...context(), computerIsolationVersion };
    expect(
      resolveRemoteAgentComputerName(legacy).startsWith("agent-computer:")
    ).toBe(true);
    const namespace = { idFromName: vi.fn(), get: vi.fn() };
    await expect(
      createRemoteAgentComputerCapability({
        context: legacy,
        coreWorker: {},
        env: { AGENT_COMPUTER: namespace },
        includeOrganizationDocuments: false,
      })
    ).rejects.toThrow("Start a new request");
    expect(namespace.get).not.toHaveBeenCalled();
    expect(getWorkspace).not.toHaveBeenCalled();
  });

  it("does not acquire or materialize any workspace before current Core authorization", async () => {
    const namespace = { idFromName: vi.fn(), get: vi.fn() };
    await expect(
      createRemoteAgentComputerCapability({
        context: context(),
        coreWorker: {
          authorizeRemoteAgentExecutionAccess: vi
            .fn()
            .mockRejectedValue(new Error("membership revoked")),
        },
        env: { AGENT_COMPUTER: namespace },
        includeOrganizationDocuments: false,
      })
    ).rejects.toThrow("membership revoked");
    expect(namespace.idFromName).not.toHaveBeenCalled();
    expect(getWorkspace).not.toHaveBeenCalled();
  });

  it("rejects a Core response for another audience instead of trusting a valid-shaped scope", async () => {
    const accepted = context();
    await expect(
      createRemoteAgentComputerCapability({
        context: accepted,
        coreWorker: {
          authorizeRemoteAgentExecutionAccess: vi.fn(async () => ({
            submissionId: accepted.submissionId,
            scope: {
              ...resolveRemoteAgentExecutionScope(accepted),
              spaceId: "another-space",
            },
          })),
        },
        env: { AGENT_COMPUTER: { idFromName: vi.fn(), get: vi.fn() } },
        includeOrganizationDocuments: false,
      })
    ).rejects.toThrow();
    expect(getWorkspace).not.toHaveBeenCalled();
  });

  it("reauthorizes every operation and withholds bytes when permission is revoked while it runs", async () => {
    const dispose = vi.fn();
    getWorkspace.mockResolvedValue({ [Symbol.dispose]: dispose });
    const authorize = vi.fn(async () => undefined);
    const namespace = { get: vi.fn(() => ({})), idFromName: vi.fn() };
    const access = createAgentComputerWorkspaceAccess({
      computerId: {} as DurableObjectId,
      namespace: namespace as never,
      authorize,
    });
    await expect(
      access.withWorkspace(async () => "authorized-file")
    ).resolves.toBe("authorized-file");
    expect(authorize).toHaveBeenCalledTimes(2);
    await expect(
      access.withWorkspace(async () => {
        authorize.mockRejectedValue(new Error("revoked during operation"));
        return await Promise.resolve("private-file-must-not-return");
      })
    ).rejects.toThrow("revoked during operation");
    const execute = vi.fn();
    await expect(access.withWorkspace(execute)).rejects.toThrow(
      "revoked during operation"
    );
    expect(execute).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
