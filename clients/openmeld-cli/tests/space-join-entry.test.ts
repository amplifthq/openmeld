import { describe, expect, it, vi } from "vitest";
import { resolveSpaceJoinEntryTargetOutcome } from "../src/space/join-entry";

describe("space join entry", () => {
  it("returns cancelled when create-and-join is cancelled inside create flow", async () => {
    const result = await resolveSpaceJoinEntryTargetOutcome({
      resolveTarget: async () => ({
        status: "create",
        value: null,
      }),
      runCreate: vi.fn(async () => "cancelled" as never),
    });

    expect(result).toEqual({ status: "cancelled" });
  });

  it("returns completed when create-and-join completes create routing", async () => {
    const result = await resolveSpaceJoinEntryTargetOutcome({
      resolveTarget: async () => ({
        status: "create",
        value: null,
      }),
      runCreate: vi.fn(async () => "completed" as never),
    });

    expect(result).toEqual({ status: "completed" });
  });
});
