import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  createOpenCodeAdapter,
  type OpenCodeInvokeFn,
} from "@openmeld/adapter-opencode";
import {
  buildAgentContextLookupKey,
  buildRuntimeWorkspaceFingerprint,
  commitResolvedAgentContext,
  loadLedgerState,
  withLedgerStateTransaction,
} from "@openmeld/local-execution";
import {
  createInflightTaskControlRegistry,
  createLocalAdapterContainer,
  createPendingAgentInteractionRegistry,
} from "@openmeld/local-service";
import { RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION } from "@openmeld/schemas";
import type { RuntimeTransportDeliverDispatchRequest } from "@openmeld/schemas/types";
import { expect, it, vi } from "vitest";
import type { readOpenCodeSessionRows } from "../src/agent-activity/opencode-storage";
import type {
  DaemonProfileRouteConfig,
  LedgerPaths,
} from "../src/local-service/core/types";
import { acknowledgeDispatchResultOutboxRecord } from "../src/local-service/dispatch/dispatch-result-outbox";
import { handleDispatchDeliverFrame } from "../src/local-service/dispatch/execute-dispatch-task";
import { createLedgerIo } from "../src/local-service/state/ledger-io";
import { setCustomProfileWorkspace } from "../src/profile-workspace/service";
import { OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV } from "../src/runtime/dispatch-space-action-context";
import type { Presenter } from "../src/runtime/presenter/types";
import { runSpaceActionReply } from "../src/space/action-command";
import { withTempHome } from "./helpers/fs";

// Only external boundaries are replaced: native OpenCode storage/invocation,
// cloud reads, and the transport peer answering questions/accepting results.
const { readNativeSessions } = vi.hoisted(() => ({
  readNativeSessions: vi.fn<typeof readOpenCodeSessionRows>(),
}));
vi.mock("../src/agent-activity/opencode-storage", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/agent-activity/opencode-storage")
  >()),
  readOpenCodeSessionRows: readNativeSessions,
}));
vi.mock("../src/space/meta-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/space/meta-api")>()),
  fetchSpaceMeta: vi.fn().mockRejectedValue(new Error("offline test")),
}));
vi.mock("../src/space/updates-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/space/updates-api")>()),
  fetchSpaceUpdates: vi.fn().mockResolvedValue({ signals: [] }),
}));

const PROFILE = "agent-profile-1";
const CONTROLLER = "builtin:opencode";
const OLD_A = "retained-session-A";
const OLD_B = "retained-session-B";
const NEW_B = "new-session-B";

function delivery(
  sequence: number,
  conversationId: string | null
): RuntimeTransportDeliverDispatchRequest {
  const dispatchId = `dispatch-${sequence}`;
  const attemptId = `attempt-${sequence}`;
  const runtimeCoordinatorExecutionId = `rce_space-1_${dispatchId}_${PROFILE}`;
  return {
    v: 1,
    dispatchId,
    attemptId,
    ownerUserId: "user-1",
    profileId: PROFILE,
    daemonSessionId: "daemon-session-1",
    connectionGeneration: 1,
    leaseEpoch: 1,
    payload: {
      attemptId,
      dispatchContractVersion: 2,
      dispatchId,
      runtimeCoordinatorExecutionId,
      dispatchPolicy: "mention_only",
      controllerSnapshot: {
        agentControllerRef: CONTROLLER,
        bindingId: "binding-1",
        configurationRevision: 7,
        targetBindingEnabled: true,
        targetBindingState: "bound",
      },
      ...(conversationId
        ? { agentControllerConversationId: conversationId }
        : {}),
      contextIdMappingSpec: null,
      dispatchRulesSnapshot: {
        dispatchPolicy: "mention_only",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        ruleSource: "registry",
      },
      enqueuedAtMs: sequence,
      executionIdentity: {
        authority: "core_runtime_registry_binding_route",
        core: {
          modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
          spaceId: "space-1",
          dispatchId,
          targetProfileId: PROFILE,
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          bindingId: "binding-1",
          agentControllerRef: CONTROLLER,
        },
      },
      executionToken: {
        authorityScope: {
          bindingId: "binding-1",
          agentControllerRef: CONTROLLER,
          openMeldServiceRuntimeId: "runtime-1",
        },
        deliveryIdempotencyKey: `${runtimeCoordinatorExecutionId}:run-${sequence}`,
        deliveryProvenance: {
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-1",
          leaseEpoch: 1,
        },
        executionScope: {
          dispatchId,
          runtimeCoordinatorExecutionId,
          sourceClientMessageId: `client-message-${sequence}`,
          spaceId: "space-1",
          targetProfileId: PROFILE,
        },
        executionToken:
          "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        expiresAtMs: null,
        issuedAtMs: 1_700_000_000_000,
        modelVersion: "openmeld.runtime_coordinator.execution_token.v1",
        runId: `run-${sequence}`,
        tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        tokenStatus: "active",
      },
      idempotencyKey: `${dispatchId}:target:${PROFILE}`,
      sourceEventId: `signal-${sequence}`,
      sourceClientMessageId: `client-message-${sequence}`,
      sourceSignal: {
        profileId: "user-profile-1",
        profileKind: "human",
        text: "Please reply with the result.",
      },
      spaceId: "space-1",
      streamingMode: "final",
      targetProfileId: PROFILE,
      taskId: `task-${sequence}`,
      transportMode: "local-cli",
    },
  };
}

