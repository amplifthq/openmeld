import {
  createDispatchContinuationSpaceAccessContext,
  type SpaceAccessContext,
} from "@openmeld/space";
import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../lib/bindings";
import {
  rpcCreateSpaceDiagnosticReport,
  rpcGetActiveSpaceWakeProgress,
  rpcGetSpaceBoard,
  rpcGetSpaceDispatchLookup,
  rpcGetSpaceDispatchTrace,
  rpcGetSpaceMessageDetails,
  rpcGetSpaceWakeProgress,
  rpcGetSpaceWakeTraceWaterfall,
  rpcPostSignal,
  rpcPostSpaceWakeStop,
  rpcRecordSpaceAttachment,
  rpcRespondToSpaceAgentInteraction,
} from "../rpc/methods";
import { Space } from "../space/transport/do/space";

const SPACE_ID = "a".repeat(64);
const CLIENT_MESSAGE_ID = "cm_01J00000000000000000000001";
const ORGANIZATION_ID = "org-1";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const requestContext = {
  activeOrganizationId: ORGANIZATION_ID,
  actorContext: {
    callerPrincipalId: "owner-1",
    openMeldProfileId: PROFILE_ID,
    ownerUserId: "owner-1",
    profileKind: "human" as const,
    profileName: "Felix",
    requestId: "req-1",
  },
};

