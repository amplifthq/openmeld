import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LocalSpaceStateIntegrityError,
  listSpaceConfigs,
  readSpaceCacheDeletionNoticeState,
  readSpaceCacheMaintenanceState,
  readSpaceConfig,
  upsertSpaceConfig,
} from "../src/space/local-state";
import { withTempHome } from "./helpers/fs";
import { expectSpaceConfigListItems } from "./helpers/local-state";

const PROFILE_ID = "mira--contract";
const SPACE_ID = "demo";
const CURRENT_CACHE_PATH = [
  ".openmeld",
  "accounts",
  "unauthenticated",
  "local",
  "profiles",
  PROFILE_ID,
  "space-cache",
] as const;
const LEGACY_CACHE_PATH = [
  ".openmeld",
  "accounts",
  "unauthenticated",
  "local",
  "profiles",
  PROFILE_ID,
  "spaces",
] as const;

describe("space local-state contract", () => {
  it("does not fall back to the legacy file when the current file is corrupt", async () => {
    await withTempHome(async (home) => {
      const currentDir = join(home, ...CURRENT_CACHE_PATH);
      const legacyDir = join(home, ...LEGACY_CACHE_PATH);
      await mkdir(currentDir, { recursive: true });
      await mkdir(legacyDir, { recursive: true });

      await writeFile(join(currentDir, `${SPACE_ID}.json`), "{", "utf8");
      await writeFile(
        join(legacyDir, `${SPACE_ID}.json`),
        `${JSON.stringify(
          buildLegacySpaceConfig({
            space: SPACE_ID,
            profileId: PROFILE_ID,
          }),
          null,
          2
        )}\n`,
        "utf8"
      );

      const result = await readSpaceConfig({
        openMeldProfileId: PROFILE_ID,
        space: SPACE_ID,
      });

      expect(result).toMatchObject({
        kind: "invalid_json",
        fileKind: "space_config",
        source: "current",
      });
    });
  });

  it("returns a corrupt list result when any local space config file is corrupt", async () => {
    await withTempHome(async (home) => {
      await upsertSpaceConfig({
        openMeldProfileId: PROFILE_ID,
        baseUrl: "https://gateway.example.com",
        space: "alpha",
        profileName: "Mira",
      });
      const currentDir = join(home, ...CURRENT_CACHE_PATH);
      await mkdir(currentDir, { recursive: true });
      await writeFile(join(currentDir, "broken.json"), "{", "utf8");

      const result = await listSpaceConfigs({
        openMeldProfileId: PROFILE_ID,
      });

      expect(result.kind).toBe("corrupt");
      if (result.kind !== "corrupt") {
        throw new Error("expected a corrupt local-state list result");
      }
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "space_config",
            reason: "invalid_json",
          }),
        ])
      );
    });
  });

  it("returns invalid_shape for corrupt maintenance state files", async () => {
    await withTempHome(async (home) => {
      const currentDir = join(home, ...CURRENT_CACHE_PATH);
      await mkdir(currentDir, { recursive: true });
      await writeFile(
        join(currentDir, "_maintenance.json"),
        `${JSON.stringify({ v: 1, lastRunAt: "not-an-iso" })}\n`,
        "utf8"
      );

      await expect(
        readSpaceCacheMaintenanceState({ openMeldProfileId: PROFILE_ID })
      ).resolves.toMatchObject({
        kind: "invalid_shape",
        fileKind: "maintenance_state",
      });
    });
  });

  it("returns invalid_shape for corrupt deletion notice state files", async () => {
    await withTempHome(async (home) => {
      const currentDir = join(home, ...CURRENT_CACHE_PATH);
      await mkdir(currentDir, { recursive: true });
      await writeFile(
        join(currentDir, "_deletion-notices.json"),
        `${JSON.stringify({
          v: 1,
          seen: {
            "gateway.example.com:alpha": "not-an-iso",
          },
        })}\n`,
        "utf8"
      );

      await expect(
        readSpaceCacheDeletionNoticeState({ openMeldProfileId: PROFILE_ID })
      ).resolves.toMatchObject({
        kind: "invalid_shape",
        fileKind: "deletion_notice_state",
      });
    });
  });

  it("refuses to overwrite a corrupt current space config file", async () => {
    await withTempHome(async (home) => {
      const currentDir = join(home, ...CURRENT_CACHE_PATH);
      await mkdir(currentDir, { recursive: true });
      const corruptPath = join(currentDir, `${SPACE_ID}.json`);
      await writeFile(corruptPath, "{", "utf8");

      await expect(
        upsertSpaceConfig({
          openMeldProfileId: PROFILE_ID,
          baseUrl: "https://gateway.example.com",
          space: SPACE_ID,
          profileName: "Mira",
        })
      ).rejects.toBeInstanceOf(LocalSpaceStateIntegrityError);

      await expect(readFile(corruptPath, "utf8")).resolves.toBe("{");
    });
  });

  it("preserves profileHandle when reading a current cache file", async () => {
    await withTempHome(async () => {
      await upsertSpaceConfig({
        openMeldProfileId: PROFILE_ID,
        baseUrl: "https://gateway.example.com",
        space: SPACE_ID,
        profileHandle: "mira-main",
        profileName: "Mira",
      });

      const list = expectSpaceConfigListItems(
        await listSpaceConfigs({ openMeldProfileId: PROFILE_ID })
      );
      expect(list[0]?.profileHandle).toBe("mira-main");

      const readResult = await readSpaceConfig({
        openMeldProfileId: PROFILE_ID,
        space: SPACE_ID,
      });
      expect(readResult).toMatchObject({
        kind: "ok",
        source: "current",
      });
      if (readResult.kind !== "ok") {
        throw new Error("expected a readable current space config");
      }
      expect(readResult.value.profileHandle).toBe("mira-main");
    });
  });
});

function buildLegacySpaceConfig(input: { space: string; profileId: string }) {
  return {
    v: 1,
    baseUrl: "https://gateway.example.com",
    space: input.space,
    profileId: input.profileId,
    profileHandle: "mira-main",
    profileName: "Mira",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  };
}
