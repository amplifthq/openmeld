import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeHelpfulHintsForView } from "../src/runtime/helpful-hints";

describe("helpful hints normalization", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("adds explicit profile requirements to agent space hints", () => {
    expect(
      normalizeHelpfulHintsForView(
        [
          'openmeld space create --name "spaceship" --visibility private',
          "openmeld space join <space-id>",
          "openmeld space watch <space-id>",
          'openmeld space send <space-id> "hello world"',
          "openmeld space history <space-id> --limit 20",
          "openmeld space password <space-id> --password <value>",
        ],
        "agent"
      )
    ).toEqual([
      'openmeld space create --profile <profile-id> --name "spaceship" --visibility private',
      "openmeld space join --profile <profile-id> <space-id>",
      "openmeld space watch --profile <profile-id> <space-id>",
      'openmeld space send --profile <profile-id> <space-id> "hello world"',
      "openmeld space history --profile <profile-id> <space-id> --limit 20",
      "openmeld space password --profile <profile-id> <space-id> --password <value>",
    ]);
  });

  it("keeps non-space and already-explicit hints unchanged", () => {
    expect(
      normalizeHelpfulHintsForView(
        [
          "openmeld --view human space",
          "openmeld profiles list",
          "openmeld space join --profile <profile-id> <space-id>",
        ],
        "agent"
      )
    ).toEqual([
      "openmeld --view human space",
      "openmeld profiles list",
      "openmeld space join --profile <profile-id> <space-id>",
    ]);
  });

  it("renders hints with the current openmeld-dev entry command", () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");

    expect(
      normalizeHelpfulHintsForView(
        [
          'openmeld space create --name "spaceship" --visibility private',
          "openmeld profiles list",
          "openmeld space join --profile <profile-id> <space-id>",
        ],
        "agent"
      )
    ).toEqual([
      'openmeld-dev space create --profile <profile-id> --name "spaceship" --visibility private',
      "openmeld-dev profiles list",
      "openmeld-dev space join --profile <profile-id> <space-id>",
    ]);
  });

  it("renders hints for npx entry when npm exec metadata is present", () => {
    vi.stubEnv("npm_command", "exec");
    vi.stubEnv("npm_lifecycle_script", '"openmeld"');
    vi.stubEnv(
      "npm_config_user_agent",
      "npm/11.6.2 node/v25.1.0 darwin arm64 workspaces/false"
    );

    expect(
      normalizeHelpfulHintsForView(
        ["openmeld doctor --repair", "openmeld space join <space-id>"],
        "agent"
      )
    ).toEqual([
      "npx -y openmeld@latest doctor --repair",
      "npx -y openmeld@latest space join --profile <profile-id> <space-id>",
    ]);
  });
});
