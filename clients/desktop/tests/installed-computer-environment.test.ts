import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readInstalledComputerEnvironment } from "../../../scripts/desktop/installed-computer-environment";

describe("installed test Computer lane", () => {
  it.each([
    { home: join(homedir(), ".openmeld"), auth: "http://lane.localhost:8788" },
    { home: "relative-home", auth: "http://lane.localhost:8788" },
    { home: "/test-owned/computer", auth: "https://auth.openmeld.com" },
    { home: "/test-owned/computer", auth: undefined },
  ])("rejects an unaligned test build: $home / $auth", ({ home, auth }) => {
    expect(() =>
      readInstalledComputerEnvironment({
        OPENMELD_DESKTOP_TARGET: "disposable",
        OPENMELD_DESKTOP_TEST_COMPUTER_HOME: home,
        OPENMELD_DESKTOP_TEST_AUTH_ORIGIN: auth,
        OPENMELD_DESKTOP_TEST_GATEWAY_ORIGIN: "http://lane.localhost:8080",
      })
    ).toThrow();
  });
  it("uses the explicitly selected shared Service lane", () => {
    expect(
      readInstalledComputerEnvironment({
        OPENMELD_DESKTOP_TARGET: "disposable",
        OPENMELD_DESKTOP_TEST_COMPUTER_HOME: "/test-owned/computer",
        OPENMELD_DESKTOP_TEST_AUTH_ORIGIN: "http://lane.localhost:8788",
        OPENMELD_DESKTOP_TEST_GATEWAY_ORIGIN: "http://lane.localhost:8080",
      })
    ).toEqual({
      home: "/test-owned/computer",
      auth: "http://lane.localhost:8788",
      gateway: "http://lane.localhost:8080",
    });
  });
});
