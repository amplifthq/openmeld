import type { ReadApprovedPluginActionResponse } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  buildRemoteAgentExecutionIdentity,
  initializeRemoteAgentExecutionState,
} from "../agent-core/execution-state";
import { resumeApprovedPluginAction } from "../flue-adapter/approved-plugin-action";
import { executionAccessFixture } from "./execution-access-fixture";
import {
  createRoutineTurnEnvelope,
  createSubmitTurnRequest,
  TEST_NOW_MS,
} from "./fixtures";
import { linearIssueCreateInputSchema } from "./fixtures/linear-issue-action";
import catalog from "./fixtures/openconnector-runtime-actions.json";
import { InMemoryDurableObjectStorage } from "./storage";

// Replays the Oct 28 Tonebird walkthrough's 27 approvals, with the separate
// Circle request interleaved and no original descriptions in model context.
const walkthroughItems = [
  ...Array.from(
    { length: 10 },
    (_, i) => `ONB-${String(i + 1).padStart(2, "0")}`
  ),
  ...Array.from(
    { length: 8 },
    (_, i) => `HOME-${String(i + 1).padStart(2, "0")}`
  ),
  "SENT-01",
  "SENT-03",
  "ME-01",
  "ME-02",
  ...Array.from(
    { length: 5 },
    (_, i) => `CIRCLE-${String(i + 1).padStart(2, "0")}`
  ),
];
const connectionName =
  "org_aaaaaaaaaaaaaaaaaa__user_bbbbbbbbbbbbbbbbbb__linear";
const teamId = "a86813e7-c458-4af2-8cfa-73a796d81201";

async function fixture() {
  const request = createSubmitTurnRequest({
    sourceClientMessageId: "plugin-continue:approved",
  });
  const storage = new InMemoryDurableObjectStorage();
  const context = createRemoteAgentCallbackContext({
    request,
    ack: {
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      requestId: "approved-submission",
      submissionId: "approved-submission",
      status: "pending",
    },
    nowMs: TEST_NOW_MS,
  });
  await putRemoteAgentCallbackContext(storage, context);
  await initializeRemoteAgentExecutionState({
    storage,
    identity: buildRemoteAgentExecutionIdentity(context),
    acceptedAtMs: TEST_NOW_MS,
  });
  const effects = new Map<string, Record<string, unknown>>();
  const operations = new Map<string, Record<string, unknown>>();
  let current: ReadApprovedPluginActionResponse["action"] = null;
  let forbidden = false;
  const fetch = vi.fn<typeof globalThis.fetch>((_url, init) => {
    if (init?.method === "GET") {
      return Promise.resolve(
        Response.json({
          ...catalog,
          data: [
            {
              ...catalog.data[0],
              id: "linear.create_linear_issue",
              service: "linear",
              inputSchema: linearIssueCreateInputSchema,
              effect: "write",
              operationType: "write",
            },
          ],
        })
      );
    }
    const operationId = new Headers(init?.headers).get("idempotency-key");
    if (!operationId) {
      throw new Error("Missing operation identity");
    }
    const body = JSON.parse(String(init?.body));
    if (body.connectionName !== connectionName || effects.has(operationId)) {
      throw new Error("Wrong account or duplicate provider write");
    }
    effects.set(operationId, body.input);
    return Promise.resolve(
      Response.json({
        success: true,
        message: "OK",
        data: {
          id: crypto.randomUUID(),
          identifier: `TON-${effects.size}`,
          ticket_url: `https://linear.app/example/issue/TON-${effects.size}`,
        },
        meta: {
          actionId: "linear.create_linear_issue",
          executionId: operationId,
          auditPersisted: true,
        },
      })
    );
  });
  const coreWorker = {
    readApprovedPluginAction: () => {
      if (forbidden) {
        return Promise.reject(new Error("plugin.request.recovery_unavailable"));
      }
      return Promise.resolve({ action: current });
    },
    authorizeRemoteAgentExecutionAccess: executionAccessFixture(context),
    centerAgentReadConnectorActionOperation: async ({
      operationId,
    }: {
      operationId: string;
    }) => ({
      operation: operations.get(operationId) ?? null,
    }),
    resolveProjectIssueAction: async () => ({
      basis: "confirmation_required",
      destination: { provider: "linear", teamId },
      projectId: null,
      projectRevision: null,
    }),
    centerAgentResolveConnectorConnection: async () => ({
      selection: "shared",
      connection: {
        connectionName,
        service: "linear",
        scope: "shared",
        userId: "user_1",
        ownerDisplayName: "Member",
        canDisconnect: false,
        organizationId: request.organizationId,
        createdAtMs: TEST_NOW_MS,
        updatedAtMs: TEST_NOW_MS,
        status: "active",
        disconnectedAtMs: null,
      },
    }),
    centerAgentRecordConnectorActionOperation: (
      entry: Record<string, unknown>
    ) => {
      const id = String(entry.operationId);
      const previous = operations.get(id);
      const replayed = previous?.status === "completed";
      let status = entry.outcome === "attempted" ? "pending" : entry.outcome;
      if (replayed) {
        status = "completed";
      }
      const record = {
        actionId: entry.actionId,
        connectionName,
        operationId: id,
        service: "linear",
        status,
        createdAtMs: TEST_NOW_MS,
        providerExecutionId: status === "completed" ? id : null,
        executionConnection: {
          connectionName,
          service: "linear",
          scope: "shared",
          ownerUserId: "user_1",
          ownerDisplayName: "Member",
        },
        ...(entry.linearIssueReceipt
          ? { linearIssueReceipt: entry.linearIssueReceipt }
          : {}),
        ...(previous?.linearIssueReceipt
          ? { linearIssueReceipt: previous.linearIssueReceipt }
          : {}),
      };
      operations.set(id, record);
      return Promise.resolve({
        attribution: {
          actorProfileId: request.agentProfileId,
          onBehalfOf: null,
        },
        operationId: id,
        status,
        providerExecutionId: record.providerExecutionId,
        recorded: true,
        replayed,
        executionAllowed: entry.outcome === "attempted" && !replayed,
      });
    },
  };
  return {
    context,
    effects,
    fetch,
    approve: (item: string, circle = false) => {
      current = {
        requestId: crypto.randomUUID(),
        operationId: circle
          ? "ton-circle-list-relationship-view-1028-v2"
          : `ton-walk-1315-${item}`,
        service: "linear",
        actionId: "linear.create_linear_issue",
        connectionPreference: "shared",
        recovery: {
          input: {
            team_id: teamId,
            title: circle
              ? "Circle：默认列表页 + 关系视图（以你为中心）"
              : `Walkthrough ${item}`,
            description: `Original immutable description for ${item}: 中文、newlines\nunchanged input.`,
          },
        },
      };
      return structuredClone(current);
    },
    deny: () => {
      forbidden = true;
    },
    resume: () =>
      resumeApprovedPluginAction({
        context,
        storage,
        coreWorker: coreWorker as never,
        connectorExecution: {
          baseUrl: "https://connectors.example.test",
          runtimeToken: "synthetic",
          fetch,
        },
      }),
  };
}

