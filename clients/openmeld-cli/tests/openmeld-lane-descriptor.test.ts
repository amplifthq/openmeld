import { describe, expect, it } from "vitest";
import {
  buildLaneScopedCleanupGuidance,
  formatLaneScopeSentence,
  resolveOpenMeldLaneDescriptor,
} from "../src/config/openmeld-lane-descriptor";

describe("OpenMeld lane descriptor", () => {
  it("describes the packaged canary lane without touching other lanes", () => {
    const lane = resolveOpenMeldLaneDescriptor({
      env: {
        OPENMELD_ENV_PRESET: "canary",
      },
      homeDir: "/Users/tester",
    });

    expect(lane).toMatchObject({
      command: "openmeld-canary",
      preset: "canary",
      openMeldHome: "/Users/tester/.openmeld-canary",
      destructiveResetAllowed: true,
      repairCommand: "openmeld-canary repair local-state",
      removeCommand: "pnpm openmeld:canary:remove",
      resetCommand: "openmeld-canary reset --yes",
    });
    expect(formatLaneScopeSentence(lane)).toBe(
      "This only affects the openmeld-canary lane at /Users/tester/.openmeld-canary."
    );
    expect(buildLaneScopedCleanupGuidance(lane)).toBe(
      "Optional cleanup for this lane: run `pnpm openmeld:canary:remove` or `openmeld-canary repair local-state`."
    );
  });

  it("describes the repo-local development lane", () => {
    const lane = resolveOpenMeldLaneDescriptor({
      env: {
        OPENMELD_ENV_PRESET: "dev-local",
      },
      homeDir: "/Users/tester",
    });

    expect(lane).toMatchObject({
      command: "openmeld-dev",
      preset: "dev-local",
      openMeldHome: "/Users/tester/.openmeld-dev",
      repairCommand: "openmeld-dev repair local-state",
      removeCommand: null,
      resetCommand: "openmeld-dev reset --yes",
    });
  });

  it("describes the published production lane", () => {
    const lane = resolveOpenMeldLaneDescriptor({
      env: {
        OPENMELD_ENV_PRESET: "prod",
      },
      homeDir: "/Users/tester",
    });

    expect(lane).toMatchObject({
      command: "openmeld",
      preset: "prod",
      openMeldHome: "/Users/tester/.openmeld",
      repairCommand: "openmeld repair local-state",
      removeCommand: null,
      resetCommand: "openmeld reset --yes",
    });
  });
});
