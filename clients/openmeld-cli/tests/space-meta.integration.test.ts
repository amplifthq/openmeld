import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listSpaceConfigs, upsertSpaceConfig } from "../src/space/local-state";
import { withTempHome } from "./helpers/fs";
import { expectSpaceConfigListItems } from "./helpers/local-state";

const OPENMELD_PROFILE_ID = "mira--aaaaaaaa";

describe("space metadata local cache", () => {
  it("persists creator, role, and space guide in the local cache", async () => {
    await withTempHome(async (home) => {
      await upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://gateway.openmeld.invalid",
        space: "spaceship",
        name: "Spaceship",
        profileName: "Mira",
        role: "Architect",
        creator: {
          profileId: "agt_11111111-1111-4111-8111-111111111111",
          profileName: "Builder Bot",
          kind: "agent",
          profile: OPENMELD_PROFILE_ID,
        },
        spaceCreatedAt: "2026-02-13T20:12:00.000Z",
        spaceUpdatedAt: "2026-02-13T20:12:00.000Z",
        guide: "Stay concise.",
      });

      const first = expectSpaceConfigListItems(
        await listSpaceConfigs({ openMeldProfileId: OPENMELD_PROFILE_ID })
      );
      expect(first.length).toBeGreaterThan(0);
      expect(first[0]?.creator?.profileId).toBe(
        "agt_11111111-1111-4111-8111-111111111111"
      );
      expect(first[0]?.name).toBe("Spaceship");
      expect(first[0]?.spaceCreatedAt).toBe("2026-02-13T20:12:00.000Z");
      expect(first[0]?.spaceUpdatedAt).toBe("2026-02-13T20:12:00.000Z");
      expect(first[0]?.role).toBe("Architect");
      expect(first[0]?.guide).toBe("Stay concise.");
      const cachedJson = await readFile(
        join(
          home,
          ".openmeld",
          "accounts",
          "unauthenticated",
          "local",
          "profiles",
          OPENMELD_PROFILE_ID,
          "space-cache",
          "spaceship.json"
        ),
        "utf8"
      );
      expect(JSON.parse(cachedJson)).toMatchObject({
        guide: "Stay concise.",
      });

      await upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://gateway.openmeld.invalid",
        space: "spaceship",
        name: null,
        profileName: "Mira",
        role: null,
        creator: null,
        spaceCreatedAt: null,
        spaceUpdatedAt: null,
        guide: null,
      });

      const second = expectSpaceConfigListItems(
        await listSpaceConfigs({ openMeldProfileId: OPENMELD_PROFILE_ID })
      );
      expect(second.length).toBeGreaterThan(0);
      expect(second[0]?.creator).toBeUndefined();
      expect(second[0]?.name).toBeUndefined();
      expect(second[0]?.spaceCreatedAt).toBeUndefined();
      expect(second[0]?.spaceUpdatedAt).toBeUndefined();
      expect(second[0]?.role).toBeUndefined();
      expect(second[0]?.guide).toBeUndefined();
    });
  });
});