describe("Space RPC access context propagation", () => {
  it("routes client-authored message identities through the idempotent Space writer", async () => {
    const captured = new Map<string, unknown>();
    const signal = {
      v: 1,
      id: "signal-1",
      spaceId: SPACE_ID,
      ts: 1,
      profile: {
        kind: "human",
        profileId: PROFILE_ID,
        profileName: "Felix",
      },
      type: "signal.text",
      data: {
        text: "Run the checks",
        meta: { clientMessageId: CLIENT_MESSAGE_ID },
      },
    } as const;
    const env = createEnvWithSpaceStub({
      rpcPostSignal: () => {
        throw new Error("non-idempotent writer must not be used");
      },
      rpcPostSignalOnceByClientMessageId: (input: unknown) =>
        recordRpcInput(
          captured,
          "rpcPostSignalOnceByClientMessageId",
          input,
          signal
        ),
    });

    await expect(
      rpcPostSignal(env, {
        authoringPolicy: "user_authored",
        context: requestContext,
        meta: { clientMessageId: CLIENT_MESSAGE_ID },
        profile: signal.profile,
        spaceId: SPACE_ID,
        text: signal.data.text,
      })
    ).resolves.toEqual(signal);
    expect(captured.get("rpcPostSignalOnceByClientMessageId")).toMatchObject({
      clientMessageId: CLIENT_MESSAGE_ID,
      meta: { clientMessageId: CLIENT_MESSAGE_ID },
      spaceId: SPACE_ID,
    });
  });

  it("preserves dispatch continuation authority through attachment membership and metadata checks", async () => {
    const spaceAccess = createDispatchContinuationSpaceAccessContext({
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      password: "secret-password",
      requestContext,
      sourceSignalId: "signal-1",
      spaceId: SPACE_ID,
      targetProfileId: "agent-1",
    });
    const captured = new Map<string, unknown>();
    const env = createAttachmentEnvWithSpaceStub({
      rpcGetMeta: (input: unknown) =>
        recordRpcInput(captured, "rpcGetMeta", input, {
          organizationId: ORGANIZATION_ID,
          spaceId: SPACE_ID,
          visibility: "private",
        }),
      rpcGetViewerMembership: (input: unknown) =>
        recordRpcInput(captured, "rpcGetViewerMembership", input, {
          activeMemberProfiles: [
            {
              lastEnteredAt: null,
              profileId: PROFILE_ID,
              profileKind: "human",
              profileName: "Felix",
            },
          ],
          preferredOpenProfileId: PROFILE_ID,
          spaceId: SPACE_ID,
        }),
    });

    await rpcRecordSpaceAttachment(env, {
      mimeType: "image/png",
      sizeBytes: 8,
      spaceAccess,
      spaceId: SPACE_ID,
    });

    for (const methodName of ["rpcGetViewerMembership", "rpcGetMeta"]) {
      const input = captured.get(methodName) as {
        spaceAccess?: SpaceAccessContext;
      };
      expect(input.spaceAccess).toBe(spaceAccess);
      expect(input.spaceAccess?.actor.kind).toBe("dispatch_continuation");
      expect(input.spaceAccess?.proof).toEqual({
        kind: "space_password",
        password: "secret-password",
      });
    }
  });

  it("preserves dispatch continuation authority through the real Space metadata authorization boundary", async () => {
    const spaceAccess = createDispatchContinuationSpaceAccessContext({
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      password: "secret-password",
      requestContext,
      sourceSignalId: "signal-1",
      spaceId: SPACE_ID,
      targetProfileId: "agent-1",
    });
    const captured: {
      authorizedSpaceAccess?: SpaceAccessContext;
      requestSpaceAccess?: SpaceAccessContext;
    } = {};
    const space = Object.create(Space.prototype) as DirectMetaHarness;
    space.spaceId = SPACE_ID;
    space.applySpaceRef = (spaceId) => {
      expect(spaceId).toBe(SPACE_ID);
    };
    space.buildDirectRpcRequest = (input) => {
      captured.requestSpaceAccess = input.spaceAccess;
      return new Request("https://openmeld.local/meta", { method: "GET" });
    };
    space.authorizeSpaceAccess = (value) => {
      captured.authorizedSpaceAccess = value;
      return Promise.resolve({ ok: true });
    };
    space.handleGetMeta = () =>
      Response.json({
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        visibility: "private",
      });

    await expect(
      space.rpcGetMeta({ spaceAccess, spaceId: SPACE_ID })
    ).resolves.toMatchObject({
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
    });
    expect(captured.requestSpaceAccess).toBe(spaceAccess);
    expect(captured.authorizedSpaceAccess).toBe(spaceAccess);
    expect(captured.authorizedSpaceAccess?.actor.kind).toBe(
      "dispatch_continuation"
    );
  });

  it("preserves dispatch continuation authority through Space Board aggregation", async () => {
    const spaceAccess = createDispatchContinuationSpaceAccessContext({
      attemptId: "attempt-board-1",
      dispatchId: "dispatch-board-1",
      password: "secret-password",
      requestContext,
      sourceSignalId: "signal-board-1",
      spaceId: SPACE_ID,
      targetProfileId: "agent-board-1",
    });
    const captured = new Map<string, unknown>();
    const env = createBoardEnvWithSpaceStub({
      rpcGetBoardResult: (input: unknown) =>
        recordRpcInput(captured, "rpcGetBoardResult", input, {
          ok: true,
          value: emptyBoardRoomProjection(),
        }),
    });

    await expect(
      rpcGetSpaceBoard(env, { spaceAccess, spaceId: SPACE_ID })
    ).resolves.toMatchObject({
      space: { id: SPACE_ID, name: "Empty Board" },
      workingNow: [],
      recentOutcomes: [],
    });

    const boardInput = captured.get("rpcGetBoardResult") as {
      spaceAccess?: SpaceAccessContext;
    };
    expect(boardInput.spaceAccess).toBe(spaceAccess);
    expect(boardInput.spaceAccess?.actor.kind).toBe("dispatch_continuation");
  });

  it("preserves structured Space access for Wake read/control RPCs without requiring a separate context", async () => {
    const spaceAccess = createDispatchContinuationSpaceAccessContext({
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      password: "secret-password",
      requestContext,
      sourceSignalId: "signal-1",
      spaceId: SPACE_ID,
      targetProfileId: "agent-1",
    });
    const captured = new Map<string, unknown>();
    const env = createEnvWithSpaceStub({
      rpcCreateDiagnosticReport: (input: unknown) =>
        recordRpcInput(captured, "rpcCreateDiagnosticReport", input, {
          createdAtMs: 1,
          diagnosticReportId: "diag-1",
          problemType: "no_reply",
          reportedSignalId: "signal-1",
          reporterProfileId: "usr_felix",
          replyToSignalId: null,
          spaceId: SPACE_ID,
          threadId: null,
          wakePointerDerivation: {
            reasonCodes: ["diagnostic_report.not_wake_related"],
            status: "not_wake",
          },
          wakePointers: [],
        }),
      rpcGetActiveWakeProgress: (input: unknown) =>
        recordRpcInput(captured, "rpcGetActiveWakeProgress", input, {
          items: [],
          query: { spaceId: SPACE_ID, targetProfileId: null },
        }),
      rpcGetDispatchLookup: (input: unknown) =>
        recordRpcInput(captured, "rpcGetDispatchLookup", input, {
          matches: [],
          query: {
            clientMessageId: null,
            sourceSignalId: "signal-1",
            spaceId: SPACE_ID,
            targetProfileId: null,
          },
        }),
      rpcGetDispatchTrace: (input: unknown) =>
        recordRpcInput(captured, "rpcGetDispatchTrace", input, {}),
      rpcGetMessageDetails: (input: unknown) =>
        recordRpcInput(captured, "rpcGetMessageDetails", input, {}),
      rpcGetWakeProgress: (input: unknown) =>
        recordRpcInput(captured, "rpcGetWakeProgress", input, {
          items: [],
          query: {
            clientMessageId: CLIENT_MESSAGE_ID,
            spaceId: SPACE_ID,
            targetProfileId: null,
          },
        }),
      rpcGetWakeTraceWaterfall: (input: unknown) =>
        recordRpcInput(captured, "rpcGetWakeTraceWaterfall", input, {
          items: [],
          query: {
            clientMessageId: CLIENT_MESSAGE_ID,
            sourceSignalId: null,
            spaceId: SPACE_ID,
            targetProfileId: null,
          },
        }),
      rpcPostWakeStop: (input: unknown) =>
        recordRpcInput(captured, "rpcPostWakeStop", input, {
          cancellationState: {
            status: "not_requested",
          },
          ok: false,
          reasonCode: "space.wake_stop_target_not_found",
          runtimeCoordinatorExecutionId: null,
          status: "not_found",
          targetProfileId: "agent-1",
        }),
      rpcRespondToAgentInteraction: (input: unknown) =>
        recordRpcInput(captured, "rpcRespondToAgentInteraction", input, {
          ok: true,
          respondedAtMs: 1,
          status: "accepted",
        }),
    });

    await rpcGetSpaceDispatchTrace(env, {
      dispatchId: "dispatch-1",
      includeRemoteAgentRuntimeDiagnostics: true,
      spaceAccess,
      spaceId: SPACE_ID,
    });
    await rpcGetSpaceDispatchLookup(env, {
      sourceSignalId: "signal-1",
      spaceAccess,
      spaceId: SPACE_ID,
    });
    await rpcGetSpaceWakeProgress(env, {
      clientMessageId: CLIENT_MESSAGE_ID,
      spaceAccess,
      spaceId: SPACE_ID,
    });
    await rpcGetActiveSpaceWakeProgress(env, {
      spaceAccess,
      spaceId: SPACE_ID,
    });
    await rpcPostSpaceWakeStop(env, {
      body: {
        target: {
          by: "source_signal",
          sourceSignalId: "signal-1",
          targetProfileId: "agent-1",
        },
      },
      spaceAccess,
      spaceId: SPACE_ID,
    });
    await rpcRespondToSpaceAgentInteraction(env, {
      body: {
        interactionId: "interaction-1",
        response: {
          kind: "permission",
          optionId: "allow-once",
        },
        runtimeCoordinatorExecutionId: "rce-1",
      },
      spaceAccess,
      spaceId: SPACE_ID,
    });
    await rpcGetSpaceWakeTraceWaterfall(env, {
      clientMessageId: CLIENT_MESSAGE_ID,
      spaceAccess,
      spaceId: SPACE_ID,
    });
    await rpcGetSpaceMessageDetails(env, {
      signalId: "signal-1",
      spaceAccess,
      spaceId: SPACE_ID,
    });
    await rpcCreateSpaceDiagnosticReport(env, {
      body: {
        problemType: "no_reply",
        reportedSignalId: "signal-1",
      },
      spaceAccess,
      spaceId: SPACE_ID,
    });

    for (const methodName of [
      "rpcCreateDiagnosticReport",
      "rpcGetActiveWakeProgress",
      "rpcGetDispatchLookup",
      "rpcGetDispatchTrace",
      "rpcGetMessageDetails",
      "rpcGetWakeProgress",
      "rpcGetWakeTraceWaterfall",
      "rpcPostWakeStop",
      "rpcRespondToAgentInteraction",
    ]) {
      const input = captured.get(methodName);
      expect(input).toMatchObject({
        context: requestContext,
        password: "secret-password",
        spaceAccess,
      });
      expect((input as { spaceAccess?: unknown }).spaceAccess).toBe(
        spaceAccess
      );
      expect(
        (input as { spaceAccess?: typeof spaceAccess }).spaceAccess?.actor.kind
      ).toBe("dispatch_continuation");
    }
    expect(captured.get("rpcGetDispatchTrace")).toMatchObject({
      includeRemoteAgentRuntimeDiagnostics: true,
    });
  });

  it("passes structured Space access through Space DO direct RPC handler options", async () => {
    const spaceAccess = createDispatchContinuationSpaceAccessContext({
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      password: "secret-password",
      requestContext,
      sourceSignalId: "signal-1",
      spaceId: SPACE_ID,
      targetProfileId: "agent-1",
    });
    const captured: {
      handlerOptionsSpaceAccess?: SpaceAccessContext;
      requestSpaceAccess?: SpaceAccessContext;
    } = {};
    const space = Object.create(Space.prototype) as DirectWakeStopHarness;
    space.applySpaceRef = (spaceId) => {
      expect(spaceId).toBe(SPACE_ID);
    };
    space.buildDirectRpcRequest = (input) => {
      captured.requestSpaceAccess = input.spaceAccess;
      return new Request("https://openmeld.local/wake-stop", {
        method: "POST",
      });
    };
    space.dispatchWakeStopRequest = (_request, options) => {
      captured.handlerOptionsSpaceAccess = options?.spaceAccess;
      return Promise.resolve(
        Response.json({
          cancellationState: {
            status: "not_requested",
          },
          ok: false,
          reasonCode: "space.wake_stop_target_not_found",
          runtimeCoordinatorExecutionId: null,
          status: "not_found",
          targetProfileId: "agent-1",
        })
      );
    };

    await space.rpcPostWakeStop({
      body: {
        target: {
          by: "source_signal",
          sourceSignalId: "signal-1",
          targetProfileId: "agent-1",
        },
      },
      spaceAccess,
      spaceId: SPACE_ID,
    });

    expect(captured.requestSpaceAccess).toBe(spaceAccess);
    expect(captured.handlerOptionsSpaceAccess).toBe(spaceAccess);
    expect(captured.handlerOptionsSpaceAccess?.actor.kind).toBe(
      "dispatch_continuation"
    );
  });

  it("preserves the detailed runtime diagnostics request through the Space DO adapter", async () => {
    const captured: { path?: string } = {};
    const space = Object.create(Space.prototype) as DirectDispatchTraceHarness;
    space.applySpaceRef = (spaceId) => {
      expect(spaceId).toBe(SPACE_ID);
    };
    space.buildDirectRpcRequest = (input) => {
      captured.path = input.path;
      return new Request(`https://openmeld.local${input.path}`);
    };
    space.dispatchDispatchTraceRequest = () =>
      Promise.resolve(Response.json({}));

    await space.rpcGetDispatchTrace({
      dispatchId: "dispatch-1",
      includeRemoteAgentRuntimeDiagnostics: true,
      spaceId: SPACE_ID,
    });

    expect(captured.path).toBe(
      "/dispatches/dispatch-1/trace?includeRemoteAgentRuntimeDiagnostics=true"
    );
  });

  it("passes structured Space access through the Space Board DO adapter", async () => {
    const spaceAccess = createDispatchContinuationSpaceAccessContext({
      attemptId: "attempt-board-1",
      dispatchId: "dispatch-board-1",
      password: "secret-password",
      requestContext,
      sourceSignalId: "signal-board-1",
      spaceId: SPACE_ID,
      targetProfileId: "agent-board-1",
    });
    const captured: {
      handlerOptionsSpaceAccess?: SpaceAccessContext;
      requestSpaceAccess?: SpaceAccessContext;
    } = {};
    const space = Object.create(Space.prototype) as DirectBoardHarness;
    space.applySpaceRef = (spaceId) => {
      expect(spaceId).toBe(SPACE_ID);
    };
    space.buildDirectRpcRequest = (input) => {
      captured.requestSpaceAccess = input.spaceAccess;
      return new Request("https://openmeld.local/board", { method: "GET" });
    };
    space.dispatchBoardRequest = (_request, options) => {
      captured.handlerOptionsSpaceAccess = options?.spaceAccess;
      return Promise.resolve(Response.json(emptyBoardRoomProjection()));
    };

    await expect(
      space.rpcGetBoard({ spaceAccess, spaceId: SPACE_ID })
    ).resolves.toEqual(emptyBoardRoomProjection());
    expect(captured.requestSpaceAccess).toBe(spaceAccess);
    expect(captured.handlerOptionsSpaceAccess).toBe(spaceAccess);
    expect(captured.handlerOptionsSpaceAccess?.actor.kind).toBe(
      "dispatch_continuation"
    );
  });
});

