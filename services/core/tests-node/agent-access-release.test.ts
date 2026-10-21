import type { SignalEnvelope } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { buildReleasedAgentAccessSignal } from "../src/space/application/agent-access-release";

const signal = {
  v: 1,
  id: "signal-1",
  ts: 1,
  spaceId: "space-1",
  profile: { kind: "human", profileId: "tali", profileName: "Tali" },
  type: "signal.text",
  data: { text: "Please review" },
} as Extract<SignalEnvelope, { type: "signal.text" }>;

function selectionFor(controllerRef: string | null) {
  const released = buildReleasedAgentAccessSignal({
    controllerRef,
    signal,
    targetProfileId: "agt_felix",
  });
  return released.type === "signal.text"
    ? released.data.contextSelections?.agt_felix
    : undefined;
}

describe("Releasing a message after the owner's consent", () => {
  it("starts a new Session where the harness has Sessions", () => {
    expect(selectionFor("builtin:codex")).toEqual({ mode: "new" });
    expect(selectionFor("builtin:claude-code")).toEqual({ mode: "new" });
  });

  it("runs like a later ordinary message where the harness has none", () => {
    // OpenCode refuses an explicit new Session (R2B-04).
    expect(selectionFor("builtin:opencode")).toBeUndefined();
  });

  it("still asks for a new Session when the harness is unknown", () => {
    expect(selectionFor(null)).toEqual({ mode: "new" });
  });
});
