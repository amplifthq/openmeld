import { personalRemoteAgentSpaceToolRequestSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";

describe("personal Remote Agent evidence request", () => {
  it("requires a pinned version when continuing a message", () => {
    const request = {
      submissionId: "accepted-submission",
      operation: {
        kind: "evidence",
        sourceSignalId: "selected-message",
        offset: 4000,
      },
    };
    expect(
      personalRemoteAgentSpaceToolRequestSchema.safeParse(request).success
    ).toBe(false);
    expect(
      personalRemoteAgentSpaceToolRequestSchema.safeParse({
        ...request,
        operation: {
          ...request.operation,
          version: `sha256:${"a".repeat(64)}`,
        },
      }).success
    ).toBe(true);
  });

  it("does not let a request select another Space or unbounded thread page", () => {
    for (const operation of [
      { kind: "evidence", sourceSignalId: "message", spaceId: "another-space" },
      { kind: "thread", threadId: "thread", limit: 31 },
      { kind: "thread", threadId: "thread", limit: 0 },
    ]) {
      expect(
        personalRemoteAgentSpaceToolRequestSchema.safeParse({
          submissionId: "accepted-submission",
          operation,
        }).success
      ).toBe(false);
    }
  });
});