async function fixture(home: string, seedTarget = true) {
  const root = await realpath(home);
  if (process.env.OPENMELD_HOME !== join(home, ".openmeld")) {
    throw new Error("The regression requires an isolated OPENMELD_HOME");
  }
  const previous = join(root, "A");
  const selected = join(root, "B");
  await Promise.all([mkdir(previous), mkdir(selected)]);
  vi.stubEnv("XDG_DATA_HOME", join(root, "native-data"));
  vi.stubEnv("OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN", "1");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("network disabled in regression"))
  );
  await setCustomProfileWorkspace({
    openMeldProfileId: PROFILE,
    customWorkspacePath: selected,
  });
  const rootDirPath = join(root, ".openmeld", "ledger");
  const paths: LedgerPaths = {
    rootDirPath,
    stateFilePath: join(rootDirPath, "state.json"),
    stateTempFilePath: join(rootDirPath, "state.tmp.json"),
    backupStateFilePath: join(rootDirPath, "backup.json"),
    historyFilePath: join(rootDirPath, "history.ndjson"),
    historyTempFilePath: join(rootDirPath, "history.tmp.ndjson"),
  };
  const io = createLedgerIo();
  const key = (folder: string) =>
    buildAgentContextLookupKey({
      spaceId: "space-1",
      targetProfileId: PROFILE,
      agentControllerRef: CONTROLLER,
      transportMode: "local-cli",
      runtimeWorkspaceFingerprint: buildRuntimeWorkspaceFingerprint(folder),
    });
  await withLedgerStateTransaction({
    io,
    paths,
    mutate: (state) => {
      let nextState = state;
      for (const { folder, id } of [
        { folder: previous, id: OLD_A },
        ...(seedTarget ? [{ folder: selected, id: OLD_B }] : []),
      ]) {
        nextState = commitResolvedAgentContext({
          state: nextState,
          agentContextLookupKey: key(folder),
          agentControllerConversationId: id,
          agentControllerRef: CONTROLLER,
          spaceId: "space-1",
          targetProfileId: PROFILE,
          transportMode: "local-cli",
          runtimeWorkspaceFingerprint: buildRuntimeWorkspaceFingerprint(folder),
          taskId: "seed",
          nowMs: Date.now(),
        });
      }
      return { nextState, value: undefined };
    },
  });
  const seeded = await loadLedgerState({ io, paths });
  readNativeSessions.mockImplementation(async (_path, id) => [
    { id, directory: id === OLD_A ? previous : selected },
  ]);
  const invoke = vi.fn<OpenCodeInvokeFn>().mockImplementation((request) => {
    const previousContextPath =
      process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
    process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV] =
      request.env?.[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
    try {
      runSpaceActionReply({ messageParts: ["Done."] });
    } finally {
      if (previousContextPath === undefined) {
        delete process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
      } else {
        process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV] =
          previousContextPath;
      }
    }
    return Promise.resolve({
      contextDelta: {
        agentControllerConversationId:
          request.agentControllerConversationId ?? NEW_B,
      },
      output: "Done.",
    });
  });
  const localAdapterContainer = createLocalAdapterContainer([
    {
      adapter: createOpenCodeAdapter({ invoke }),
      adapterId: "opencode",
      transportModes: ["local-cli"],
    },
  ]);
  const route: DaemonProfileRouteConfig = {
    agentControllerRef: CONTROLLER,
    bindingId: "binding-1",
    configurationRevision: 7,
    contextIdMappingSpec: {
      mappingVersion: 1,
      sourceField: "OPENMELD_CLI_CONTEXT_ID",
    },
    openMeldServiceRuntimeId: "runtime-1",
    profileId: PROFILE,
    streamingMode: "final",
    transportMode: "local-cli",
    workingFolderRuntime: {
      configPath: join(root, "profile.json"),
      configuredWorkspacePath: selected,
      effectiveRuntimeWorkingDirectory: selected,
      runtimeContext: { providerRuntimeWorkingDirectory: selected },
      status: "ready",
      workingFolderSource: "profile_workspace",
      workspaceMode: "custom",
      workingFolderFact: {
        defaultProjectId: null,
        localProjectBindingGeneration: null,
        observedAtMs: Date.now(),
        reasonCode: null,
        source: "profile_workspace",
        status: "ready",
      },
    },
  };
  const events: unknown[] = [];
  const presenter: Presenter = {
    data: (event) => {
      events.push(event);
    },
    event: () => undefined,
    line: (event) => {
      events.push(event);
    },
    view: "agent",
  };
  const pending = createPendingAgentInteractionRegistry();
  let choice = "start_new_conversation";
  const questions: string[] = [];
  const results: Record<string, unknown>[] = [];
  const socket = {
    send: (raw: string) => {
      const frame = JSON.parse(raw);
      if (frame.code === "daemon.dispatch.interaction_request") {
        questions.push(frame.payload.interaction.interactionId);
        const resolution = pending.resolve({
          interactionId: frame.payload.interaction.interactionId,
          response: {
            kind: "question",
            answers: [
              { questionId: "working_folder_recovery", values: [choice] },
            ],
          },
        });
        if (resolution.status !== "resolved") {
          throw new Error(
            `Recovery response was not accepted: ${resolution.status}`
          );
        }
      }
      if (frame.code === "daemon.dispatch.result") {
        results.push(frame.payload.taskResult.payload);
        queueMicrotask(() =>
          acknowledgeDispatchResultOutboxRecord({
            attemptId: frame.payload.attemptId,
            dispatchId: frame.payload.dispatchId,
            ledgerPaths: paths,
            presenter,
            ok: true,
            status: "accepted",
          })
        );
      }
    },
  };
  const read = () => loadLedgerState({ io: createLedgerIo(), paths });
  return {
    seeded,
    previous,
    selected,
    invoke,
    read,
    key,
    events,
    results,
    questions,
    io,
    paths,
    choose: (value: string) => {
      choice = value;
    },
    wake: (sequence: number, conversationId: string | null = OLD_A) =>
      handleDispatchDeliverFrame({
        computerFileAccessStorePath: join(rootDirPath, "computer-policy.json"),
        contextStore: new Map(),
        currentSocketRef: { connectionGeneration: 1, socket },
        daemonSessionId: "daemon-session-1",
        deliverRequest: delivery(sequence, conversationId),
        inflightDispatchMetaByTaskId: new Map(),
        inflightTaskControlRegistry: createInflightTaskControlRegistry(),
        pendingAgentInteractionRegistry: pending,
        ledgerPaths: paths,
        leasesByProfileId: new Map([[PROFILE, 1]]),
        localAdapterContainer,
        profileOwnerName: "Owner",
        profileOwnerUserId: "user-1",
        presenter,
        routeByProfileId: new Map([[PROFILE, route]]),
        socket,
      }),
  };
}

