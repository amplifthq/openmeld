import { describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init";
import { getSessionOpenMeldProfileId } from "../src/config/session-profile";
import { withSilencedStdio, withTempHome } from "./helpers/fs";

describe("session profile behavior via runInit", () => {
  it("writes session-scoped profile when CLI context is available", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_CLI_CONTEXT_ID = "session-a";

      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--bbbbbbbb",
          profileId: "bbbbbbbb-0000-0000-0000-000000000000",
          profileName: "Mira",
        });
      });

      expect(await getSessionOpenMeldProfileId()).toBe("mira--bbbbbbbb");
    });
  });

  it("does not throw when CLI context is unavailable", async () => {
    await withTempHome(async () => {
      const previousOpenMeldCliContextId = process.env.OPENMELD_CLI_CONTEXT_ID;
      try {
        Reflect.deleteProperty(process.env, "OPENMELD_CLI_CONTEXT_ID");

        await withSilencedStdio(async () => {
          await runInit({
            profile: "felix--cccccccc",
            profileId: "cccccccc-0000-0000-0000-000000000000",
            profileName: "Felix",
          });
        });
      } finally {
        if (previousOpenMeldCliContextId === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_CLI_CONTEXT_ID");
        } else {
          process.env.OPENMELD_CLI_CONTEXT_ID = previousOpenMeldCliContextId;
        }
      }

      expect(await getSessionOpenMeldProfileId()).toBeNull();
    });
  });
});
