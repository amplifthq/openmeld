import { describe, expect, it } from "vitest";
import {
  hasRuntimeCoordinatorLocalProgressStaleTerminalExpired,
  hasRuntimeCoordinatorProgressAdvancedSinceLastWatchdogCheck,
  type RuntimeCoordinatorRunCommandState,
  resolveRuntimeCoordinatorRunCommandStateWatchdogAtMs,
} from "../runtime-transport/application/runtime-coordinator-authority";

const buildCommandState = (
  pendingInteraction: RuntimeCoordinatorRunCommandState["pendingInteraction"]
): RuntimeCoordinatorRunCommandState =>
  ({
    createdAtMs: 1000,
    lastWatchdogCheckAtMs: 2000,
    localProgress: {
      acceptedLocalAtMs: 1100,
      completedLocalAtMs: null,
      lastLifecycleAtMs: 1200,
      phase: "running",
      resultReceivedAtMs: null,
      runningAtMs: 1200,
    },
    pendingInteraction,
    updatedAtMs: 1200,
  }) as RuntimeCoordinatorRunCommandState;

describe("RuntimeCoordinator local agent interaction waiting", () => {
  it("pauses stale-progress handling until an unresolved interaction expires", () => {
    const commandState = buildCommandState({
      request: {
        description: "Codex needs permission before running this command.",
        expiresAtMs: 10_000,
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
        requestedAtMs: 2000,
        subject: {
          command: "git status",
          type: "command",
        },
        title: "Allow this command?",
        v: 1,
      },
      respondedAtMs: null,
      response: null,
    });

    expect(
      resolveRuntimeCoordinatorRunCommandStateWatchdogAtMs(commandState)
    ).toBe(10_000);
    expect(
      hasRuntimeCoordinatorProgressAdvancedSinceLastWatchdogCheck(commandState)
    ).toBe(true);
    expect(
      hasRuntimeCoordinatorLocalProgressStaleTerminalExpired({
        commandState,
        nowMs: 100_000,
      })
    ).toBe(false);
  });

  it("bounds response delivery while preserving a fresh progress baseline", () => {
    const commandState = buildCommandState({
      request: {
        expiresAtMs: 10_000,
        interactionId: "interaction-1",
        kind: "plan_review",
        plan: "1. Inspect the code. 2. Apply the change.",
        requestedAtMs: 2000,
        title: "Review the plan",
        v: 1,
        allowFeedback: true,
      },
      respondedAtMs: 3000,
      response: {
        action: "approve",
        kind: "plan_review",
      },
    });

    expect(
      resolveRuntimeCoordinatorRunCommandStateWatchdogAtMs(commandState)
    ).toBe(33_000);
    expect(
      hasRuntimeCoordinatorLocalProgressStaleTerminalExpired({
        commandState,
        nowMs: 100_000,
      })
    ).toBe(false);
    expect(
      hasRuntimeCoordinatorLocalProgressStaleTerminalExpired({
        commandState,
        nowMs: 303_000,
      })
    ).toBe(true);
  });
});
