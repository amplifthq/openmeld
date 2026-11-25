import { describe, expect, it } from "vitest";
import {
  buildSpaceTaskMutationBody,
  parseSpaceTaskPhaseOption,
  parseSpaceTaskRevisionOption,
} from "../src/space/tasks-command";

describe("Space Tasks CLI input", () => {
  it("accepts the phase as people type it", () => {
    expect(parseSpaceTaskPhaseOption(undefined)).toBeUndefined();
    expect(parseSpaceTaskPhaseOption("in_review")).toBe("in_review");
    expect(parseSpaceTaskPhaseOption("In-Progress")).toBe("in_progress");
    expect(parseSpaceTaskPhaseOption("to do")).toBe("to_do");
  });

  it("rejects an unknown phase and names the valid ones", () => {
    expect(() => parseSpaceTaskPhaseOption("blocked")).toThrow(
      "to_do, in_progress, in_review, done, canceled"
    );
  });

  it("rejects a revision that is not a positive whole number", () => {
    expect(
      parseSpaceTaskRevisionOption(undefined, "--revision")
    ).toBeUndefined();
    expect(parseSpaceTaskRevisionOption("4", "--revision")).toBe(4);
    for (const value of ["0", "-1", "1.5", "abc"]) {
      expect(() => parseSpaceTaskRevisionOption(value, "--revision")).toThrow(
        "--revision must be a positive whole number."
      );
    }
  });

  it("maps each CLI change to the canonical Task mutation", () => {
    const base = { expectedRevision: 5, operationId: "op-1" };

    expect(
      buildSpaceTaskMutationBody({ ...base, change: { action: "start" } })
    ).toEqual({ ...base, action: "mark_in_progress" });
    expect(
      buildSpaceTaskMutationBody({
        ...base,
        change: { action: "submit", summary: " Shipped. " },
      })
    ).toEqual({ ...base, action: "submit_result", summary: "Shipped." });
    expect(
      buildSpaceTaskMutationBody({
        ...base,
        change: { action: "cancel", reason: "Superseded" },
      })
    ).toEqual({ ...base, action: "cancel", reason: "Superseded" });
    expect(
      buildSpaceTaskMutationBody({
        ...base,
        change: { action: "reopen", reason: "Regression" },
      })
    ).toEqual({ ...base, action: "reopen", reason: "Regression" });
  });

  it("binds a review to the result revision the reviewer read", () => {
    expect(
      buildSpaceTaskMutationBody({
        expectedRevision: 5,
        operationId: "op-1",
        change: {
          action: "review",
          expectedRevision: 5,
          expectedResultRevision: 2,
          decision: "accepted",
        },
      })
    ).toEqual({
      action: "review",
      decision: "accepted",
      expectedResultRevision: 2,
      expectedRevision: 5,
      operationId: "op-1",
    });
  });

  it("refuses a change request without feedback", () => {
    expect(() =>
      buildSpaceTaskMutationBody({
        expectedRevision: 5,
        operationId: "op-1",
        change: {
          action: "review",
          expectedRevision: 5,
          expectedResultRevision: 2,
          decision: "changes_requested",
          feedback: "  ",
        },
      })
    ).toThrow("Requesting changes needs --feedback.");
  });

  it("refuses an empty result summary", () => {
    expect(() =>
      buildSpaceTaskMutationBody({
        expectedRevision: 5,
        operationId: "op-1",
        change: { action: "submit", summary: "   " },
      })
    ).toThrow();
  });
});
