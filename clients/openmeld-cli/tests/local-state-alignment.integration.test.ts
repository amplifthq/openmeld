import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runLocalStateAlignment } from "../src/system/local-state-alignment";
import { withTempHome } from "./helpers/fs";

describe("local state alignment", () => {
  it("migrates legacy local state into the active OpenMeld home layout", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AGENT_SESSION_ID = "session/a";

      await mkdir(
        join(home, ".openmeld", "runtime", "selected-openmeld-profiles"),
        {
          recursive: true,
        }
      );
      await writeFile(
        join(
          home,
          ".openmeld",
          "runtime",
          "selected-openmeld-profiles",
          `${toSafeSessionFile("session/a")}.selected-profile.json`
        ),
        `${JSON.stringify(
          {
            v: 1,
            sessionId: "session/a",
            sessionSource: "environment:OPENMELD_AGENT_SESSION_ID",
            openMeldProfileId: "agt_alpha",
            updatedAt: "2026-03-08T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      await writeFile(
        join(home, ".openmeld", "config.json"),
        `${JSON.stringify(
          {
            v: 1,
            baseUrl: "https://gateway.example.com/",
            skills: {
              storeDir: "/tmp/skills",
            },
            updatedAt: "2026-03-08T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      await mkdir(
        join(
          home,
          ".openmeld",
          "accounts",
          "unauthenticated",
          "local",
          "profiles",
          "felix",
          "spaces"
        ),
        {
          recursive: true,
        }
      );
      await writeFile(
        join(
          home,
          ".openmeld",
          "accounts",
          "unauthenticated",
          "local",
          "profiles",
          "felix",
          "spaces",
          "space-demo.json"
        ),
        `${JSON.stringify(
          {
            v: 1,
            baseUrl: "https://gateway.example.com",
            space: "space-demo",
            profileId: "agt_alpha",
            profileName: "Felix",
            updatedAt: "2026-03-08T00:00:00.000Z",
            createdAt: "2026-03-08T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      await mkdir(
        join(home, ".openmeld", "profiles", "legacy-profile", "spaces"),
        {
          recursive: true,
        }
      );
      await writeFile(
        join(home, ".openmeld", "profiles", "legacy-profile", "view.json"),
        `${JSON.stringify({ view: "agent" }, null, 2)}\n`,
        "utf8"
      );
      await writeFile(
        join(
          home,
          ".openmeld",
          "profiles",
          "legacy-profile",
          "spaces",
          "legacy-space.json"
        ),
        `${JSON.stringify(
          {
            v: 1,
            baseUrl: "https://gateway.example.com",
            space: "legacy-space",
            profileId: "agt_legacy",
            profileName: "Legacy",
            updatedAt: "2026-03-08T00:00:00.000Z",
            createdAt: "2026-03-08T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      await mkdir(join(home, ".openmeld", "runtime"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "runtime", "orphan.json.tmp-1"),
        "{}\n",
        "utf8"
      );

      const report = await runLocalStateAlignment();

      expect(report.runtimeConfig).toEqual({
        migratedLegacyConfig: true,
        removedLegacyConfig: true,
      });
      expect(report.selectedOpenMeldProfile.migratedSessionSelections).toBe(1);
      expect(report.spaceCache.migratedAccountSpaceFiles).toBe(1);
      expect(report.spaceCache.migratedLegacyProfileFiles).toBe(1);
      expect(report.spaceCache.migratedLegacyViews).toBe(1);
      expect(report.spaceCache.requiresRepair).toBe(false);
      expect(report.spaceCache.detectedCorruptFiles).toBe(0);
      expect(report.spaceCache.backedUpCorruptFiles).toBe(0);
      expect(report.spaceCache.backupRootPath).toBeNull();
      expect(report.spaceCache.failedBackupPaths).toEqual([]);
      expect(report.cleanup.removedTemporaryFiles).toBe(1);

      await expect(
        readFile(join(home, ".openmeld", "device", "preferences.json"), "utf8")
      ).resolves.toContain('"baseUrl": "https://gateway.example.com"');
      await expect(
        readFile(
          join(home, ".openmeld", "device", "skills", "store.json"),
          "utf8"
        )
      ).resolves.toContain('"storeDir": "/tmp/skills"');
      await expect(
        readFile(
          join(
            home,
            ".openmeld",
            "runtime",
            "sessions",
            `${toSafeSessionFile("session/a")}.json`
          ),
          "utf8"
        )
      ).resolves.toContain('"selectedOpenMeldProfileId": "agt_alpha"');
      await expect(
        readFile(
          join(
            home,
            ".openmeld",
            "accounts",
            "unauthenticated",
            "local",
            "profiles",
            "felix",
            "space-cache",
            "space-demo.json"
          ),
          "utf8"
        )
      ).resolves.toContain('"v": 1');
      await expect(
        readFile(
          join(
            home,
            ".openmeld",
            "accounts",
            "unauthenticated",
            "local",
            "profiles",
            "legacy-profile",
            "view.json"
          ),
          "utf8"
        )
      ).resolves.toContain('"view": "agent"');
      await expect(
        readFile(
          join(
            home,
            ".openmeld",
            "accounts",
            "unauthenticated",
            "local",
            "profiles",
            "legacy-profile",
            "space-cache",
            "legacy-space.json"
          ),
          "utf8"
        )
      ).resolves.toContain('"space": "legacy-space"');
      await expect(
        readFile(join(home, ".openmeld", "config.json"), "utf8")
      ).rejects.toThrow();
      await expect(
        readFile(
          join(home, ".openmeld", "runtime", "orphan.json.tmp-1"),
          "utf8"
        )
      ).rejects.toThrow();
    });
  });

  it("blocks on corrupt space cache during check mode and backs it up during repair", async () => {
    await withTempHome(async (home) => {
      await mkdir(
        join(
          home,
          ".openmeld",
          "accounts",
          "unauthenticated",
          "local",
          "profiles",
          "felix",
          "space-cache"
        ),
        {
          recursive: true,
        }
      );
      const corruptPath = join(
        home,
        ".openmeld",
        "accounts",
        "unauthenticated",
        "local",
        "profiles",
        "felix",
        "space-cache",
        "broken-space.json"
      );
      await writeFile(corruptPath, "{\n", "utf8");

      const checkReport = await runLocalStateAlignment({
        mode: "check",
      });
      expect(checkReport.spaceCache.requiresRepair).toBe(true);
      expect(checkReport.spaceCache.detectedCorruptFiles).toBe(1);
      expect(checkReport.spaceCache.detectedCorruptSpaceConfigFiles).toBe(1);
      expect(checkReport.spaceCache.backedUpCorruptFiles).toBe(0);
      expect(checkReport.spaceCache.backupRootPath).toBeNull();
      expect(checkReport.spaceCache.failedBackupPaths).toEqual([]);
      await expect(readFile(corruptPath, "utf8")).resolves.toBe("{\n");

      const repairReport = await runLocalStateAlignment({
        mode: "repair",
      });
      expect(repairReport.spaceCache.requiresRepair).toBe(false);
      expect(repairReport.spaceCache.detectedCorruptFiles).toBe(1);
      expect(repairReport.spaceCache.detectedCorruptSpaceConfigFiles).toBe(1);
      expect(repairReport.spaceCache.backedUpCorruptFiles).toBe(1);
      expect(repairReport.spaceCache.backupRootPath).toBeTruthy();
      expect(repairReport.spaceCache.failedBackupPaths).toEqual([]);

      const backupRootPath = repairReport.spaceCache.backupRootPath;
      if (!backupRootPath) {
        throw new Error("expected backupRootPath");
      }

      await expect(readFile(corruptPath, "utf8")).rejects.toThrow();
      await expect(
        readFile(
          join(
            backupRootPath,
            "accounts",
            "unauthenticated",
            "local",
            "profiles",
            "felix",
            "space-cache",
            "broken-space.json"
          ),
          "utf8"
        )
      ).resolves.toBe("{\n");
    });
  });

  it("reports partial corrupt-file backups without hiding the remaining repair work", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-03-24T00:00:00.000Z"));
      await withTempHome(async (home) => {
        const profileARoot = join(
          home,
          ".openmeld",
          "accounts",
          "unauthenticated",
          "local",
          "profiles",
          "profile-a",
          "space-cache"
        );
        const profileBRoot = join(
          home,
          ".openmeld",
          "accounts",
          "unauthenticated",
          "local",
          "profiles",
          "profile-b",
          "space-cache"
        );
        await mkdir(profileARoot, { recursive: true });
        await mkdir(profileBRoot, { recursive: true });

        const backupRoot = join(
          home,
          ".openmeld-backups",
          "local-state-corruption",
          `2026-03-24T00-00-00.000Z-${process.pid}`
        );
        await mkdir(
          join(backupRoot, "accounts", "unauthenticated", "local", "profiles"),
          {
            recursive: true,
          }
        );
        await writeFile(
          join(
            backupRoot,
            "accounts",
            "unauthenticated",
            "local",
            "profiles",
            "profile-b"
          ),
          "block mkdir",
          "utf8"
        );

        const corruptPathA = join(profileARoot, "broken-a.json");
        const corruptPathB = join(profileBRoot, "broken-b.json");
        await writeFile(corruptPathA, "{\n", "utf8");
        await writeFile(corruptPathB, "{\n", "utf8");

        const repairReport = await runLocalStateAlignment({
          mode: "repair",
        });

        expect(repairReport.spaceCache.requiresRepair).toBe(true);
        expect(repairReport.spaceCache.backedUpCorruptFiles).toBe(1);
        expect(repairReport.spaceCache.failedBackupPaths).toEqual([
          corruptPathB,
        ]);
        expect(repairReport.spaceCache.backupRootPath).toBe(backupRoot);

        await expect(readFile(corruptPathA, "utf8")).rejects.toThrow();
        await expect(readFile(corruptPathB, "utf8")).resolves.toBe("{\n");
        await expect(
          readFile(
            join(
              backupRoot,
              "accounts",
              "unauthenticated",
              "local",
              "profiles",
              "profile-a",
              "space-cache",
              "broken-a.json"
            ),
            "utf8"
          )
        ).resolves.toBe("{\n");
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

function toSafeSessionFile(value: string): string {
  const hash = createHash("sha1")
    .update(value, "utf8")
    .digest("hex")
    .slice(0, 8);
  const safeBaseRaw = value.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const safeBase = safeBaseRaw.length > 0 ? safeBaseRaw : "session";
  const truncatedBase = safeBase.slice(0, 119);
  return `${truncatedBase}-${hash}`;
}