type DirectBoardHarness = {
  applySpaceRef: (spaceId: string) => void;
  buildDirectRpcRequest: (input: {
    context?: unknown;
    method: "GET";
    path: "/board";
    spaceAccess?: SpaceAccessContext;
    spacePassword?: string;
  }) => Request;
  dispatchBoardRequest: (
    request: Request,
    options?: { spaceAccess?: SpaceAccessContext }
  ) => Promise<Response>;
  rpcGetBoard: Space["rpcGetBoard"];
};

type DirectDispatchTraceHarness = {
  applySpaceRef: (spaceId: string) => void;
  buildDirectRpcRequest: (input: {
    context?: unknown;
    method: "GET";
    path: string;
    spaceAccess?: SpaceAccessContext;
    spacePassword?: string;
  }) => Request;
  dispatchDispatchTraceRequest: (
    request: Request,
    dispatchId: string,
    options?: { spaceAccess?: SpaceAccessContext }
  ) => Promise<Response>;
  rpcGetDispatchTrace: Space["rpcGetDispatchTrace"];
};

type DirectWakeStopHarness = {
  applySpaceRef: (spaceId: string) => void;
  buildDirectRpcRequest: (input: {
    body?: unknown;
    context?: unknown;
    method: "POST";
    path: "/wake-stop";
    spaceAccess?: SpaceAccessContext;
    spacePassword?: string;
  }) => Request;
  dispatchWakeStopRequest: (
    request: Request,
    options?: { spaceAccess?: SpaceAccessContext }
  ) => Promise<Response>;
  rpcPostWakeStop: Space["rpcPostWakeStop"];
};

