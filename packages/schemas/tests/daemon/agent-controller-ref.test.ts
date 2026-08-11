import { describe, expect, it } from "vitest";
import {
  areBuiltinAgentControllerRefsEquivalent,
  buildAgentControllerRoutingKey,
  canonicalizeAgentControllerRef,
  canonicalizeBuiltinAgentControllerRef,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_CONTROLLER_REF_ID,
  isHostedCenterAgentControllerRef,
  normalizeBuiltinAgentControllerId,
  normalizeKnownBuiltinAgentControllerId,
  parseAgentControllerRef,
} from "../../src/index";

describe("builtin controller ref helpers", () => {
  it("normalizes prefixed and unprefixed builtin refs to the same known builtin controller id", () => {
    expect(normalizeKnownBuiltinAgentControllerId("builtin:codex")).toBe(
      "codex"
    );
    expect(normalizeKnownBuiltinAgentControllerId("codex")).toBe("codex");
    expect(normalizeKnownBuiltinAgentControllerId("builtin:openclaw")).toBe(
      "openclaw"
    );
    expect(normalizeKnownBuiltinAgentControllerId("builtin:opencode")).toBe(
      "opencode"
    );
    expect(normalizeKnownBuiltinAgentControllerId("opencode")).toBe("opencode");
    expect(normalizeKnownBuiltinAgentControllerId("ops-bot")).toBeNull();
    expect(normalizeKnownBuiltinAgentControllerId("custom:ops-bot")).toBeNull();
  });

  it("normalizes builtin refs to the same local agent id", () => {
    expect(normalizeBuiltinAgentControllerId("builtin:codex")).toBe("codex");
    expect(normalizeBuiltinAgentControllerId("codex")).toBe("codex");
  });

  it("canonicalizes builtin refs to the prefixed form", () => {
    expect(canonicalizeBuiltinAgentControllerRef("codex")).toBe(
      "builtin:codex"
    );
    expect(canonicalizeBuiltinAgentControllerRef(" builtin:codex ")).toBe(
      "builtin:codex"
    );
    expect(
      canonicalizeBuiltinAgentControllerRef("builtin:builtin:codex")
    ).toBeNull();
    expect(
      canonicalizeBuiltinAgentControllerRef("builtin:custom:ops-bot")
    ).toBeNull();
  });

  it("parses complete Agent Controller refs", () => {
    expect(parseAgentControllerRef("builtin:codex")).toEqual({
      kind: "builtin",
      id: "codex",
      ref: "builtin:codex",
    });
    expect(parseAgentControllerRef("custom:ops-bot")).toEqual({
      kind: "custom",
      id: "ops-bot",
      ref: "custom:ops-bot",
    });
    expect(parseAgentControllerRef(HOSTED_CENTER_AGENT_CONTROLLER_REF)).toEqual(
      {
        kind: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        id: HOSTED_CENTER_AGENT_CONTROLLER_REF_ID,
        ref: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      }
    );
    expect(parseAgentControllerRef("codex")).toBeNull();
  });

  it("canonicalizes complete Agent Controller refs", () => {
    expect(canonicalizeAgentControllerRef(" builtin:codex ")).toBe(
      "builtin:codex"
    );
    expect(canonicalizeAgentControllerRef(" custom:ops-bot ")).toBe(
      "custom:ops-bot"
    );
    expect(
      canonicalizeAgentControllerRef(` ${HOSTED_CENTER_AGENT_CONTROLLER_REF} `)
    ).toBe(HOSTED_CENTER_AGENT_CONTROLLER_REF);
    expect(canonicalizeAgentControllerRef("codex")).toBeNull();
    expect(canonicalizeAgentControllerRef("builtin:builtin:codex")).toBeNull();
  });

  it("uses complete Agent Controller refs as routing keys", () => {
    expect(buildAgentControllerRoutingKey("builtin:codex")).toBe(
      "builtin:codex"
    );
    expect(buildAgentControllerRoutingKey("custom:ops-bot")).toBe(
      "custom:ops-bot"
    );
    expect(
      buildAgentControllerRoutingKey(HOSTED_CENTER_AGENT_CONTROLLER_REF)
    ).toBe(HOSTED_CENTER_AGENT_CONTROLLER_REF);
    expect(buildAgentControllerRoutingKey("codex")).toBeNull();
  });

  it("compares complete builtin refs", () => {
    expect(
      areBuiltinAgentControllerRefsEquivalent("builtin:codex", "builtin:codex")
    ).toBe(true);
    expect(
      areBuiltinAgentControllerRefsEquivalent("builtin:claude-code", "codex")
    ).toBe(false);
    expect(
      areBuiltinAgentControllerRefsEquivalent("custom:ops-bot", "ops-bot")
    ).toBe(false);
    expect(
      areBuiltinAgentControllerRefsEquivalent(
        HOSTED_CENTER_AGENT_CONTROLLER_REF,
        HOSTED_CENTER_AGENT_CONTROLLER_REF
      )
    ).toBe(false);
  });

  it("recognizes the hosted Center Agent ref without treating malformed hosted refs as valid", () => {
    expect(
      isHostedCenterAgentControllerRef(HOSTED_CENTER_AGENT_CONTROLLER_REF)
    ).toBe(true);
    expect(isHostedCenterAgentControllerRef("hosted:other-agent")).toBe(false);
    expect(isHostedCenterAgentControllerRef("hosted:center-agent:extra")).toBe(
      false
    );
  });

  it("rejects builtin refs whose id is not a bare token", () => {
    expect(
      normalizeKnownBuiltinAgentControllerId("builtin:builtin:codex")
    ).toBeNull();
    expect(
      normalizeKnownBuiltinAgentControllerId("builtin:custom:ops-bot")
    ).toBeNull();
    expect(
      normalizeBuiltinAgentControllerId("builtin:builtin:codex")
    ).toBeNull();
    expect(
      normalizeBuiltinAgentControllerId("builtin:custom:ops-bot")
    ).toBeNull();
  });
});
