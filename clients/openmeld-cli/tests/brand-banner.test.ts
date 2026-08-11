import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCliVersionSummary } from "../src/runtime/cli-version";

const outLineMock = vi.hoisted(() => vi.fn());

vi.mock("../src/ui/io", () => {
  return {
    outLine: (...args: unknown[]) => outLineMock(...args),
  };
});

import { printOpenMeldBanner } from "../src/ui/brand";

const stripAnsi = (value: string): string => stripVTControlCharacters(value);

describe("brand banner", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prints start callout first and includes key commands", () => {
    outLineMock.mockReset();
    printOpenMeldBanner();

    const lines = outLineMock.mock.calls.map((call) =>
      stripAnsi(String(call[0] ?? ""))
    );
    const taglineIndex = lines.findIndex((line) =>
      line.includes("People and agents, working as one.")
    );
    const versionIndex = lines.findIndex((line) =>
      line.includes(formatCliVersionSummary())
    );
    const calloutIndex = lines.findIndex((line) =>
      line.includes("Try this first: openmeld start")
    );
    const calloutTopIndex = lines.findIndex((line) => line.includes("┌"));
    const calloutBottomIndex = lines.findIndex((line) => line.includes("└"));
    const authLoginIndex = lines.findIndex((line) =>
      line.includes("$ openmeld auth")
    );
    const agentsIndex = lines.findIndex((line) =>
      line.includes("$ openmeld agents")
    );
    const startCommandIndex = lines.findIndex((line) =>
      line.includes("$ openmeld start")
    );

    expect(taglineIndex).toBeGreaterThan(-1);
    expect(versionIndex).toBeGreaterThan(-1);
    expect(versionIndex).toBe(taglineIndex + 1);
    expect(lines[versionIndex + 1]).toBe("");
    expect(versionIndex).toBeLessThan(calloutIndex);
    expect(calloutIndex).toBeGreaterThan(-1);
    expect(calloutTopIndex).toBeGreaterThan(-1);
    expect(calloutBottomIndex).toBeGreaterThan(calloutTopIndex);
    expect(authLoginIndex).toBeGreaterThan(calloutBottomIndex);
    expect(agentsIndex).toBeGreaterThan(calloutBottomIndex);
    expect(startCommandIndex).toBeGreaterThan(calloutBottomIndex);
    expect(
      lines.some((line) =>
        line.includes("$ openmeld space password <space-id>")
      )
    ).toBe(false);
    expect(lines.some((line) => line.includes("npm install -g openmeld"))).toBe(
      false
    );
  });

  it("renders openmeld-dev commands when the dev shortcut is the active entry", () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    outLineMock.mockReset();

    printOpenMeldBanner();

    const lines = outLineMock.mock.calls.map((call) =>
      stripAnsi(String(call[0] ?? ""))
    );
    expect(
      lines.some((line) => line.includes("Try this first: openmeld-dev start"))
    ).toBe(true);
    expect(lines.some((line) => line.includes("$ openmeld-dev auth"))).toBe(
      true
    );
    expect(lines.some((line) => line.includes("npm install -g openmeld"))).toBe(
      false
    );
  });

  it("renders npx commands and a global install hint when launched through npm exec", () => {
    vi.stubEnv("npm_command", "exec");
    vi.stubEnv("npm_lifecycle_script", '"openmeld"');
    vi.stubEnv(
      "npm_config_user_agent",
      "npm/11.6.2 node/v25.1.0 darwin arm64 workspaces/false"
    );
    outLineMock.mockReset();

    printOpenMeldBanner();

    const lines = outLineMock.mock.calls.map((call) =>
      stripAnsi(String(call[0] ?? ""))
    );
    expect(
      lines.some((line) =>
        line.includes("Try this first: npx -y openmeld@latest start")
      )
    ).toBe(true);
    expect(
      lines.some((line) => line.includes("$ npx -y openmeld@latest auth"))
    ).toBe(true);
    expect(
      lines.some((line) =>
        line.includes("Install OpenMeld globally for shorter commands:")
      )
    ).toBe(true);
    expect(lines.some((line) => line.includes("npm install -g openmeld"))).toBe(
      true
    );
    expect(
      lines.some((line) => line.includes("After install, use: openmeld start"))
    ).toBe(true);
  });
});
