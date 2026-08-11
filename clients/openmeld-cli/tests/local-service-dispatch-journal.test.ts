import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { daemonDispatchJournalPath } from "../src/config/daemon-state";
import {
  emitDaemonDispatchJournalEvent,
  readRecentDaemonDispatchJournalEvents,
} from "../src/local-service/dispatch/daemon-dispatch-journal";
import { withTempHome } from "./helpers/fs";

describe("local service dispatch journal", () => {
  it("persists dispatch result evidence as local JSONL", async () => {
    await withTempHome(async () => {
      emitDaemonDispatchJournalEvent({
        attemptId: "attempt-1",
        connectionGeneration: 2,
        daemonSessionId: "daemon-session-1",
        dispatchId: "dispatch-1",
        leaseEpoch: 3,
        metadata: {
          spaceActionType: "post_message",
        },
        profileId: "agt_1",
        result: "success",
        taskId: "task-1",
        type: "dispatch.result.sent",
      });

      const raw = await readFile(daemonDispatchJournalPath(), "utf8");
      const [event] = raw
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      expect(event).toMatchObject({
        schema: "openmeld-daemon-dispatch-event-v1",
        v: 1,
        type: "dispatch.result.sent",
        attemptId: "attempt-1",
        connectionGeneration: 2,
        daemonSessionId: "daemon-session-1",
        dispatchId: "dispatch-1",
        leaseEpoch: 3,
        profileId: "agt_1",
        result: "success",
        taskId: "task-1",
        metadata: {
          spaceActionType: "post_message",
        },
      });
      expect(typeof event?.timestamp).toBe("string");
      expect(typeof event?.lane).toBe("string");
      expect(typeof event?.pid).toBe("number");
    });
  });

  it("persists local phase evidence with correlation keys and no prompt payload", async () => {
    await withTempHome(async () => {
      emitDaemonDispatchJournalEvent({
        attemptId: "attempt-1",
        connectionGeneration: 2,
        daemonSessionId: "daemon-session-1",
        dispatchId: "dispatch-1",
        leaseEpoch: 3,
        metadata: {
          agentControllerRef: "builtin:codex",
          phase: "runtime_invocation_started",
          transportMode: "local-cli",
        },
        profileId: "agt_1",
        result: "started",
        taskId: "task-1",
        type: "dispatch.local.phase",
      });

      const raw = await readFile(daemonDispatchJournalPath(), "utf8");
      const [event] = raw
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      expect(event).toMatchObject({
        type: "dispatch.local.phase",
        attemptId: "attempt-1",
        connectionGeneration: 2,
        daemonSessionId: "daemon-session-1",
        dispatchId: "dispatch-1",
        leaseEpoch: 3,
        profileId: "agt_1",
        result: "started",
        taskId: "task-1",
        metadata: {
          agentControllerRef: "builtin:codex",
          phase: "runtime_invocation_started",
          transportMode: "local-cli",
        },
      });
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain("what is the time");
      expect(serialized).not.toContain("rcet_v1_");
      expect(serialized).not.toContain("prompt");
    });
  });

  it("reads recent dispatch-local evidence by dispatch id", async () => {
    await withTempHome(async () => {
      await Promise.resolve();
      emitDaemonDispatchJournalEvent({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        taskId: "task-1",
        type: "dispatch.result.queued",
      });
      emitDaemonDispatchJournalEvent({
        attemptId: "attempt-2",
        dispatchId: "dispatch-2",
        taskId: "task-2",
        type: "dispatch.result.sent",
      });
      emitDaemonDispatchJournalEvent({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        taskId: "task-1",
        type: "dispatch.result.accepted",
      });

      const events = readRecentDaemonDispatchJournalEvents({
        dispatchId: "dispatch-1",
      });

      expect(events.map((event) => event.type)).toEqual([
        "dispatch.result.queued",
        "dispatch.result.accepted",
      ]);
      expect(events.every((event) => event.dispatchId === "dispatch-1")).toBe(
        true
      );
    });
  });
});