it.each([
  false,
  true,
])("starts fresh through dispatch and resumes the new session on the next Wake (retained B: %s)", async (seedTarget) => {
  await withTempHome(async (home) => {
    const f = await fixture(home, seedTarget);
    expect(
      f.seeded.agentContextByLookupKey[f.key(f.previous)]
        ?.agentControllerConversationId
    ).toBe(OLD_A);
    expect(
      f.seeded.agentContextByLookupKey[f.key(f.selected)]
        ?.agentControllerConversationId
    ).toBe(seedTarget ? OLD_B : undefined);
    const first = await f.wake(1);
    expect(f.invoke).toHaveBeenCalledOnce();
    expect(f.invoke.mock.calls[0]?.[0]).toMatchObject({
      agentControllerConversationId: null,
      runtimeContext: { providerRuntimeWorkingDirectory: f.selected },
    });
    expect(first.result, JSON.stringify(f.events)).toBe("success");
    const state = await f.read();
    expect(
      state.agentContextByLookupKey[f.key(f.selected)]
        ?.agentControllerConversationId
    ).toBe(NEW_B);
    expect(
      state.agentContextByLookupKey[f.key(f.previous)]
        ?.agentControllerConversationId
    ).toBe(OLD_A);
    expect(f.results.at(-1)).toMatchObject({
      agentControllerConversationId: NEW_B,
    });
    // No process-local contextStore or Binding hint: recover only the persisted association.
    await f.wake(2, null);
    expect(f.invoke.mock.calls[1]?.[0].agentControllerConversationId).toBe(
      NEW_B
    );
    expect(f.questions).toHaveLength(1);
  });
});