describe("Approved Plugin action execution", () => {
  it.each([
    "routine",
    "answer-recovery",
  ] as const)("does not turn a %s continuation into an approved action execution", async (kind) => {
    const f = await fixture();
    f.approve("ONB-01");
    if (kind === "routine") {
      f.context.turnEnvelope = createRoutineTurnEnvelope();
    } else {
      f.context.replyRecovery = {
        originalDispatchId: f.context.dispatchId,
        operationId: "recover-answer",
      };
    }
    expect(await f.resume()).toBeNull();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("executes all 27 original inputs and the independent Circle action exactly once without a model reconstructing them", async () => {
    const f = await fixture();
    for (const [index, item] of walkthroughItems.entries()) {
      if (index === 1) {
        const circle = f.approve("independent-circle", true);
        await f.resume();
        expect(f.effects.get(circle.operationId)).toEqual(
          circle.recovery.input
        );
      }
      const approval = f.approve(item);
      const result = await f.resume();
      expect(result?.operationId).toBe(approval.operationId);
      expect(f.effects.get(approval.operationId)).toEqual(
        approval.recovery.input
      );
      await f.resume(); // Duplicate delivery / worker restart must reuse the receipt.
      expect(f.effects.size).toBe(index + 1 + (index > 0 ? 1 : 0));
    }
    expect(f.effects.size).toBe(28);
    expect(
      f.fetch.mock.calls.filter(([, init]) => init?.method === "POST")
    ).toHaveLength(28);
  });

  it("does not execute when the approval owner rejects the current requester, source or account", async () => {
    const f = await fixture();
    f.approve("ONB-01");
    f.deny();
    await expect(f.resume()).rejects.toThrow("recovery_unavailable");
    expect(f.effects.size).toBe(0);
    expect(f.fetch).not.toHaveBeenCalled();
  });
});
