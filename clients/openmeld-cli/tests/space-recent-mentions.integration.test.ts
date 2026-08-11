import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readSpaceRecentMentionProfileIds,
  upsertSpaceConfig,
  writeSpaceRecentMentionProfileIds,
} from "../src/space/local-state";
import { withTempHome } from "./helpers/fs";

const FALLBACK_ACCOUNT_PATH = [
  ".openmeld",
  "accounts",
  "unauthenticated",
  "local",
  "profiles",
  "mira--aaaaaaaa",
  "space-cache",
] as const;
const OPENMELD_PROFILE_ID = "mira--aaaaaaaa";
const OTHER_OPENMELD_PROFILE_ID = "nova--bbbbbbbb";

describe("space recent mentions", () => {
  it("reads an empty recent mention list when the field is absent", async () => {
    await withTempHome(async () => {
      await upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileHandle: "mira-main",
        profileName: "Mira",
      });

      await expect(
        readSpaceRecentMentionProfileIds({
          openMeldProfileId: OPENMELD_PROFILE_ID,
          space: "demo",
        })
      ).resolves.toEqual([]);
    });
  });

  it("writes recent mentions with dedupe, pruning, and round-trip read support", async () => {
    await withTempHome(async (home) => {
      await upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Mira",
      });

      await writeSpaceRecentMentionProfileIds({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        space: "demo",
        recentMentionProfileIds: [
          " agt_ops ",
          "hum_felix",
          "agt_ops",
          "stale_profile",
        ],
        allowedProfileIds: ["agt_ops", "hum_felix"],
      });

      await expect(
        readSpaceRecentMentionProfileIds({
          openMeldProfileId: OPENMELD_PROFILE_ID,
          space: "demo",
        })
      ).resolves.toEqual(["agt_ops", "hum_felix"]);

      const raw = await readFile(
        join(home, ...FALLBACK_ACCOUNT_PATH, "demo.json"),
        "utf8"
      );
      const parsed = JSON.parse(raw) as { recentMentionProfileIds?: string[] };
      expect(parsed.recentMentionProfileIds).toEqual(["agt_ops", "hum_felix"]);
    });
  });

  it("normalizes allowed profile ids consistently for Set inputs", async () => {
    await withTempHome(async () => {
      await upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Mira",
      });

      await writeSpaceRecentMentionProfileIds({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        space: "demo",
        recentMentionProfileIds: ["agt_ops", "hum_felix", "agt_stale"],
        allowedProfileIds: new Set([" agt_ops ", "hum_felix", "", "agt_ops"]),
      });

      await expect(
        readSpaceRecentMentionProfileIds({
          openMeldProfileId: OPENMELD_PROFILE_ID,
          space: "demo",
        })
      ).resolves.toEqual(["agt_ops", "hum_felix"]);
    });
  });

  it("keeps recent mentions isolated by openMeldProfileId", async () => {
    await withTempHome(async () => {
      await upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Mira",
      });
      await writeSpaceRecentMentionProfileIds({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        space: "demo",
        recentMentionProfileIds: ["agt_ops"],
      });

      await upsertSpaceConfig({
        openMeldProfileId: OTHER_OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Nova",
      });
      await writeSpaceRecentMentionProfileIds({
        openMeldProfileId: OTHER_OPENMELD_PROFILE_ID,
        space: "demo",
        recentMentionProfileIds: ["hum_felix"],
      });

      await expect(
        readSpaceRecentMentionProfileIds({
          openMeldProfileId: OPENMELD_PROFILE_ID,
          space: "demo",
        })
      ).resolves.toEqual(["agt_ops"]);

      await expect(
        readSpaceRecentMentionProfileIds({
          openMeldProfileId: OTHER_OPENMELD_PROFILE_ID,
          space: "demo",
        })
      ).resolves.toEqual(["hum_felix"]);
    });
  });

  it("starts a new openMeldProfileId cache without inherited recent mentions", async () => {
    await withTempHome(async (home) => {
      await upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Mira",
      });
      await writeSpaceRecentMentionProfileIds({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        space: "demo",
        recentMentionProfileIds: ["agt_ops", "hum_felix"],
      });

      await upsertSpaceConfig({
        openMeldProfileId: OTHER_OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Nova",
      });

      await expect(
        readSpaceRecentMentionProfileIds({
          openMeldProfileId: OTHER_OPENMELD_PROFILE_ID,
          space: "demo",
        })
      ).resolves.toEqual([]);

      const raw = await readFile(
        join(
          home,
          ".openmeld",
          "accounts",
          "unauthenticated",
          "local",
          "profiles",
          OTHER_OPENMELD_PROFILE_ID,
          "space-cache",
          "demo.json"
        ),
        "utf8"
      );
      const parsed = JSON.parse(raw) as { recentMentionProfileIds?: string[] };
      expect(parsed.recentMentionProfileIds).toBeUndefined();
      expect(parsed).not.toHaveProperty("profileHandle");
    });
  });
});
