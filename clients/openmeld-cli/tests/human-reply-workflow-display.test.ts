import type { SpaceReplyWorkflowProjection } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import {
  buildHumanReplyWorkflowSignalSummary,
  buildHumanReplyWorkflowSummary,
  buildHumanReplyWorkflowSurfaceNote,
} from "../src/space/read-projection/human-reply-workflow-display";

function createProjection(
  overrides: Partial<SpaceReplyWorkflowProjection> = {}
): SpaceReplyWorkflowProjection {
  const hasOwn = <K extends keyof SpaceReplyWorkflowProjection>(key: K) =>
    Object.hasOwn(overrides, key);

  return {
    sourceSignalId: overrides.sourceSignalId ?? "sig-anchor",
    replyToSignalId: hasOwn("replyToSignalId")
      ? (overrides.replyToSignalId ?? null)
      : "sig-anchor",
    publicOutcome: hasOwn("publicOutcome")
      ? (overrides.publicOutcome ?? null)
      : "post_message",
    publishedSignalId: hasOwn("publishedSignalId")
      ? (overrides.publishedSignalId ?? null)
      : "sig-published",
    publishedSignalType: hasOwn("publishedSignalType")
      ? (overrides.publishedSignalType ?? null)
      : "signal.text",
    hasPublicSignal: overrides.hasPublicSignal ?? true,
    hasPublicAgentReplyText: overrides.hasPublicAgentReplyText ?? true,
    dispatchExecution: hasOwn("dispatchExecution")
      ? (overrides.dispatchExecution ?? null)
      : ({
          sourceSignalId: "sig-anchor",
          targetDispatches: [
            {
              dispatchId: "dispatch-1",
              dispatchStatus: "succeeded",
              latestAttemptStatus: "succeeded",
              reasonCode: null,
              reasonText: null,
              status: "dispatch_recorded",
              targetDisplayName: "Target Agent",
              targetProfileId: "agt_target",
            },
          ],
        } satisfies NonNullable<
          SpaceReplyWorkflowProjection["dispatchExecution"]
        >),
    replyToContext: hasOwn("replyToContext")
      ? (overrides.replyToContext ?? null)
      : null,
  };
}

