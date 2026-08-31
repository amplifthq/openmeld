import type { SignalEnvelope } from "@openmeld/protocol";
import {
  AGENT_REPLY_FINAL_PURPOSE,
  AGENT_REPLY_PREVIEW_PURPOSE,
  AGENT_REPLYING_PURPOSE,
  DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
  DISPATCH_ACTIVITY_FAILED_PURPOSE,
  DISPATCH_ACTIVITY_RETRYING_PURPOSE,
  REMOTE_AGENT_FAILURE_PURPOSE,
} from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyWakeProgressSignals,
  createWakeProgressItem,
  hasVisibleActiveWakeProgress,
  isActiveWakeProgressItem,
  isWakeProgressSourceSignalRecoverable,
  mergeWakeProgressItems,
} from "../src";

const TARGET_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";
const OTHER_TARGET_PROFILE_ID = "agt_44444444-4444-4444-8444-444444444444";

describe("Wake progress projection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    "sending",
    "request_sent",
    "queued",
    "connecting",
    "running",
    "writing",
    "publishing",
    "retrying",
  ] as const)("classifies visible %s progress as active", (phase) => {
    const item = createWakeProgressItem({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-1",
      phase,
      sourceSignalId: "sig-source-1",
      targetLabel: "Codex",
      targetProfileId: TARGET_PROFILE_ID,
      updatedAtMs: 1000,
    });

    expect(isActiveWakeProgressItem(item)).toBe(true);
    expect(hasVisibleActiveWakeProgress({ items: [item], nowMs: 1000 })).toBe(
      true
    );
  });

  it("does not classify terminal progress as active and keeps Core-owned work active", () => {
    const terminalItem = createWakeProgressItem({
      clientMessageId: "client-message-terminal",
      dispatchId: "dispatch-terminal",
      phase: "failed",
      sourceSignalId: "sig-source-terminal",
      targetLabel: "Codex",
      targetProfileId: TARGET_PROFILE_ID,
      updatedAtMs: 1000,
    });
    const expiredItem = createWakeProgressItem({
      clientMessageId: "client-message-expired",
      dispatchId: "dispatch-expired",
      phase: "running",
      sourceSignalId: "sig-source-expired",
      targetLabel: "Codex",
      targetProfileId: TARGET_PROFILE_ID,
      updatedAtMs: 1000,
    });

    expect(isActiveWakeProgressItem(terminalItem)).toBe(false);
    expect(
      hasVisibleActiveWakeProgress({ items: [terminalItem], nowMs: 1000 })
    ).toBe(false);
    expect(
      hasVisibleActiveWakeProgress({
        items: [expiredItem],
        nowMs: 1_801_001,
      })
    ).toBe(true);
  });

  it("keeps ordinary dispatch delivery progress neutral without Profile FIFO evidence", () => {
    const items = applyWakeProgressSignals({
      currentItems: [],
      signals: [
        createTextSignal({
          id: "sig-dispatching",
          ts: 30,
          text: "legacy text ignored",
          meta: {
            dispatchId: "dispatch-1",
            purpose: DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
            sourceClientMessageId: "client-message-1",
            sourceEventId: "sig-source-1",
            targetMentionLabel: "Codex",
            targetProfileId: TARGET_PROFILE_ID,
            transient: true,
          },
        }),
      ],
    });

    expect(items).toEqual([
      expect.objectContaining({
        phase: "request_sent",
        message: "Wake request sent to @Codex.",
      }),
    ]);
  });

  it("projects Wake progress from local send through final reply cleanup", () => {
    let items = mergeWakeProgressItems({
      currentItems: [],
      incomingItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: null,
          phase: "sending",
          sourceSignalId: null,
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 10,
        }),
      ],
    });

    expect(items.map((item) => item.message)).toEqual(["Sending message..."]);

    items = mergeWakeProgressItems({
      currentItems: items,
      incomingItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: null,
          phase: "request_sent",
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 20,
        }),
      ],
    });
    expect(items[0]).toMatchObject({
      phase: "request_sent",
      message: "Wake request sent to @Codex.",
    });

    items = applyWakeProgressSignals({
      currentItems: items,
      signals: [
        createTextSignal({
          id: "sig-dispatching",
          ts: 30,
          text: "legacy text ignored",
          meta: {
            dispatchId: "dispatch-1",
            purpose: DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
            sourceClientMessageId: "client-message-1",
            sourceEventId: "sig-source-1",
            targetMentionLabel: "Codex",
            targetProfileId: TARGET_PROFILE_ID,
            transient: true,
          },
        }),
      ],
    });
    expect(items[0]).toMatchObject({
      dispatchId: "dispatch-1",
      phase: "request_sent",
      message: "Wake request sent to @Codex.",
    });

    items = applyWakeProgressSignals({
      currentItems: items,
      signals: [
        createTextSignal({
          id: "sig-running",
          ts: 40,
          text: "legacy text ignored",
          meta: {
            dispatchId: "dispatch-1",
            purpose: AGENT_REPLYING_PURPOSE,
            sourceClientMessageId: "client-message-1",
            sourceEventId: "sig-source-1",
            targetMentionLabel: "Codex",
            targetProfileId: TARGET_PROFILE_ID,
            transient: true,
          },
        }),
        createTextSignal({
          id: "sig-preview",
          ts: 50,
          text: "I’m checking the release configuration now.",
          meta: {
            dispatchId: "dispatch-1",
            purpose: AGENT_REPLY_PREVIEW_PURPOSE,
            sourceClientMessageId: "client-message-1",
            sourceEventId: "sig-source-1",
            targetMentionLabel: "Codex",
            targetProfileId: TARGET_PROFILE_ID,
            transient: true,
          },
        }),
      ],
    });
    expect(items[0]).toMatchObject({
      phase: "writing",
      message: "I’m checking the release configuration now.",
    });

    items = applyWakeProgressSignals({
      currentItems: items,
      signals: [
        createTextSignal({
          id: "sig-final",
          ts: 60,
          text: "Done.",
          meta: {
            dispatchId: "dispatch-1",
            purpose: AGENT_REPLY_FINAL_PURPOSE,
            targetProfileId: TARGET_PROFILE_ID,
          },
          replyTo: {
            signalId: "sig-source-1",
            profileId: "11111111-1111-4111-8111-111111111111",
            profileKind: "human",
            profileName: "Mira",
            previewText: "@Codex(wake) hello",
          },
        }),
      ],
    });
    expect(items).toEqual([]);
  });

  it("keeps publishing progress visible until the final reply reaches the Space", () => {
    let items = mergeWakeProgressItems({
      currentItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-1",
          phase: "writing",
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 100,
        }),
      ],
      incomingItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-1",
          phase: "publishing",
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 110,
        }),
      ],
    });

    expect(items[0]).toMatchObject({
      phase: "publishing",
      message: "Posting final message for @Codex...",
      terminal: false,
    });

    items = applyWakeProgressSignals({
      currentItems: items,
      signals: [
        createTextSignal({
          id: "sig-final",
          ts: 120,
          text: "Done.",
          meta: {
            dispatchId: "dispatch-1",
            purpose: AGENT_REPLY_FINAL_PURPOSE,
            targetProfileId: TARGET_PROFILE_ID,
          },
          replyTo: {
            signalId: "sig-source-1",
            profileId: "11111111-1111-4111-8111-111111111111",
            profileKind: "human",
            profileName: "Mira",
            previewText: "@Codex(wake) hello",
          },
        }),
      ],
    });
    expect(items).toEqual([]);
  });

  it("lets retrying replace an older running row by structured phase rank", () => {
    const items = applyWakeProgressSignals({
      currentItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-1",
          phase: "running",
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 100,
        }),
      ],
      signals: [
        createTextSignal({
          id: "sig-retry",
          ts: 90,
          text: "legacy text ignored",
          meta: {
            dispatchId: "dispatch-1",
            errorCode: "timeout",
            purpose: DISPATCH_ACTIVITY_RETRYING_PURPOSE,
            sourceClientMessageId: "client-message-1",
            sourceEventId: "sig-source-1",
            targetMentionLabel: "Codex",
            targetProfileId: TARGET_PROFILE_ID,
            transient: true,
          },
        }),
      ],
    });

    expect(items[0]).toMatchObject({
      phase: "retrying",
      message: "Still trying to reach @Codex...",
    });
  });

  it("clears only the target that produced a final reply in a multi-target Wake", () => {
    const items = applyWakeProgressSignals({
      currentItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: null,
          phase: "retrying",
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 100,
        }),
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: null,
          phase: "retrying",
          sourceSignalId: "sig-source-1",
          targetLabel: "Claude",
          targetProfileId: OTHER_TARGET_PROFILE_ID,
          updatedAtMs: 100,
        }),
      ],
      signals: [
        createTextSignal({
          id: "sig-final-codex",
          ts: 150,
          text: "Done.",
          meta: {
            purpose: AGENT_REPLY_FINAL_PURPOSE,
            targetProfileId: TARGET_PROFILE_ID,
          },
          replyTo: {
            signalId: "sig-source-1",
            profileId: "11111111-1111-4111-8111-111111111111",
            profileKind: "human",
            profileName: "Mira",
            previewText: "@Codex(wake) @Claude(wake) hello",
          },
        }),
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      phase: "retrying",
      targetLabel: "@Claude",
      targetProfileId: OTHER_TARGET_PROFILE_ID,
    });
  });

  it("does not let retrying reopen an unknown terminal publication outcome", () => {
    const items = mergeWakeProgressItems({
      currentItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-1",
          phase: "publication_unknown",
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 100,
        }),
      ],
      incomingItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-1",
          phase: "retrying",
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 200,
        }),
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      phase: "publication_unknown",
      terminal: true,
    });
  });

  it.each([
    "stay_silent",
    "policy_blocked",
  ] as const)("clears only the target closed by a %s notice in a multi-target Wake", (noticeType) => {
    const items = applyWakeProgressSignals({
      currentItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-codex",
          phase: "running",
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 100,
        }),
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-claude",
          phase: "running",
          sourceSignalId: "sig-source-1",
          targetLabel: "Claude",
          targetProfileId: OTHER_TARGET_PROFILE_ID,
          updatedAtMs: 100,
        }),
      ],
      signals: [
        createSystemNoticeSignal({
          id: `sig-${noticeType}`,
          ts: 150,
          data: {
            actorName: "Codex",
            actorProfileId: TARGET_PROFILE_ID,
            dispatchId: "dispatch-codex",
            generatedBy: "openmeld",
            noticeType,
            resultRef: `${noticeType}:dispatch-codex`,
            text: `Codex ${noticeType}.`,
          },
        }),
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      dispatchId: "dispatch-claude",
      phase: "running",
      targetProfileId: OTHER_TARGET_PROFILE_ID,
    });
  });

  it("clears active progress when the agent posts a final status", () => {
    const items = applyWakeProgressSignals({
      currentItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-1",
          phase: "running",
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 100,
        }),
      ],
      signals: [
        {
          v: 1,
          id: "sig-status",
          spaceId: "space-123",
          ts: 150,
          profile: {
            kind: "agent",
            profileId: TARGET_PROFILE_ID,
            profileName: "Codex",
          },
          type: "signal.status",
          data: {
            actorProfileId: TARGET_PROFILE_ID,
            dispatchId: "dispatch-1",
            generatedBy: "openmeld",
            replyTo: {
              signalId: "sig-source-1",
              profileId: "11111111-1111-4111-8111-111111111111",
              profileKind: "human",
              profileName: "Mira",
              previewText: "@Codex(wake) hello",
            },
            status: "done",
            text: "Done.",
          },
        },
      ],
    });

    expect(items).toEqual([]);
  });

  it("clears active progress when Remote Agent publishes a Core-owned failure reply", () => {
    const items = applyWakeProgressSignals({
      currentItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-1",
          phase: "publishing",
          sourceSignalId: "sig-source-1",
          targetLabel: "Center Agent",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 100,
        }),
      ],
      signals: [
        createTextSignal({
          id: "sig-remote-agent-failure",
          ts: 150,
          text: "Remote Agent could not start this request.",
          meta: {
            dispatchId: "dispatch-1",
            errorCode: "remote_agent.worker_submit_failed",
            purpose: REMOTE_AGENT_FAILURE_PURPOSE,
            targetProfileId: TARGET_PROFILE_ID,
          },
          replyTo: {
            signalId: "sig-source-1",
            profileId: "11111111-1111-4111-8111-111111111111",
            profileKind: "human",
            profileName: "Mira",
            previewText: "hi",
          },
        }),
      ],
    });

    expect(items).toEqual([]);
  });

  it("names the computer when transient progress includes runtime device metadata", () => {
    const items = applyWakeProgressSignals({
      currentItems: [],
      signals: [
        createTextSignal({
          id: "sig-running",
          ts: 100,
          text: "legacy text ignored",
          meta: {
            dispatchId: "dispatch-1",
            purpose: AGENT_REPLYING_PURPOSE,
            runtimeDeviceDisplayName: "Felix's MacBook Pro",
            sourceClientMessageId: "client-message-1",
            sourceEventId: "sig-source-1",
            targetMentionLabel: "Codex",
            targetProfileId: TARGET_PROFILE_ID,
            transient: true,
          },
        }),
      ],
    });

    expect(items[0]).toMatchObject({
      phase: "running",
      message: "@Codex is working on Felix's MacBook Pro...",
    });
  });

  it("keeps the runtime-specific running message when progress evidence arrives out of order", () => {
    let items = mergeWakeProgressItems({
      currentItems: [],
      incomingItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-1",
          phase: "running",
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 100,
        }),
      ],
    });

    items = mergeWakeProgressItems({
      currentItems: items,
      incomingItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-1",
          phase: "running",
          runtimeDeviceDisplayName: "Felix's MacBook Pro",
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 90,
        }),
      ],
    });

    expect(items[0]).toMatchObject({
      phase: "running",
      message: "@Codex is working on Felix's MacBook Pro...",
    });

    items = mergeWakeProgressItems({
      currentItems: items,
      incomingItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-1",
          phase: "running",
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 110,
        }),
      ],
    });

    expect(items[0]).toMatchObject({
      phase: "running",
      message: "@Codex is working on Felix's MacBook Pro...",
    });
  });

  it("projects terminal failures with public product copy from error codes", () => {
    const items = applyWakeProgressSignals({
      currentItems: [],
      signals: [
        createTextSignal({
          id: "sig-failed",
          ts: 100,
          text: "internal failure text ignored",
          meta: {
            dispatchId: "dispatch-1",
            errorCode: "daemon.profile.offline",
            purpose: DISPATCH_ACTIVITY_FAILED_PURPOSE,
            sourceClientMessageId: "client-message-1",
            sourceEventId: "sig-source-1",
            targetMentionLabel: "Codex",
            targetProfileId: TARGET_PROFILE_ID,
            transient: true,
          },
        }),
      ],
    });

    expect(items[0]).toMatchObject({
      failureReasonCode: "daemon.profile.offline",
      phase: "failed",
      message: "@Codex is offline on this computer.",
      terminal: true,
    });
  });

  it("turns a terminal failure system notice into failed Wake progress", () => {
    const items = applyWakeProgressSignals({
      currentItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-1",
          phase: "retrying",
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 100,
        }),
      ],
      signals: [
        createSystemNoticeSignal({
          id: "sig-terminal-failure",
          ts: 150,
          data: {
            actorName: "Codex",
            actorProfileId: TARGET_PROFILE_ID,
            dispatchId: "dispatch-1",
            generatedBy: "openmeld",
            noticeType: "terminal_failure",
            reason: "daemon.profile.offline",
            resultRef: "pre-execution-handoff-failure:dispatch-1",
            text: "Codex is offline on this computer. Wake the agent again after OpenMeld Service is running.",
          },
        }),
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      dispatchId: "dispatch-1",
      failureReasonCode: "daemon.profile.offline",
      phase: "failed",
      message: "@Codex is offline on this computer.",
      terminal: true,
    });
    expect(items[0]?.message).not.toContain("Still trying");
  });

  it("turns a Wake stopped system notice into stopped progress without failure state", () => {
    const items = applyWakeProgressSignals({
      currentItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-1",
          phase: "running",
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 100,
        }),
      ],
      signals: [
        createSystemNoticeSignal({
          id: "sig-wake-stopped",
          ts: 150,
          data: {
            actorName: "Codex",
            actorProfileId: TARGET_PROFILE_ID,
            dispatchId: "dispatch-1",
            generatedBy: "openmeld",
            noticeType: "wake_stopped",
            reason: "runtime_coordinator.wake_stop_local_control_accepted",
            resultRef: "wake-stop:dispatch-1",
            text: "Wake was stopped for @Codex.",
          },
        }),
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      dispatchId: "dispatch-1",
      failureReasonCode: null,
      phase: "stopped",
      message: "Wake was stopped for @Codex.",
      terminal: true,
    });
  });

  it("keeps stopped Wake progress briefly, then expires it like a terminal detail", () => {
    const stoppedItem = createWakeProgressItem({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-1",
      phase: "stopped",
      sourceSignalId: "sig-source-1",
      targetLabel: "Codex",
      targetProfileId: TARGET_PROFILE_ID,
      updatedAtMs: 100,
    });

    expect(
      applyWakeProgressSignals({
        currentItems: [stoppedItem],
        signals: [],
        nowMs: 180_000,
      })
    ).toHaveLength(1);

    expect(
      applyWakeProgressSignals({
        currentItems: [stoppedItem],
        signals: [],
        nowMs: 181_000,
      })
    ).toEqual([]);
  });

  it("explains missing Binding truth as setup needed in Wake progress", () => {
    const items = applyWakeProgressSignals({
      currentItems: [],
      signals: [
        createTextSignal({
          id: "sig-failed",
          ts: 100,
          text: "internal failure text ignored",
          meta: {
            dispatchId: "dispatch-1",
            errorCode: "claim_eligibility.binding_missing",
            purpose: DISPATCH_ACTIVITY_FAILED_PURPOSE,
            sourceClientMessageId: "client-message-1",
            sourceEventId: "sig-source-1",
            targetMentionLabel: "Codex",
            targetProfileId: TARGET_PROFILE_ID,
            transient: true,
          },
        }),
      ],
    });

    expect(items[0]).toMatchObject({
      failureReasonCode: "claim_eligibility.binding_missing",
      phase: "failed",
      message: "No local agent has been selected to reply for this agent yet.",
      terminal: true,
    });
  });

  it("keeps an unknown publication outcome visible until its terminal detail expires", () => {
    const publicationUnknownItem = createWakeProgressItem({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-1",
      phase: "publication_unknown",
      sourceSignalId: "sig-source-1",
      targetLabel: "Codex",
      targetProfileId: TARGET_PROFILE_ID,
      updatedAtMs: 100,
    });

    expect(
      applyWakeProgressSignals({
        currentItems: [publicationUnknownItem],
        signals: [],
        nowMs: 180_000,
      })
    ).toHaveLength(1);

    expect(
      applyWakeProgressSignals({
        currentItems: [publicationUnknownItem],
        signals: [],
        nowMs: 181_000,
      })
    ).toEqual([]);
  });

  it("explains stale Binding runtime truth in Wake progress", () => {
    const items = applyWakeProgressSignals({
      currentItems: [],
      signals: [
        createTextSignal({
          id: "sig-failed",
          ts: 100,
          text: "internal failure text ignored",
          meta: {
            dispatchId: "dispatch-1",
            errorCode: "claim_eligibility.binding_runtime_mismatch",
            purpose: DISPATCH_ACTIVITY_FAILED_PURPOSE,
            sourceClientMessageId: "client-message-1",
            sourceEventId: "sig-source-1",
            targetMentionLabel: "Codex",
            targetProfileId: TARGET_PROFILE_ID,
            transient: true,
          },
        }),
      ],
    });

    expect(items[0]).toMatchObject({
      phase: "failed",
      message:
        "This agent is connected to an older computer setup. Update setup on this computer, then try again.",
      terminal: true,
    });
  });

  it("explains Binding owner mismatch in Wake progress", () => {
    const items = applyWakeProgressSignals({
      currentItems: [],
      signals: [
        createTextSignal({
          id: "sig-failed",
          ts: 100,
          text: "internal failure text ignored",
          meta: {
            dispatchId: "dispatch-1",
            errorCode: "claim_eligibility.binding_owner_mismatch",
            purpose: DISPATCH_ACTIVITY_FAILED_PURPOSE,
            sourceClientMessageId: "client-message-1",
            sourceEventId: "sig-source-1",
            targetMentionLabel: "Codex",
            targetProfileId: TARGET_PROFILE_ID,
            transient: true,
          },
        }),
      ],
    });

    expect(items[0]).toMatchObject({
      phase: "failed",
      message:
        "This agent is connected to a different OpenMeld account. Sign in with the correct OpenMeld account, then run setup again.",
      terminal: true,
    });
  });

  it("explains RuntimeCoordinator delivery expiry without generic agent failure copy", () => {
    const items = applyWakeProgressSignals({
      currentItems: [],
      signals: [
        createTextSignal({
          id: "sig-failed",
          ts: 100,
          text: "internal failure text ignored",
          meta: {
            dispatchId: "dispatch-1",
            errorCode: "runtime_coordinator.delivery_expired",
            purpose: DISPATCH_ACTIVITY_FAILED_PURPOSE,
            sourceClientMessageId: "client-message-1",
            sourceEventId: "sig-source-1",
            targetMentionLabel: "Codex",
            targetProfileId: TARGET_PROFILE_ID,
            transient: true,
          },
        }),
      ],
    });

    expect(items[0]).toMatchObject({
      failureReasonCode: "runtime_coordinator.delivery_expired",
      message:
        "This Wake expired before it reached this agent. Start or reconnect OpenMeld Service, then wake the agent again.",
      phase: "failed",
      terminal: true,
    });
    expect(items[0]?.message).not.toContain("couldn't reply");
  });

  it.each([
    [
      "daemon.delivery.start_timeout",
      "OpenMeld could not start this agent in time. Start or reconnect OpenMeld Service, then wake the agent again.",
    ],
    [
      "daemon.delivery.timeout",
      "This agent took too long to finish this Wake. Reconnect OpenMeld Service before trying again.",
    ],
    [
      "timed_out_no_output",
      "This agent took too long to finish this Wake. Reconnect OpenMeld Service before trying again.",
    ],
    [
      "timed_out_after_output",
      "This agent took too long to finish this Wake. Reconnect OpenMeld Service before trying again.",
    ],
    [
      "timeout",
      "This agent took too long to finish this Wake. Reconnect OpenMeld Service before trying again.",
    ],
    [
      "daemon.delivery.execution_stalled",
      "This agent stopped making progress on this Wake. Reconnect OpenMeld Service before trying again.",
    ],
    [
      "daemon.delivery.finalization_timeout",
      "OpenMeld received progress from this agent, but could not finish the final result in time.",
    ],
  ])("explains timeout failure reason code %s in Wake progress", (code, message) => {
    const items = applyWakeProgressSignals({
      currentItems: [],
      signals: [
        createTextSignal({
          id: "sig-failed",
          ts: 100,
          text: "internal failure text ignored",
          meta: {
            dispatchId: "dispatch-1",
            errorCode: code,
            purpose: DISPATCH_ACTIVITY_FAILED_PURPOSE,
            sourceClientMessageId: "client-message-1",
            sourceEventId: "sig-source-1",
            targetMentionLabel: "Codex",
            targetProfileId: TARGET_PROFILE_ID,
            transient: true,
          },
        }),
      ],
    });

    expect(items[0]).toMatchObject({
      failureReasonCode: code,
      message,
      phase: "failed",
      terminal: true,
    });
    expect(items[0]?.message).not.toContain("couldn't reply");
    expect(items[0]?.message).not.toContain("took too long to reply");
  });

  it.each([
    [
      "claim_eligibility.owner_mismatch",
      "This agent is connected to a different OpenMeld account. Sign in with the correct OpenMeld account, then run setup again.",
    ],
    [
      "dispatch.claim_eligibility.binding.owner_mismatch",
      "This agent is connected to a different OpenMeld account. Sign in with the correct OpenMeld account, then run setup again.",
    ],
    [
      "claim_eligibility.openmeld_service_runtime_id_mismatch",
      "This agent is connected to an older computer setup. Update setup on this computer, then try again.",
    ],
    [
      "claim_eligibility.runtime_conflict",
      "This agent has a conflicting reply connection. Wait a moment, then run setup again if the issue continues.",
    ],
    [
      "dispatch.claim_eligibility.binding.conflict",
      "This agent has a conflicting reply connection. Wait a moment, then run setup again if the issue continues.",
    ],
  ])("explains Core claim reason code %s in Wake progress", (code, message) => {
    const items = applyWakeProgressSignals({
      currentItems: [],
      signals: [
        createTextSignal({
          id: `sig-failed-${code}`,
          ts: 100,
          text: "internal failure text ignored",
          meta: {
            dispatchId: "dispatch-1",
            errorCode: code,
            purpose: DISPATCH_ACTIVITY_FAILED_PURPOSE,
            sourceClientMessageId: "client-message-1",
            sourceEventId: "sig-source-1",
            targetMentionLabel: "Codex",
            targetProfileId: TARGET_PROFILE_ID,
            transient: true,
          },
        }),
      ],
    });

    expect(items[0]).toMatchObject({
      phase: "failed",
      message,
      terminal: true,
    });
  });

  it("uses the shared public failure reason mapping in Wake progress", () => {
    const items = applyWakeProgressSignals({
      currentItems: [],
      signals: [
        createTextSignal({
          id: "sig-failed-workspace-missing",
          ts: 100,
          text: "internal failure text ignored",
          meta: {
            dispatchId: "dispatch-1",
            errorCode: "profile.workspace.missing",
            purpose: DISPATCH_ACTIVITY_FAILED_PURPOSE,
            sourceClientMessageId: "client-message-1",
            sourceEventId: "sig-source-1",
            targetMentionLabel: "Codex",
            targetProfileId: TARGET_PROFILE_ID,
            transient: true,
          },
        }),
      ],
    });

    expect(items[0]).toMatchObject({
      phase: "failed",
      message:
        "This agent is missing its local workspace on this device. Run `openmeld doctor --repair`, then `openmeld setup --profile <agent-profile-id>`, and try again.",
      terminal: true,
    });
  });

  it("removes terminal failures after a short visible window", () => {
    const items = applyWakeProgressSignals({
      currentItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-1",
          phase: "failed",
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 100,
        }),
      ],
      nowMs: 181_000,
      signals: [],
    });

    expect(items).toEqual([]);
  });

  it("does not recreate expired terminal failures from old history signals", () => {
    const items = applyWakeProgressSignals({
      currentItems: [],
      nowMs: 181_000,
      signals: [
        createTextSignal({
          id: "sig-failed",
          ts: 100,
          text: "internal failure text ignored",
          meta: {
            dispatchId: "dispatch-1",
            errorCode: "daemon.profile.offline",
            purpose: DISPATCH_ACTIVITY_FAILED_PURPOSE,
            sourceClientMessageId: "client-message-1",
            sourceEventId: "sig-source-1",
            targetMentionLabel: "Codex",
            targetProfileId: TARGET_PROFILE_ID,
            transient: true,
          },
        }),
      ],
    });

    expect(items).toEqual([]);
  });

  it.each([
    ["request_sent", 480_000],
    ["queued", 480_000],
    ["connecting", 480_000],
    ["retrying", 480_000],
    ["running", 1_800_000],
    ["writing", 1_800_000],
    ["publishing", 1_800_000],
  ] as const)("keeps stale %s progress nonterminal until Core reports an outcome", (phase, expiryMs) => {
    const items = applyWakeProgressSignals({
      currentItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-1",
          phase,
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 100,
        }),
      ],
      nowMs: 101 + expiryMs,
      signals: [],
    });

    expect(items).toEqual([
      expect.objectContaining({
        clientMessageId: "client-message-1",
        phase,
        terminal: false,
        updatedAtMs: 100,
      }),
    ]);
  });

  it("keeps active progress at the 30-minute expiry boundary", () => {
    const items = applyWakeProgressSignals({
      currentItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: "dispatch-1",
          phase: "running",
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 100,
        }),
      ],
      nowMs: 1_800_100,
      signals: [],
    });

    expect(items).toEqual([
      expect.objectContaining({
        clientMessageId: "client-message-1",
        phase: "running",
      }),
    ]);
  });

  it("keeps an unexpired human interaction visible beyond the active progress window", () => {
    const item = createWakeProgressItem({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-1",
      phase: "running",
      sourceSignalId: "sig-source-1",
      targetLabel: "Codex",
      targetProfileId: TARGET_PROFILE_ID,
      updatedAtMs: 100,
    });
    const items = applyWakeProgressSignals({
      currentItems: [
        {
          ...item,
          pendingInteraction: {
            canRespond: true,
            expiresAtMs: 28_800_100,
            interactionId: "interaction-1",
            kind: "permission",
            requestedAtMs: 100,
            request: {
              description: "Codex needs to run this command.",
              expiresAtMs: 28_800_100,
              interactionId: "interaction-1",
              kind: "permission",
              options: [
                {
                  intent: "allow_once",
                  label: "Allow once",
                  optionId: "allow-once",
                },
                {
                  intent: "deny",
                  label: "Deny",
                  optionId: "deny",
                },
              ],
              requestedAtMs: 100,
              subject: {
                command: "pnpm test",
                cwd: "/workspace",
                type: "command",
              },
              title: "Allow this command?",
              v: 1,
            },
          },
        },
      ],
      nowMs: 1_800_101,
      signals: [],
    });

    expect(items).toEqual([
      expect.objectContaining({
        pendingInteraction: expect.objectContaining({
          interactionId: "interaction-1",
        }),
        phase: "running",
        terminal: false,
      }),
    ]);
  });

  it("still expires stale local optimistic sending progress", () => {
    const items = applyWakeProgressSignals({
      currentItems: [
        createWakeProgressItem({
          clientMessageId: "client-message-1",
          dispatchId: null,
          phase: "sending",
          sourceSignalId: "sig-source-1",
          targetLabel: "Codex",
          targetProfileId: TARGET_PROFILE_ID,
          updatedAtMs: 100,
        }),
      ],
      nowMs: 181_000,
      signals: [],
    });

    expect(items).toEqual([]);
  });

  it("treats Wake source messages as recoverable progress candidates regardless of age", () => {
    expect(
      isWakeProgressSourceSignalRecoverable({
        nowMs: 600_000,
        sourceUpdatedAtMs: 0,
      })
    ).toBe(true);
    expect(
      isWakeProgressSourceSignalRecoverable({
        nowMs: 600_001,
        sourceUpdatedAtMs: 0,
      })
    ).toBe(true);
  });

  it("does not show the stale optimistic replying copy", () => {
    const item = createWakeProgressItem({
      clientMessageId: "client-message-1",
      dispatchId: null,
      phase: "request_sent",
      sourceSignalId: "sig-source-1",
      targetLabel: "Codex",
      targetProfileId: TARGET_PROFILE_ID,
      updatedAtMs: 20,
    });

    expect(item.message).toBe("Wake request sent to @Codex.");
    expect(item.message).not.toContain("is replying");
  });
});

