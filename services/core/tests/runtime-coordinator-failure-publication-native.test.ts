import type { SignalEnvelope } from "@openmeld/protocol";
import {
  projectTargetWakeLifecycleIdentity,
  RUNTIME_COORDINATOR_FAILURE_PUBLICATION_COMMAND_MODEL_VERSION,
} from "@openmeld/schemas";
import type { RuntimeCoordinatorFailurePublicationCommand } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { insertSignalRecord } from "../src/space/infrastructure/sql/space-signal-repo";
import { Space } from "../src/space/transport/do/space";
import { createFinalOutcomeSql } from "../test-support/space-final-outcome.test-support";
import { env } from "../test-support/worker-env";
import { createWorkerPostgresFixture } from "./postgresql.test-support";

describe("native RuntimeCoordinator failure task publication", () => {
  it("applies a RuntimeCoordinator failure publication command as one visible terminal failure notice", async () => {
    const nativeFixture = await createWorkerPostgresFixture(env);
    const { signalRows, sql, sqlExec } = createFinalOutcomeSql();
    const sourceWakeSignal = {
      v: 1,
      id: "sig-source-1",
      spaceId: "space-1",
      ts: 1_700_000_000_000,
      profile: {
        kind: "human",
        profileId: "22222222-2222-4222-8222-222222222222",
        profileName: "Mira",
      },
      type: "signal.text",
      data: {
        text: "@Codex Agent(wake) please check the deploy",
      },
    } satisfies SignalEnvelope;
    signalRows.set(sourceWakeSignal.id, {
      payloadJson: JSON.stringify(sourceWakeSignal),
      ts: sourceWakeSignal.ts,
    });
    const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-failure-publication-1",
      sourceSignalId: "sig-source-1",
      spaceId: "space-1",
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
    });
    const command = {
      createdAtMs: 1_700_000_000_000,
      dispatchId: "dispatch-failure-publication-1",
      failurePublicationCommandId: "failure-command-1",
      modelVersion:
        RUNTIME_COORDINATOR_FAILURE_PUBLICATION_COMMAND_MODEL_VERSION,
      ownerUserId: "owner-1",
      publicationCategory: "service_not_connected",
      publicationIntentId: "publication-intent-1",
      reasonCode: "daemon.profile.offline",
      spaceId: "space-1",
      targetProfileMentionLabel: "Codex Agent",
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
      targetProfileName: "Codex Agent",
      targetWakeLifecycleIdentity,
      targetWakeLifecycleId: targetWakeLifecycleIdentity.targetWakeLifecycleId,
      userRecoveryAction: "start_or_restart_openmeld_service",
    } satisfies RuntimeCoordinatorFailurePublicationCommand;
    const threadContext = {
      rootSignalId: sourceWakeSignal.id,
      threadId: "thr_11111111-1111-4111-8111-111111111111",
    };
    const broadcastSignal = vi.fn();
    const persistSignalWithOptionalOutbox = vi.fn((signal: SignalEnvelope) => {
      const result = insertSignalRecord(sql, signal);
      return {
        dispatchMessages: [],
        duplicateFinalReplyBlocked: result.duplicateFinalReplyBlocked,
        persistedSignal: result.persistedSignal,
      };
    });
    let builtNoticeCount = 0;
    const space = Object.create(Space.prototype) as {
      applySpaceRef: (spaceId: string) => void;
      broadcastSignal: (
        signal: SignalEnvelope,
        signalContext?: unknown
      ) => void;
      buildSystemNoticeSignal: (
        profile: SignalEnvelope["profile"],
        data: Extract<SignalEnvelope, { type: "signal.system_notice" }>["data"]
      ) => SignalEnvelope;
      bindings: CoreBindings;
      ctx: { storage: { sql: SqlStorage } };
      lastTimestamp: number;
      persistSignalWithOptionalOutbox: (
        signal: SignalEnvelope,
        createOutboxRecord: boolean,
        signalContext?: unknown
      ) => {
        dispatchMessages: unknown[];
        duplicateFinalReplyBlocked: boolean;
        persistedSignal: boolean;
      };
      readSignalById: (signalId: string) => SignalEnvelope | null;
      resolveThreadContextForSignal: () => typeof threadContext;
      rpcApplyRuntimeCoordinatorFailurePublicationCommand: Space["rpcApplyRuntimeCoordinatorFailurePublicationCommand"];
      spaceId: string;
    };
    Object.defineProperty(space, "bindings", {
      value: { OPENMELD_POSTGRESQL: nativeFixture.binding },
      configurable: true,
    });
    Object.defineProperties(space, {
      applySpaceRef: {
        value: vi.fn((spaceId: string) => {
          space.spaceId = spaceId;
        }),
      },
      broadcastSignal: { value: broadcastSignal },
      buildSystemNoticeSignal: {
        value: vi.fn(
          (
            profile: SignalEnvelope["profile"],
            data: Extract<
              SignalEnvelope,
              { type: "signal.system_notice" }
            >["data"]
          ) =>
            ({
              v: 1,
              id: `sig-runtime-failure-${++builtNoticeCount}`,
              spaceId: "space-1",
              ts: 1_700_000_000_100,
              profile,
              type: "signal.system_notice",
              data,
            }) satisfies SignalEnvelope
        ),
      },
      bindings: {
        value: { OPENMELD_POSTGRESQL: nativeFixture.binding } as CoreBindings,
      },
      ctx: { value: { storage: { sql } } },
      lastTimestamp: { value: 0, writable: true },
      persistSignalWithOptionalOutbox: {
        value: persistSignalWithOptionalOutbox,
      },
      readSignalById: {
        value: vi.fn((signalId: string) => {
          const row = signalRows.get(signalId);
          return row ? (JSON.parse(row.payloadJson) as SignalEnvelope) : null;
        }),
      },
      resolveThreadContextForSignal: { value: vi.fn(() => threadContext) },
      spaceId: { value: "space-1", writable: true },
    });

    await expect(
      space.rpcApplyRuntimeCoordinatorFailurePublicationCommand(command)
    ).resolves.toMatchObject({
      failurePublicationCommandId: "failure-command-1",
      finalMessageKind: "failure_notice",
      ok: true,
      publicationAction: "created",
      publishedSignalId: "sig-runtime-failure-1",
      status: "failure_published",
    });
    const persistedSignalRow = signalRows.get("sig-runtime-failure-1");
    expect(persistedSignalRow).toBeDefined();
    expect(JSON.parse(String(persistedSignalRow?.payloadJson))).toMatchObject({
      data: {
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        actorName: "Codex Agent",
        dispatchId: "dispatch-failure-publication-1",
        failureStage: "execution",
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        reason: "daemon.profile.offline",
        reasonCode: "daemon.profile.offline",
        replyTo: {
          previewText: "@Codex Agent(wake) please check the deploy",
          profileId: "22222222-2222-4222-8222-222222222222",
          profileKind: "human",
          profileName: "Mira",
          signalId: "sig-source-1",
        },
        text: "OpenMeld could not reach Codex Agent on this computer for this Wake. Reconnect the computer, then try again.",
      },
      type: "signal.system_notice",
    });
    expect(persistSignalWithOptionalOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sig-runtime-failure-1",
      }),
      false,
      {
        finalOutcomeAuthority: "runtime_coordinator_failure_publication",
        threadContext,
      }
    );
    expect(broadcastSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sig-runtime-failure-1",
      }),
      {
        finalOutcomeAuthority: "runtime_coordinator_failure_publication",
        threadContext,
      },
      {
        persisted: true,
      }
    );
    expect(broadcastSignal).toHaveBeenCalledTimes(1);

    await expect(
      space.rpcApplyRuntimeCoordinatorFailurePublicationCommand(command)
    ).resolves.toMatchObject({
      finalMessageKind: "failure_notice",
      publicationAction: "already_visible",
      publishedSignalId: "sig-runtime-failure-1",
      status: "failure_published",
    });
    expect(persistSignalWithOptionalOutbox).toHaveBeenCalledTimes(1);
    expect(broadcastSignal).toHaveBeenCalledTimes(1);

    const secondTargetWakeLifecycleIdentity =
      projectTargetWakeLifecycleIdentity({
        clientMessageId: "client-message-1",
        dispatchId: "dispatch-failure-publication-2",
        sourceSignalId: "sig-source-1",
        spaceId: "space-1",
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      });
    const secondCommand = {
      ...command,
      dispatchId: "dispatch-failure-publication-2",
      failurePublicationCommandId: "failure-command-2",
      publicationIntentId: "publication-intent-2",
      reasonCode: "organization_binding_authorization.required",
      targetProfileMentionLabel: "Review Agent",
      targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      targetProfileName: "Review Agent",
      targetWakeLifecycleIdentity: secondTargetWakeLifecycleIdentity,
      targetWakeLifecycleId:
        secondTargetWakeLifecycleIdentity.targetWakeLifecycleId,
    } satisfies RuntimeCoordinatorFailurePublicationCommand;

    await expect(
      space.rpcApplyRuntimeCoordinatorFailurePublicationCommand(secondCommand)
    ).resolves.toMatchObject({
      failurePublicationCommandId: "failure-command-2",
      finalMessageKind: "failure_notice",
      ok: true,
      publicationAction: "created",
      publishedSignalId: "sig-runtime-failure-2",
      status: "failure_published",
    });
    const secondPersistedSignalRow = signalRows.get("sig-runtime-failure-2");
    expect(
      JSON.parse(String(secondPersistedSignalRow?.payloadJson))
    ).toMatchObject({
      data: {
        actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
        actorName: "Review Agent",
        dispatchId: "dispatch-failure-publication-2",
        failureStage: "execution",
        reasonCode: "organization_binding_authorization.required",
        text: "Review Agent cannot be used in this workspace. Choose an Agent Profile created here.",
      },
      type: "signal.system_notice",
    });
    expect(persistSignalWithOptionalOutbox).toHaveBeenCalledTimes(2);
    expect(broadcastSignal).toHaveBeenCalledTimes(2);
    expect(
      sqlExec.mock.calls.some(([query]) =>
        String(query).includes("FROM space_members")
      )
    ).toBe(false);
    const terminalRecords = await nativeFixture.db.query<{
      status: string;
      task_handle_json: string;
      outcome_json: string;
    }>(
      'SELECT status, task_handle_json, outcome_json FROM "openmeld"."agent_task_terminal_outcomes" ORDER BY task_key'
    );
    expect(terminalRecords.rows).toHaveLength(2);
    expect(terminalRecords.rows.map((row) => row.status)).toEqual([
      "failed",
      "failed",
    ]);
    const terminalTasks = terminalRecords.rows.map((row) =>
      JSON.parse(row.task_handle_json)
    );
    expect(terminalTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          spaceId: "space-1",
          sourceClientMessageId: "client-message-1",
          targetProfileId: command.targetProfileId,
        }),
        expect.objectContaining({
          spaceId: "space-1",
          sourceClientMessageId: "client-message-1",
          targetProfileId: secondCommand.targetProfileId,
        }),
      ])
    );
  });
  it("falls back to the profile id when a RuntimeCoordinator failure publication rebuilds replyTo for a source signal without profile.profileName", async () => {
    const nativeFixture = await createWorkerPostgresFixture(env);
    // Reproduces the W-ERR2-R1 dogfood gap: a Center Agent tool call posts
    // the Wake with profile.kind "agent", but services/remote-agent's
    // toOpenMeldRequestContext never sets actorContext.profileName (unlike a
    // Gateway-authenticated human session), so the persisted source signal's
    // profile.profileName is absent. Before the fix,
    // buildRuntimeCoordinatorFailurePublicationReplyTo required
    // profile.profileName with no fallback and returned null, so the
    // published terminal_failure notice had no replyTo. It must now fall
    // back to a resolved Space membership snapshot, then the profile id.
    const { signalRows, sql } = createFinalOutcomeSql();
    const centerAgentProfileId = "agt_44444444-4444-4444-8444-444444444444";
    const sourceWakeSignal = {
      v: 1,
      id: "sig-center-agent-source-1",
      spaceId: "space-1",
      ts: 1_700_000_000_000,
      profile: {
        kind: "agent",
        profileId: centerAgentProfileId,
      },
      type: "signal.text",
      data: {
        text: "@Codex Agent(wake) please check the deploy",
      },
    } satisfies SignalEnvelope;
    signalRows.set(sourceWakeSignal.id, {
      payloadJson: JSON.stringify(sourceWakeSignal),
      ts: sourceWakeSignal.ts,
    });
    const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-center-agent-failure-publication-1",
      sourceSignalId: sourceWakeSignal.id,
      spaceId: "space-1",
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
    });
    const command = {
      createdAtMs: 1_700_000_000_000,
      dispatchId: "dispatch-center-agent-failure-publication-1",
      failurePublicationCommandId: "center-agent-failure-command-1",
      modelVersion:
        RUNTIME_COORDINATOR_FAILURE_PUBLICATION_COMMAND_MODEL_VERSION,
      ownerUserId: "owner-1",
      publicationCategory: "service_not_connected",
      publicationIntentId: "center-agent-publication-intent-1",
      reasonCode: "daemon.profile.offline",
      spaceId: "space-1",
      targetProfileMentionLabel: "Codex Agent",
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
      targetProfileName: "Codex Agent",
      targetWakeLifecycleIdentity,
      targetWakeLifecycleId: targetWakeLifecycleIdentity.targetWakeLifecycleId,
      userRecoveryAction: "start_or_restart_openmeld_service",
    } satisfies RuntimeCoordinatorFailurePublicationCommand;
    let builtNoticeCount = 0;
    const space = Object.create(Space.prototype) as {
      applySpaceRef: (spaceId: string) => void;
      broadcastSignal: (
        signal: SignalEnvelope,
        signalContext?: unknown
      ) => void;
      buildSystemNoticeSignal: (
        profile: SignalEnvelope["profile"],
        data: Extract<SignalEnvelope, { type: "signal.system_notice" }>["data"]
      ) => SignalEnvelope;
      bindings: CoreBindings;
      ctx: { storage: { sql: SqlStorage } };
      lastTimestamp: number;
      persistSignalWithOptionalOutbox: (
        signal: SignalEnvelope,
        createOutboxRecord: boolean,
        signalContext?: unknown
      ) => {
        dispatchMessages: unknown[];
        duplicateFinalReplyBlocked: boolean;
        persistedSignal: boolean;
      };
      readSignalById: (signalId: string) => SignalEnvelope | null;
      resolveThreadContextForSignal: () => null;
      rpcApplyRuntimeCoordinatorFailurePublicationCommand: Space["rpcApplyRuntimeCoordinatorFailurePublicationCommand"];
      spaceId: string;
    };
    Object.defineProperty(space, "bindings", {
      value: { OPENMELD_POSTGRESQL: nativeFixture.binding },
      configurable: true,
    });
    Object.defineProperties(space, {
      applySpaceRef: {
        value: vi.fn((spaceId: string) => {
          space.spaceId = spaceId;
        }),
      },
      broadcastSignal: { value: vi.fn() },
      buildSystemNoticeSignal: {
        value: vi.fn(
          (
            profile: SignalEnvelope["profile"],
            data: Extract<
              SignalEnvelope,
              { type: "signal.system_notice" }
            >["data"]
          ) =>
            ({
              v: 1,
              id: `sig-center-agent-runtime-failure-${++builtNoticeCount}`,
              spaceId: "space-1",
              ts: 1_700_000_000_100,
              profile,
              type: "signal.system_notice",
              data,
            }) satisfies SignalEnvelope
        ),
      },
      bindings: {
        value: { OPENMELD_POSTGRESQL: nativeFixture.binding } as CoreBindings,
      },
      ctx: { value: { storage: { sql } } },
      lastTimestamp: { value: 0, writable: true },
      persistSignalWithOptionalOutbox: {
        value: vi.fn((signal: SignalEnvelope) => {
          const result = insertSignalRecord(sql, signal);
          return {
            dispatchMessages: [],
            duplicateFinalReplyBlocked: result.duplicateFinalReplyBlocked,
            persistedSignal: result.persistedSignal,
          };
        }),
      },
      readSignalById: {
        value: vi.fn((signalId: string) => {
          const row = signalRows.get(signalId);
          return row ? (JSON.parse(row.payloadJson) as SignalEnvelope) : null;
        }),
      },
      resolveThreadContextForSignal: { value: vi.fn(() => null) },
      spaceId: { value: "space-1", writable: true },
    });

    await expect(
      space.rpcApplyRuntimeCoordinatorFailurePublicationCommand(command)
    ).resolves.toMatchObject({
      failurePublicationCommandId: "center-agent-failure-command-1",
      finalMessageKind: "failure_notice",
      ok: true,
      publicationAction: "created",
      publishedSignalId: "sig-center-agent-runtime-failure-1",
      status: "failure_published",
    });
    const persistedSignalRow = signalRows.get(
      "sig-center-agent-runtime-failure-1"
    );
    expect(persistedSignalRow).toBeDefined();
    expect(JSON.parse(String(persistedSignalRow?.payloadJson))).toMatchObject({
      data: {
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        dispatchId: "dispatch-center-agent-failure-publication-1",
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        reason: "daemon.profile.offline",
        replyTo: {
          previewText: "@Codex Agent(wake) please check the deploy",
          profileId: centerAgentProfileId,
          profileKind: "agent",
          // No Space member snapshot is wired into this harness, so the
          // fallback resolves to the raw profile id -- the point of this
          // assertion is that replyTo exists at all instead of being
          // dropped, not the display value.
          profileName: centerAgentProfileId,
          signalId: sourceWakeSignal.id,
        },
      },
      type: "signal.system_notice",
    });
    const terminalRecords = await nativeFixture.db.query<{
      status: string;
      task_handle_json: string;
      outcome_json: string;
    }>(
      'SELECT status, task_handle_json, outcome_json FROM "openmeld"."agent_task_terminal_outcomes" ORDER BY task_key'
    );
    expect(terminalRecords.rows).toHaveLength(1);
    expect(terminalRecords.rows.map((row) => row.status)).toEqual(["failed"]);
    const terminalTasks = terminalRecords.rows.map((row) =>
      JSON.parse(row.task_handle_json)
    );
    expect(terminalTasks).toEqual([
      expect.objectContaining({
        spaceId: "space-1",
        sourceClientMessageId: "client-message-1",
        targetProfileId: command.targetProfileId,
      }),
    ]);
  });
});