describe("human reply workflow display", () => {
  it("renders stable human workflow summaries across public outcomes", () => {
    expect(
      buildHumanReplyWorkflowSummary(
        createProjection({ publicOutcome: "post_message" })
      )
    ).toBe("A public reply message was written back.");
    expect(
      buildHumanReplyWorkflowSummary(
        createProjection({ publicOutcome: "post_status" })
      )
    ).toBe("A public status update was written back.");
    expect(
      buildHumanReplyWorkflowSummary(
        createProjection({ publicOutcome: "stay_silent" })
      )
    ).toBe("A public stay-silent system notice was written back.");
    expect(
      buildHumanReplyWorkflowSummary(
        createProjection({ publicOutcome: "system_notice" })
      )
    ).toBe("A public system notice was written back.");
    expect(
      buildHumanReplyWorkflowSummary(
        createProjection({ publicOutcome: "internal_only" })
      )
    ).toBe("No public signal was written back.");
  });

  it("renders no-public-signal fallback summaries from execution status", () => {
    expect(
      buildHumanReplyWorkflowSummary(
        createProjection({
          publicOutcome: null,
          hasPublicSignal: false,
          publishedSignalId: null,
          dispatchExecution: null,
        })
      )
    ).toBe("No public signal is visible yet.");
    expect(
      buildHumanReplyWorkflowSummary(
        createProjection({
          publicOutcome: null,
          hasPublicSignal: false,
          publishedSignalId: null,
          dispatchExecution: {
            sourceSignalId: "sig-anchor",
            targetDispatches: [
              {
                dispatchId: "dispatch-1",
                dispatchStatus: "queued",
                latestAttemptStatus: null,
                reasonCode: null,
                reasonText: null,
                status: "dispatch_recorded",
                targetDisplayName: "Target Agent",
                targetProfileId: "agt_target",
              },
            ],
          },
        })
      )
    ).toBe(
      "Dispatch history was recorded, but current execution state is unknown and no public signal is visible yet."
    );
    expect(
      buildHumanReplyWorkflowSummary(
        createProjection({
          publicOutcome: null,
          hasPublicSignal: false,
          publishedSignalId: null,
          dispatchExecution: {
            sourceSignalId: "sig-anchor",
            targetDispatches: [
              {
                dispatchId: "dispatch-1",
                dispatchStatus: "blocked",
                latestAttemptStatus: "blocked",
                reasonCode: "route.not_registered",
                reasonText: "blocked",
                status: "blocked",
                targetDisplayName: "Target Agent",
                targetProfileId: "agt_target",
              },
            ],
          },
        })
      )
    ).toBe("No public signal was written back because dispatch was blocked.");
    expect(
      buildHumanReplyWorkflowSummary(
        createProjection({
          publicOutcome: null,
          hasPublicSignal: false,
          publishedSignalId: null,
          dispatchExecution: {
            sourceSignalId: "sig-anchor",
            targetDispatches: [
              {
                dispatchId: "dispatch-1",
                dispatchStatus: "failed_terminal",
                latestAttemptStatus: "failed_terminal",
                reasonCode: "controller.binding.missing",
                reasonText: "failed",
                status: "failed",
                targetDisplayName: "Target Agent",
                targetProfileId: "agt_target",
              },
            ],
          },
        })
      )
    ).toBe(
      "No public signal was written back because dispatch failed terminally."
    );
    expect(
      buildHumanReplyWorkflowSummary(
        createProjection({
          publicOutcome: null,
          hasPublicSignal: false,
          publishedSignalId: null,
          dispatchExecution: {
            sourceSignalId: "sig-anchor",
            targetDispatches: [
              {
                dispatchId: "dispatch-1",
                dispatchStatus: "failed_retryable",
                latestAttemptStatus: "failed_retryable",
                reasonCode: "daemon.profile.offline",
                reasonText: "retrying",
                status: "retrying",
                targetDisplayName: "Target Agent",
                targetProfileId: "agt_target",
              },
            ],
          },
        })
      )
    ).toBe(
      "Dispatch has retryable failure evidence, but current execution state is unknown and no public signal is visible yet."
    );
    expect(
      buildHumanReplyWorkflowSummary(
        createProjection({
          publicOutcome: null,
          hasPublicSignal: false,
          publishedSignalId: null,
          dispatchExecution: {
            sourceSignalId: "sig-anchor",
            targetDispatches: [
              {
                dispatchId: "dispatch-1",
                dispatchStatus: "cancelled",
                latestAttemptStatus: "cancelled",
                reasonCode: null,
                reasonText: null,
                status: "stopped",
                targetDisplayName: "Target Agent",
                targetProfileId: "agt_target",
              },
            ],
          },
        })
      )
    ).toBe("No public signal was written back because dispatch was stopped.");
  });

  it("renders published signal summaries and surface notes", () => {
    expect(
      buildHumanReplyWorkflowSignalSummary(
        createProjection({
          publishedSignalId: "sig-status",
          publishedSignalType: "signal.status",
        })
      )
    ).toBe("signal.status · sig-status");
    expect(
      buildHumanReplyWorkflowSignalSummary(
        createProjection({
          hasPublicSignal: false,
          publishedSignalId: null,
        })
      )
    ).toBeNull();
    expect(buildHumanReplyWorkflowSurfaceNote({ surface: "result" })).toBe(
      "`space result` reads archived dispatch results only. Use `openmeld service trace` to inspect Wake execution and the final visible Space outcome."
    );
    expect(buildHumanReplyWorkflowSurfaceNote({ surface: "updates" })).toBe(
      "`space updates` shows formal execution evidence for this message round. Use `openmeld service trace` to inspect Wake execution and the final visible Space outcome."
    );
  });
});
