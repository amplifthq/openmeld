import { describe, expect, it } from "vitest";
import {
  buildAgentControllerRef,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_CONTROLLER_REF_ID,
  hasRuntimeAdapterCapabilityForRef,
  parseAgentControllerRef,
  resolveAgentControllerRefFromAgentTarget,
  runtimeAgentControllerRefMatchesAdapterSnapshot,
} from "../src";

describe("agent-runtime Agent Controller refs", () => {
  it("builds first-version refs for builtin and custom targets", () => {
    expect(buildAgentControllerRef({ kind: "builtin", id: " codex " })).toBe(
      "builtin:codex"
    );
    expect(
      buildAgentControllerRef({ kind: "custom", id: " custom-target-001 " })
    ).toBe("custom:custom-target-001");
    expect(
      buildAgentControllerRef({
        kind: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        id: HOSTED_CENTER_AGENT_CONTROLLER_REF_ID,
      })
    ).toBe(HOSTED_CENTER_AGENT_CONTROLLER_REF);
  });

  it("maps local agent targets to Agent Controller refs without inventing a second catalog", () => {
    expect(
      resolveAgentControllerRefFromAgentTarget({
        targetKind: "builtin",
        agentId: "claude-code",
      })
    ).toBe("builtin:claude-code");
    expect(
      resolveAgentControllerRefFromAgentTarget({
        targetKind: "custom",
        agentId: "custom_0123456789ab",
      })
    ).toBe("custom:custom_0123456789ab");
  });

  it("parses only the supported first-version namespaces", () => {
    expect(parseAgentControllerRef("builtin:codex")).toEqual({
      kind: "builtin",
      id: "codex",
      ref: "builtin:codex",
    });
    expect(parseAgentControllerRef("custom:custom-target-001")).toEqual({
      kind: "custom",
      id: "custom-target-001",
      ref: "custom:custom-target-001",
    });
    expect(parseAgentControllerRef(HOSTED_CENTER_AGENT_CONTROLLER_REF)).toEqual(
      {
        kind: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        id: HOSTED_CENTER_AGENT_CONTROLLER_REF_ID,
        ref: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      }
    );
    expect(parseAgentControllerRef("provider:future")).toBeNull();
    expect(parseAgentControllerRef("builtin:")).toBeNull();
    expect(parseAgentControllerRef("hosted:other-agent")).toBeNull();
  });

  it("fails fast for malformed capability source ids", () => {
    expect(() =>
      buildAgentControllerRef({ kind: "builtin", id: "codex dev" })
    ).toThrow("runtime.agent_controller_ref_invalid");
    expect(() =>
      buildAgentControllerRef({ kind: "custom", id: "provider:future" })
    ).toThrow("runtime.agent_controller_ref_invalid");
    expect(() =>
      buildAgentControllerRef({
        kind: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        id: "other-agent",
      })
    ).toThrow("runtime.agent_controller_ref_invalid");
  });

  it("matches live runtime adapter snapshots through the shared Agent Controller ref rule", () => {
    expect(
      runtimeAgentControllerRefMatchesAdapterSnapshot({
        adapter: { adapterId: "codex" },
        agentControllerRef: "builtin:codex",
      })
    ).toBe(true);
    expect(
      hasRuntimeAdapterCapabilityForRef({
        agentControllerRef: "custom:target-1",
        runtimeAdapters: [{ adapterId: "codex" }, { adapterId: "target-1" }],
      })
    ).toBe(true);
    expect(
      hasRuntimeAdapterCapabilityForRef({
        agentControllerRef: "provider:future",
        runtimeAdapters: [{ adapterId: "future" }],
      })
    ).toBe(false);
    expect(
      runtimeAgentControllerRefMatchesAdapterSnapshot({
        adapter: { adapterId: HOSTED_CENTER_AGENT_CONTROLLER_REF_ID },
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      })
    ).toBe(false);
    expect(
      hasRuntimeAdapterCapabilityForRef({
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        runtimeAdapters: [{ adapterId: HOSTED_CENTER_AGENT_CONTROLLER_REF_ID }],
      })
    ).toBe(false);
  });
});
