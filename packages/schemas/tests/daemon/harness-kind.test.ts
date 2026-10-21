import { describe, expect, it } from "vitest";
import {
  BUILTIN_AGENT_CONTROLLER_CONVERSATION_CAPABILITY_BY_CONTROLLER_ID,
  BUILTIN_AGENT_CONTROLLER_DISPLAY_ORDER,
  HARNESS_KINDS,
  harnessKindFromAgentControllerRef,
} from "../../src/index";

describe("harnessKindFromAgentControllerRef", () => {
  it("maps every known builtin controller to its own Harness kind", () => {
    for (const controllerId of BUILTIN_AGENT_CONTROLLER_DISPLAY_ORDER) {
      expect(harnessKindFromAgentControllerRef(`builtin:${controllerId}`)).toBe(
        controllerId
      );
    }
    expect(harnessKindFromAgentControllerRef(" builtin:claude-code ")).toBe(
      "claude-code"
    );
  });

  it("maps the hosted Remote Agent controller to the hosted Harness", () => {
    expect(harnessKindFromAgentControllerRef("hosted:remote-agent")).toBe(
      "hosted"
    );
  });

  it("returns null for refs that have no Harness", () => {
    expect(harnessKindFromAgentControllerRef("custom:ops-bot")).toBeNull();
    expect(harnessKindFromAgentControllerRef("hosted:center-agent")).toBeNull();
    expect(harnessKindFromAgentControllerRef("builtin:hosted")).toBeNull();
    expect(harnessKindFromAgentControllerRef("builtin:unknown")).toBeNull();
    expect(harnessKindFromAgentControllerRef("claude-code")).toBeNull();
    expect(harnessKindFromAgentControllerRef("builtin:")).toBeNull();
    expect(harnessKindFromAgentControllerRef("")).toBeNull();
    expect(harnessKindFromAgentControllerRef(null)).toBeNull();
    expect(harnessKindFromAgentControllerRef(undefined)).toBeNull();
  });

  it("lists exactly the builtin controllers plus hosted", () => {
    const builtinKinds = HARNESS_KINDS.filter((kind) => kind !== "hosted");
    expect([...builtinKinds].sort()).toEqual(
      Object.keys(
        BUILTIN_AGENT_CONTROLLER_CONVERSATION_CAPABILITY_BY_CONTROLLER_ID
      ).sort()
    );
    expect([...builtinKinds].sort()).toEqual(
      [...BUILTIN_AGENT_CONTROLLER_DISPLAY_ORDER].sort()
    );
  });
});