function createTextSignal(input: {
  id: string;
  meta?: {
    dispatchId?: string;
    errorCode?: string;
    purpose?: string;
    runtimeDeviceDisplayName?: string;
    sourceClientMessageId?: string;
    sourceEventId?: string;
    targetMentionLabel?: string;
    targetProfileId?: string;
    transient?: true;
  };
  replyTo?: Extract<SignalEnvelope, { type: "signal.text" }>["data"]["replyTo"];
  text: string;
  ts: number;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: "space-123",
    ts: input.ts,
    profile: {
      kind: "system",
      profileId: "openmeld-system",
      profileName: "OpenMeld System",
    },
    type: "signal.text",
    data: {
      text: input.text,
      ...(input.meta ? { meta: input.meta } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    },
  };
}

function createSystemNoticeSignal(input: {
  data: TestSystemNoticeData;
  id: string;
  ts: number;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: "space-123",
    ts: input.ts,
    profile: {
      kind: "system",
      profileId: "openmeld-system",
      profileName: "OpenMeld System",
    },
    type: "signal.system_notice",
    data: input.data,
  } as SignalEnvelope;
}

type TestSystemNoticeData = Omit<
  Extract<SignalEnvelope, { type: "signal.system_notice" }>["data"],
  "noticeType"
> & {
  noticeType:
    | Extract<
        SignalEnvelope,
        { type: "signal.system_notice" }
      >["data"]["noticeType"]
    | "wake_stopped";
};
