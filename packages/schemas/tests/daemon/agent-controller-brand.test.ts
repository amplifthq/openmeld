import { describe, expect, it } from "vitest";
import {
  BUILTIN_AGENT_CONTROLLER_BRANDS,
  resolveBuiltinAgentControllerBrand,
} from "../../src/index";

describe("builtin agent controller brand registry", () => {
  it("resolves builtin controllers to their official brand colors", () => {
    expect(resolveBuiltinAgentControllerBrand("builtin:codex")).toEqual(
      BUILTIN_AGENT_CONTROLLER_BRANDS.codex
    );
    expect(resolveBuiltinAgentControllerBrand("builtin:claude-code")).toEqual(
      BUILTIN_AGENT_CONTROLLER_BRANDS["claude-code"]
    );
    expect(resolveBuiltinAgentControllerBrand("builtin:opencode")).toEqual(
      BUILTIN_AGENT_CONTROLLER_BRANDS.opencode
    );
    expect(resolveBuiltinAgentControllerBrand("builtin:cursor")).toEqual(
      BUILTIN_AGENT_CONTROLLER_BRANDS.cursor
    );
    expect(resolveBuiltinAgentControllerBrand("builtin:grok-build")).toEqual(
      BUILTIN_AGENT_CONTROLLER_BRANDS["grok-build"]
    );
    expect(resolveBuiltinAgentControllerBrand("builtin:openclaw")).toEqual(
      BUILTIN_AGENT_CONTROLLER_BRANDS.openclaw
    );
  });

  it("treats prefixed and unprefixed builtin refs the same", () => {
    expect(resolveBuiltinAgentControllerBrand("codex")).toEqual(
      BUILTIN_AGENT_CONTROLLER_BRANDS.codex
    );
    expect(resolveBuiltinAgentControllerBrand("claude-code")).toEqual(
      BUILTIN_AGENT_CONTROLLER_BRANDS["claude-code"]
    );
    expect(resolveBuiltinAgentControllerBrand("opencode")).toEqual(
      BUILTIN_AGENT_CONTROLLER_BRANDS.opencode
    );
    expect(resolveBuiltinAgentControllerBrand("grok-build")).toEqual(
      BUILTIN_AGENT_CONTROLLER_BRANDS["grok-build"]
    );
  });

  it("returns null for unsupported or custom controller refs", () => {
    expect(resolveBuiltinAgentControllerBrand("builtin:ops-bot")).toBeNull();
    expect(resolveBuiltinAgentControllerBrand("custom:ops-bot")).toBeNull();
    expect(resolveBuiltinAgentControllerBrand("ops-bot")).toBeNull();
  });
});
