import {
  AGENT_REPLY_FINAL_PURPOSE,
  AGENT_REPLYING_PURPOSE,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  applyWakeProgressSignals,
  createWakeProgressItem,
} from "../../../packages/space/src/wake-progress/wake-progress-projection.ts";

const targetProfileId = "agt_33333333-3333-4333-8333-333333333333";

const running = createWakeProgressItem({
  clientMessageId: "client-message-1",
  dispatchId: "dispatch-1",
  phase: "running",
  sourceSignalId: "sig-source-1",
  targetLabel: "Codex",
  targetProfileId,
  updatedAtMs: 100,
});

const notice = (
  noticeType: "terminal_failure" | "wake_stopped",
  ts: number
) => ({
  v: 1 as const,
  id: `sig-${noticeType}-${String(ts)}`,
  spaceId: "space-123",
  ts,
  profile: {
    kind: "system" as const,
    profileId: "openmeld-system",
    profileName: "OpenMeld System",
  },
  type: "signal.system_notice" as const,
  data: {
    actorName: "Codex",
    actorProfileId: targetProfileId,
    dispatchId: "dispatch-1",
    generatedBy: "openmeld" as const,
    noticeType,
    reason:
      noticeType === "wake_stopped"
        ? "runtime_coordinator.wake_stop_local_control_accepted"
        : "daemon.profile.offline",
    resultRef: `${noticeType}:dispatch-1`,
    text: "notice",
  },
});

const reply = {
  v: 1 as const,
  id: "final",
  spaceId: "space-123",
  ts: 300,
  profile: {
    kind: "system" as const,
    profileId: "openmeld-system",
    profileName: "OpenMeld System",
  },
  type: "signal.text" as const,
  data: {
    text: "Done",
    meta: {
      purpose: AGENT_REPLY_FINAL_PURPOSE,
      dispatchId: "dispatch-1",
      targetProfileId,
    },
  },
};

const nowMs = 1000;

const stopBanner = () =>
  applyWakeProgressSignals({
    currentItems: [running],
    nowMs,
    signals: [notice("wake_stopped", 200)],
  });

describe("wake progress banner", () => {
  it("does not reopen a stopped banner with a later working update", () => {
    const stopped = stopBanner();
    expect(stopped.map((item) => item.phase)).toEqual(["stopped"]);
    const reopened = applyWakeProgressSignals({
      currentItems: stopped,
      nowMs,
      signals: [
        {
          ...reply,
          id: "still-working",
          ts: 400,
          data: {
            text: "working",
            meta: {
              purpose: AGENT_REPLYING_PURPOSE,
              dispatchId: "dispatch-1",
              sourceEventId: "sig-source-1",
              targetMentionLabel: "Codex",
              targetProfileId,
              transient: true as const,
            },
          },
        },
      ],
    });
    expect(reopened.map((item) => item.phase)).toEqual(["stopped"]);
  });

  it("replaces a stop banner when a failure notice is applied afterwards", () => {
    const stopped = stopBanner();
    expect(stopped.map((item) => item.phase)).toEqual(["stopped"]);
    const replaced = applyWakeProgressSignals({
      currentItems: stopped,
      nowMs,
      signals: [notice("terminal_failure", 150)],
    });
    expect(replaced.map((item) => item.phase)).toEqual(["failed"]);
  });

  it("clears a stop banner when a final reply arrives", () => {
    const stopped = stopBanner();
    expect(stopped.map((item) => item.phase)).toEqual(["stopped"]);
    const cleared = applyWakeProgressSignals({
      currentItems: stopped,
      nowMs,
      signals: [reply],
    });
    expect(cleared).toEqual([]);
  });
});
