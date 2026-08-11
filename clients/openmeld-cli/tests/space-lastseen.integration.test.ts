import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setAuthSession } from "../src/config/auth-session";
import {
  listSpaceConfigs,
  readSpaceLastSeenTs,
  updateSpaceLastSeenTs,
  upsertSpaceConfig,
} from "../src/space/local-state";
import { withTempHome } from "./helpers/fs";
import { expectSpaceConfigListItems } from "./helpers/local-state";

const HASHED_SPACE_FILENAME_REGEX = /^space_1_[a-f0-9]{8}\.json$/;
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

describe("space lastSeenTs", () => {
  it("persists lastSeenTs monotonically", async () => {
    await withTempHome(async (home) => {
      await upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Mira",
      });

      await updateSpaceLastSeenTs({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        space: "demo",
        lastSeenTs: 100,
      });
      await updateSpaceLastSeenTs({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        space: "demo",
        lastSeenTs: 50,
      });

      const raw = await readFile(
        join(home, ...FALLBACK_ACCOUNT_PATH, "demo.json"),
        "utf8"
      );
      const parsed = JSON.parse(raw);
      expect(parsed.lastSeenTs).toBe(100);
    });
  });

  it("reads lastSeenTs when present", async () => {
    await withTempHome(async () => {
      await upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Mira",
      });
      await updateSpaceLastSeenTs({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        space: "demo",
        lastSeenTs: 321,
      });

      const ts = await readSpaceLastSeenTs({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        space: "demo",
      });
      expect(ts).toBe(321);
    });
  });

  it("keeps lastSeen and role state scoped to openMeldProfileId", async () => {
    await withTempHome(async (home) => {
      await upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Mira",
        role: "triage",
      });
      await updateSpaceLastSeenTs({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        space: "demo",
        lastSeenTs: 321,
      });

      await upsertSpaceConfig({
        openMeldProfileId: OTHER_OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Nova",
      });

      const scopedRaw = await readFile(
        join(home, ...FALLBACK_ACCOUNT_PATH, "demo.json"),
        "utf8"
      );
      const scopedParsed = JSON.parse(scopedRaw) as {
        openMeldProfileId?: string;
        profileName?: string;
        role?: string;
        lastSeenTs?: number;
      };
      expect(scopedParsed.openMeldProfileId).toBe(OPENMELD_PROFILE_ID);
      expect(scopedParsed.profileName).toBe("Mira");
      expect(scopedParsed.role).toBe("triage");
      expect(scopedParsed.lastSeenTs).toBe(321);

      const isolatedRaw = await readFile(
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
      const isolatedParsed = JSON.parse(isolatedRaw) as {
        openMeldProfileId?: string;
        profileName?: string;
        role?: string;
        lastSeenTs?: number;
      };
      expect(isolatedParsed.openMeldProfileId).toBe(OTHER_OPENMELD_PROFILE_ID);
      expect(isolatedParsed.profileName).toBe("Nova");
      expect(isolatedParsed.role).toBeUndefined();
      expect(isolatedParsed.lastSeenTs).toBeUndefined();
    });
  });

  it("applies lastSeen updates only within the matching openMeldProfileId scope", async () => {
    await withTempHome(async (home) => {
      await upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Mira",
      });
      await updateSpaceLastSeenTs({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        space: "demo",
        lastSeenTs: 100,
      });
      await upsertSpaceConfig({
        openMeldProfileId: OTHER_OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Nova",
      });
      await updateSpaceLastSeenTs({
        openMeldProfileId: OTHER_OPENMELD_PROFILE_ID,
        space: "demo",
        lastSeenTs: 999,
      });

      const raw = await readFile(
        join(home, ...FALLBACK_ACCOUNT_PATH, "demo.json"),
        "utf8"
      );
      const parsed = JSON.parse(raw) as { lastSeenTs?: number };
      expect(parsed.lastSeenTs).toBe(100);
    });
  });

  it("keeps distinct local files for spaces with the same sanitized base", async () => {
    await withTempHome(async (home) => {
      await upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "space@1",
        profileName: "Mira",
      });
      await upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "space#1",
        profileName: "Nova",
      });

      const files = await readdir(join(home, ...FALLBACK_ACCOUNT_PATH));
      expect(files).toHaveLength(2);
      expect(files[0]).not.toBe(files[1]);
      for (const file of files) {
        expect(file).toMatch(HASHED_SPACE_FILENAME_REGEX);
      }

      const configs = expectSpaceConfigListItems(
        await listSpaceConfigs({ openMeldProfileId: OPENMELD_PROFILE_ID })
      );
      expect(configs.map((item) => item.space).sort()).toEqual([
        "space#1",
        "space@1",
      ]);
    });
  });

  it("writes caches under authenticated account scope", async () => {
    await withTempHome(async (home) => {
      const prev = process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN;
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await setAuthSession({
          accessToken: "token",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli-dev",
          user: {
            id: "cdd6d450-9d2f-4c57-864f-c56943ba6663",
            email: "felix@openmeld.invalid",
          },
        });
      } finally {
        if (prev === undefined) {
          Reflect.deleteProperty(
            process.env,
            "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
          );
        } else {
          process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = prev;
        }
      }

      await upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Mira",
      });

      const raw = await readFile(
        join(
          home,
          ".openmeld",
          "accounts",
          "auth.openmeld.invalid",
          "cdd6d450-9d2f-4c57-864f-c56943ba6663",
          "profiles",
          OPENMELD_PROFILE_ID,
          "space-cache",
          "demo.json"
        ),
        "utf8"
      );
      const parsed = JSON.parse(raw) as { space?: string };
      expect(parsed.space).toBe("demo");
    });
  });
});
