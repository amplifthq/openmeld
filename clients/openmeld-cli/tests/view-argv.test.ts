import { describe, expect, it } from "vitest";
import {
  hasJsonOutputArgv,
  isPassiveCliQueryArgv,
  parseLeadingCommandTokensFromArgv,
} from "../src/runtime/view-argv";

describe("parseLeadingCommandTokensFromArgv", () => {
  it("skips global flags and returns the leading command path", () => {
    expect(
      parseLeadingCommandTokensFromArgv(
        ["node", "openmeld", "--view", "agent", "profile", "create", "Codex"],
        2
      )
    ).toEqual(["profile", "create"]);
  });

  it("skips parent Space options before the read subcommand", () => {
    expect(
      parseLeadingCommandTokensFromArgv(
        [
          "node",
          "openmeld",
          "--view",
          "agent",
          "space",
          "--gateway-url",
          "http://localhost:8787",
          "--profile=profile-explicit",
          "status",
          "not-a-space",
        ],
        2
      )
    ).toEqual(["space", "status"]);
  });

  it("keeps a single command token when no subcommand is present", () => {
    expect(
      parseLeadingCommandTokensFromArgv(
        ["node", "openmeld", "--service-auto-install", "ask", "whoami"],
        2
      )
    ).toEqual(["whoami"]);
  });

  it("reads tokens after the option terminator", () => {
    expect(
      parseLeadingCommandTokensFromArgv(
        ["node", "openmeld", "--view", "agent", "--", "profile", "update"],
        2
      )
    ).toEqual(["profile", "update"]);
  });
});

describe("hasJsonOutputArgv", () => {
  it("detects JSON output flags before the option terminator", () => {
    expect(
      hasJsonOutputArgv(["node", "openmeld", "space", "status", "--json"])
    ).toBe(true);
    expect(
      hasJsonOutputArgv(["node", "openmeld", "space", "status", "--json=true"])
    ).toBe(true);
  });

  it("ignores JSON-looking positional values after the option terminator", () => {
    expect(
      hasJsonOutputArgv(["node", "openmeld", "space", "send", "--", "--json"])
    ).toBe(false);
  });
});

describe("isPassiveCliQueryArgv", () => {
  it("keeps auth and Service diagnostics available during deferred Computer recovery", () => {
    expect(
      isPassiveCliQueryArgv([
        "node",
        "openmeld",
        "auth",
        "status",
        "--view",
        "agent",
      ])
    ).toBe(true);
    expect(
      isPassiveCliQueryArgv([
        "node",
        "openmeld",
        "service",
        "status",
        "--view=agent",
      ])
    ).toBe(true);
    expect(
      isPassiveCliQueryArgv([
        "node",
        "openmeld",
        "service",
        "repair",
        "--view",
        "agent",
      ])
    ).toBe(false);
  });
});