it("retains old associations after a failed fresh attempt and its deduplicated redelivery", async () => {
  await withTempHome(async (home) => {
    const f = await fixture(home);
    f.invoke.mockRejectedValue(
      new Error("native launch failed before observing a session")
    );
    await f.wake(1);
    expect(f.invoke).toHaveBeenCalledOnce();
    expect(
      (await f.read()).agentContextByLookupKey[f.key(f.selected)]
        ?.agentControllerConversationId
    ).toBe(OLD_B);
    await f.wake(1);
    expect(f.invoke).toHaveBeenCalledOnce();
    expect(f.results.at(-1)).toMatchObject({ deduped: true });
    expect(
      (await f.read()).agentContextByLookupKey[f.key(f.selected)]
        ?.agentControllerConversationId
    ).toBe(OLD_B);
  });
});

it("does not roll back an observed new native session when its turn later fails", async () => {
  await withTempHome(async (home) => {
    const f = await fixture(home);
    f.invoke.mockImplementationOnce(async (request) => {
      request.onRuntimeEvent?.({
        phase: "provider_conversation_observed",
        tsMs: Date.now(),
        agentControllerConversationId: NEW_B,
      });
      // Drain the real observation transaction before the provider fails.
      await withLedgerStateTransaction({
        io: f.io,
        paths: f.paths,
        mutate: (state) => {
          expect(
            state.agentContextByLookupKey[f.key(f.selected)]
              ?.agentControllerConversationId
          ).toBe(NEW_B);
          return { nextState: state, value: undefined };
        },
      });
      throw new Error("native turn failed after session creation");
    });
    await f.wake(1);
    expect(f.invoke).toHaveBeenCalledOnce();
    expect(
      (await f.read()).agentContextByLookupKey[f.key(f.selected)]
        ?.agentControllerConversationId
    ).toBe(NEW_B);
    await f.wake(2, null);
    expect(f.invoke.mock.calls[1]?.[0].agentControllerConversationId).toBe(
      NEW_B
    );
  });
});

it("continues the verified previous conversation without replacing retained B", async () => {
  await withTempHome(async (home) => {
    const f = await fixture(home);
    f.choose("use_previous_folder");
    await f.wake(1);
    expect(readNativeSessions).toHaveBeenCalledTimes(2);
    expect(f.invoke).toHaveBeenCalledOnce();
    expect(f.invoke.mock.calls[0]?.[0]).toMatchObject({
      agentControllerConversationId: OLD_A,
      runtimeContext: { providerRuntimeWorkingDirectory: f.previous },
    });
    expect(
      (await f.read()).agentContextByLookupKey[f.key(f.selected)]
        ?.agentControllerConversationId
    ).toBe(OLD_B);
  });
});