type DirectMetaHarness = {
  applySpaceRef: (spaceId: string) => void;
  authorizeSpaceAccess: (
    spaceAccess: SpaceAccessContext
  ) => Promise<{ ok: true }>;
  buildDirectRpcRequest: (input: {
    context?: unknown;
    method: "GET";
    path: "/meta";
    spaceAccess?: SpaceAccessContext;
    spacePassword?: string;
  }) => Request;
  handleGetMeta: () => Response;
  rpcGetMeta: Space["rpcGetMeta"];
  spaceId: string;
};

function createEnvWithSpaceStub(stub: Record<string, unknown>): CoreBindings {
  return {
    OPENMELD_SPACES: {
      get: () => stub,
      idFromString: (spaceId: string) => spaceId,
    },
  } as unknown as CoreBindings;
}

function createAttachmentEnvWithSpaceStub(
  stub: Record<string, unknown>
): CoreBindings {
  const db = {
    prepare: (sql: string) => ({
      bind: () => ({
        first: () =>
          Promise.resolve(
            sql.includes("FROM members")
              ? { id: "member-1", role: "member" }
              : null
          ),
        run: () => Promise.resolve({ meta: { changes: 1 }, success: true }),
      }),
    }),
  };
  return {
    ...createEnvWithSpaceStub(stub),
    OPENMELD_DB: db,
  } as unknown as CoreBindings;
}

function createBoardEnvWithSpaceStub(
  stub: Record<string, unknown>
): CoreBindings {
  return {
    ...createEnvWithSpaceStub(stub),
    OPENMELD_DB: {
      prepare: () => ({
        bind: () => ({
          all: () => Promise.resolve({ results: [] }),
        }),
      }),
    },
  } as unknown as CoreBindings;
}

function emptyBoardRoomProjection() {
  return {
    space: {
      id: SPACE_ID,
      name: "Empty Board",
      purpose: null,
      guide: null,
    },
    members: {
      totalCount: 0,
      humanCount: 0,
      agentCount: 0,
      centerAgentPresent: false,
    },
    agentProfiles: [],
  };
}

function recordRpcInput(
  captured: Map<string, unknown>,
  methodName: string,
  input: unknown,
  response: unknown
): Promise<unknown> {
  captured.set(methodName, input);
  return Promise.resolve(response);
}
