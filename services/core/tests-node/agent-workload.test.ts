import type { WakeProgressItem } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  combineAgentWorkloads,
  projectSpaceAgentWorkload,
} from "../src/agent-profile/application/agent-workload";

const PRIVATE_DETAILS = /private-dm|Private|Draft|source|dispatch/;

describe("Agent workload read projection", () => {
  const wake: WakeProgressItem = {
    clientMessageId: null,
    sourceSignalId: "source",
    dispatchId: "dispatch",
    targetProfileId: "agt_test",
    targetLabel: "Agent",
    phase: "running",
    message: "Working",
    previewText: "Private task",
    terminal: false,
    updatedAtMs: 1,
  };
  it.each([
    true,
    false,
  ])("keeps Organization counts but gates source details (canRead=%s)", (canReadSource) => {
    const result = projectSpaceAgentWorkload({
      location: { spaceId: "private-dm", spaceName: "Private conversation" },
      canReadSource,
      hasMore: false,
      wakes: [
        wake,
        { ...wake, dispatchId: "next", phase: "queued" },
        { ...wake, dispatchId: "done", terminal: true, phase: "replied" },
      ],
      queuedMessages: [
        { inputId: "a", text: "Draft A", state: "queued", blocked: false },
        { inputId: "b", text: "Draft B", state: "unconfirmed", blocked: false },
      ],
    });
    expect(result).toMatchObject({
      status: "ready",
      activeCount: 1,
      waitingCount: 1,
      queuedMessageCount: 1,
      pausedMessageCount: 1,
    });
    if (result.status !== "ready") {
      throw new Error("Expected workload");
    }
    expect(result.items).toHaveLength(canReadSource ? 4 : 0);
    if (!canReadSource) {
      expect(JSON.stringify(result)).not.toMatch(PRIVATE_DETAILS);
    }
  });
  it("does not claim an exact total from a partial or failed source", () => {
    const complete = projectSpaceAgentWorkload({
      location: { spaceId: "space", spaceName: "Work" },
      canReadSource: true,
      hasMore: false,
      wakes: [wake],
      queuedMessages: [],
    });
    const partial = projectSpaceAgentWorkload({
      location: { spaceId: "space", spaceName: "Work" },
      canReadSource: true,
      hasMore: true,
      wakes: [wake],
      queuedMessages: [],
    });
    expect(combineAgentWorkloads([complete, partial])).toEqual({
      status: "unavailable",
    });
    expect(combineAgentWorkloads([complete, complete])).toMatchObject({
      activeCount: 2,
      queuedMessageCount: 0,
    });
  });
});
