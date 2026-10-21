import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { MAX_PROFILE_WORKING_DIRECTORY_LENGTH } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  acquireLock,
  isOpenMeldLockError,
  releaseLock,
} from "../src/config/lock";
import {
  accountProfileLocalMetaPath,
  accountProfileWorkspacePath,
} from "../src/config/paths";
import {
  normalizeCustomProfileWorkspacePath,
  validateCustomProfileWorkspacePath,
} from "../src/profile-workspace/custom-path";
import { resolveProfileWorkspaceRuntimeForAccount } from "../src/profile-workspace/runtime-resolution";
import {
  ensureOpenMeldManagedProfileWorkspace,
  migrateLegacyProfileWorkspaceConfigIfNeeded,
  readProfileWorkspaceConfigForAccount,
  readSavedProfileWorkspaceForAccount,
  setCustomProfileWorkspace,
} from "../src/profile-workspace/service";
import { withTempHome } from "./helpers/fs";

const FALLBACK_ACCOUNT = {
  hostKey: "unauthenticated",
  userKey: "local",
} as const;

async function writeLocalMetaFile(input: {
  openMeldProfileId: string;
  payload: unknown;
}): Promise<string> {
  const path = accountProfileLocalMetaPath(
    FALLBACK_ACCOUNT,
    input.openMeldProfileId
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(input.payload, null, 2)}\n`, "utf8");
  return path;
}

async function readLocalMetaFile(openMeldProfileId: string): Promise<unknown> {
  const path = accountProfileLocalMetaPath(FALLBACK_ACCOUNT, openMeldProfileId);
  return JSON.parse(await readFile(path, "utf8"));
}

describe("profile workspace service", () => {
  it.each([
    "file",
    "read_only",
  ])("preserves the saved choice when managed preparation fails: %s", async (failure) => {
    await withTempHome(async (home) => {
      const openMeldProfileId = "agt-managed-preparation";
      const customWorkspacePath = join(home, "original-folder");
      await mkdir(customWorkspacePath);
      await setCustomProfileWorkspace({
        openMeldProfileId,
        customWorkspacePath,
      });
      const before = await readLocalMetaFile(openMeldProfileId);
      const managedPath = accountProfileWorkspacePath(
        FALLBACK_ACCOUNT,
        openMeldProfileId
      );
      await mkdir(dirname(managedPath), { recursive: true });
      if (failure === "file") {
        await writeFile(managedPath, "Keep this file");
      } else {
        await mkdir(managedPath);
        await chmod(managedPath, 0o555);
      }
      try {
        await expect(
          ensureOpenMeldManagedProfileWorkspace({ openMeldProfileId })
        ).rejects.toThrow();
        expect(await readLocalMetaFile(openMeldProfileId)).toEqual(before);
        // Old managed configurations must also fail inspection and dispatch,
        // rather than advertising a folder that cannot accept work.
        await writeLocalMetaFile({
          openMeldProfileId,
          payload: {
            v: 2,
            openMeldProfileId,
            updatedAt: new Date().toISOString(),
            workspace: { mode: "openmeld_managed" },
          },
        });
        for (const mode of ["inspect", "dispatch"] as const) {
          expect(
            await resolveProfileWorkspaceRuntimeForAccount({
              account: FALLBACK_ACCOUNT,
              openMeldProfileId,
              mode,
            })
          ).toMatchObject({
            status: "invalid",
            reasonCode: "workspace.invalid",
          });
        }
      } finally {
        if (failure === "read_only") {
          await chmod(managedPath, 0o755);
        }
      }
    });
  });
  it("keeps a native import observation separate from later explicit folder choices", async () => {
    await withTempHome(async (home) => {
      const profileId = "agt-imported-workspace";
      const original = join(home, "original-worktree");
      const retained = join(home, "retained-worktree");
      await mkdir(original);
      const importedSession = {
        agentControllerRef: "builtin:codex" as const,
        agentControllerConversationId: "thread-imported",
      };
      await setCustomProfileWorkspace({
        account: FALLBACK_ACCOUNT,
        openMeldProfileId: profileId,
        customWorkspacePath: original,
        importedSession,
        onlyIfUnconfigured: true,
      });
      expect(
        await readProfileWorkspaceConfigForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: profileId,
        })
      ).toMatchObject({
        origin: { kind: "imported_native_session", ...importedSession },
      });
      await rename(original, retained);
      expect(
        await resolveProfileWorkspaceRuntimeForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: profileId,
          mode: "inspect",
        })
      ).toMatchObject({ status: "invalid", reasonCode: "workspace.invalid" });
      await expect(access(original)).rejects.toThrow();
      expect(
        await readSavedProfileWorkspaceForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: profileId,
        })
      ).toMatchObject({
        status: "configured",
        configurationOrigin: "imported_native_session",
        workspacePath: original,
      });
      const importRetry = await setCustomProfileWorkspace({
        account: FALLBACK_ACCOUNT,
        openMeldProfileId: profileId,
        customWorkspacePath: retained,
        importedSession,
        onlyIfUnconfigured: true,
      });
      expect(importRetry).toMatchObject({
        changed: false,
        workspacePath: original,
      });
      await setCustomProfileWorkspace({
        account: FALLBACK_ACCOUNT,
        openMeldProfileId: profileId,
        customWorkspacePath: retained,
      });
      const explicit = await readProfileWorkspaceConfigForAccount({
        account: FALLBACK_ACCOUNT,
        openMeldProfileId: profileId,
      });
      expect(explicit).toMatchObject({
        origin: { kind: "explicit" },
        value: { mode: "custom", customWorkspacePath: retained },
      });
      expect(
        explicit.status === "valid" &&
          explicit.origin &&
          "agentControllerConversationId" in explicit.origin
      ).toBe(false);
      const laterImport = await setCustomProfileWorkspace({
        account: FALLBACK_ACCOUNT,
        openMeldProfileId: profileId,
        customWorkspacePath: retained,
        importedSession: {
          ...importedSession,
          agentControllerConversationId: "thread-second",
        },
        onlyIfUnconfigured: true,
      });
      expect(laterImport.changed).toBe(false);
      expect(
        await readSavedProfileWorkspaceForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: profileId,
        })
      ).toMatchObject({ configurationOrigin: "explicit" });
      const oldWriterEnvelope = (await readLocalMetaFile(profileId)) as Record<
        string,
        unknown
      >;
      await writeLocalMetaFile({
        openMeldProfileId: profileId,
        payload: {
          ...oldWriterEnvelope,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      });
      const historical = await readProfileWorkspaceConfigForAccount({
        account: FALLBACK_ACCOUNT,
        openMeldProfileId: profileId,
      });
      expect(historical).toMatchObject({
        status: "valid",
        value: { mode: "custom", customWorkspacePath: retained },
      });
      expect(
        historical.status === "valid" && historical.origin
      ).toBeUndefined();
    });
  });
  it("reads a valid v2 openmeld-managed workspace config", async () => {
    await withTempHome(async () => {
      const path = await writeLocalMetaFile({
        openMeldProfileId: "agt-workspace-managed",
        payload: {
          v: 2,
          openMeldProfileId: "agt-workspace-managed",
          updatedAt: "2026-04-13T00:00:00.000Z",
          workspace: {
            mode: "openmeld_managed",
          },
        },
      });

      await expect(
        readProfileWorkspaceConfigForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: "agt-workspace-managed",
        })
      ).resolves.toEqual({
        path,
        persistedVersion: 2,
        status: "valid",
        updatedAt: "2026-04-13T00:00:00.000Z",
        value: {
          mode: "openmeld_managed",
        },
      });
      await expect(
        readSavedProfileWorkspaceForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: "agt-workspace-managed",
        })
      ).resolves.toMatchObject({
        status: "configured",
        workspaceMode: "openmeld_managed",
        workspacePath: accountProfileWorkspacePath(
          FALLBACK_ACCOUNT,
          "agt-workspace-managed"
        ),
        configurationVersion: 2,
      });
      await expect(
        access(
          accountProfileWorkspacePath(FALLBACK_ACCOUNT, "agt-workspace-managed")
        )
      ).rejects.toThrow();
    });
  });

  it("reads a valid v2 custom workspace config", async () => {
    await withTempHome(async () => {
      const path = await writeLocalMetaFile({
        openMeldProfileId: "agt-workspace-custom",
        payload: {
          v: 2,
          openMeldProfileId: "agt-workspace-custom",
          updatedAt: "2026-04-13T00:00:00.000Z",
          workspace: {
            mode: "custom",
            customWorkspacePath: "/tmp/profile-custom",
          },
        },
      });

      await expect(
        readProfileWorkspaceConfigForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: "agt-workspace-custom",
        })
      ).resolves.toEqual({
        path,
        persistedVersion: 2,
        status: "valid",
        updatedAt: "2026-04-13T00:00:00.000Z",
        value: {
          customWorkspacePath: "/tmp/profile-custom",
          mode: "custom",
        },
      });
      await expect(
        readSavedProfileWorkspaceForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: "agt-workspace-custom",
        })
      ).resolves.toMatchObject({
        status: "configured",
        workspaceMode: "custom",
        workspacePath: "/tmp/profile-custom",
        configurationVersion: 2,
      });
    });
  });

  it("treats a v2 envelope without a workspace section as missing workspace config", async () => {
    await withTempHome(async () => {
      const path = await writeLocalMetaFile({
        openMeldProfileId: "agt-workspace-envelope-only",
        payload: {
          v: 2,
          openMeldProfileId: "agt-workspace-envelope-only",
          updatedAt: "2026-04-13T00:00:00.000Z",
          diagnostics: {
            lastCheckedAt: "2026-04-13T00:00:00.000Z",
          },
        },
      });

      await expect(
        readProfileWorkspaceConfigForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: "agt-workspace-envelope-only",
        })
      ).resolves.toEqual({
        path,
        status: "missing",
      });
      await expect(
        readSavedProfileWorkspaceForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: "agt-workspace-envelope-only",
        })
      ).resolves.toEqual({ status: "missing" });
    });
  });

  it("rejects a v2 openmeld-managed workspace that also stores a custom path", async () => {
    await withTempHome(async () => {
      const path = await writeLocalMetaFile({
        openMeldProfileId: "agt-workspace-invalid-managed",
        payload: {
          v: 2,
          openMeldProfileId: "agt-workspace-invalid-managed",
          updatedAt: "2026-04-13T00:00:00.000Z",
          workspace: {
            mode: "openmeld_managed",
            customWorkspacePath: "/tmp/should-not-exist",
          },
        },
      });

      await expect(
        readProfileWorkspaceConfigForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: "agt-workspace-invalid-managed",
        })
      ).resolves.toEqual({
        path,
        reason: "invalid_schema",
        status: "invalid",
      });
    });
  });

  it("rejects a v2 custom workspace without a custom path", async () => {
    await withTempHome(async () => {
      const path = await writeLocalMetaFile({
        openMeldProfileId: "agt-workspace-invalid-custom",
        payload: {
          v: 2,
          openMeldProfileId: "agt-workspace-invalid-custom",
          updatedAt: "2026-04-13T00:00:00.000Z",
          workspace: {
            mode: "custom",
          },
        },
      });

      await expect(
        readProfileWorkspaceConfigForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: "agt-workspace-invalid-custom",
        })
      ).resolves.toEqual({
        path,
        reason: "invalid_schema",
        status: "invalid",
      });
      await expect(
        readSavedProfileWorkspaceForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: "agt-workspace-invalid-custom",
        })
      ).resolves.toEqual({
        status: "invalid",
        reasonCode: "profile.workspace.invalid_schema",
      });
    });
  });

  it("maps a legacy v1 runtime working directory to openmeld-managed when it matches the canonical workspace path", async () => {
    await withTempHome(async () => {
      const openMeldProfileId = "agt-workspace-legacy-managed";
      const path = await writeLocalMetaFile({
        openMeldProfileId,
        payload: {
          v: 1,
          openMeldProfileId,
          providerRuntimeWorkingDirectory: accountProfileWorkspacePath(
            FALLBACK_ACCOUNT,
            openMeldProfileId
          ),
          updatedAt: "2026-04-13T00:00:00.000Z",
        },
      });

      const original = await readFile(path, "utf8");
      await expect(
        readSavedProfileWorkspaceForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId,
        })
      ).resolves.toMatchObject({
        status: "configured",
        workspaceMode: "openmeld_managed",
        configurationVersion: 1,
      });
      expect(await readFile(path, "utf8")).toBe(original);
      await expect(
        access(accountProfileWorkspacePath(FALLBACK_ACCOUNT, openMeldProfileId))
      ).rejects.toThrow();

      await expect(
        readProfileWorkspaceConfigForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId,
        })
      ).resolves.toEqual({
        path,
        persistedVersion: 1,
        status: "valid",
        updatedAt: "2026-04-13T00:00:00.000Z",
        value: {
          mode: "openmeld_managed",
        },
      });
    });
  });

  it("maps a legacy v1 runtime working directory to custom when it points elsewhere", async () => {
    await withTempHome(async () => {
      const path = await writeLocalMetaFile({
        openMeldProfileId: "agt-workspace-legacy-custom",
        payload: {
          v: 1,
          openMeldProfileId: "agt-workspace-legacy-custom",
          providerRuntimeWorkingDirectory: "/tmp/legacy-custom",
          updatedAt: "2026-04-13T00:00:00.000Z",
        },
      });

      await expect(
        readProfileWorkspaceConfigForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: "agt-workspace-legacy-custom",
        })
      ).resolves.toEqual({
        path,
        persistedVersion: 1,
        status: "valid",
        updatedAt: "2026-04-13T00:00:00.000Z",
        value: {
          customWorkspacePath: "/tmp/legacy-custom",
          mode: "custom",
        },
      });
    });
  });

  it("normalizes a tilde-prefixed custom workspace path", async () => {
    await withTempHome((home) => {
      expect(normalizeCustomProfileWorkspacePath("~/repo")).toBe(
        resolve(home, "repo")
      );
      return Promise.resolve();
    });
  });

  it("rejects relative custom workspace paths", () => {
    expect(() => normalizeCustomProfileWorkspacePath("./repo")).toThrow(
      "must be an absolute path"
    );
    expect(() => normalizeCustomProfileWorkspacePath("../repo")).toThrow(
      "must be an absolute path"
    );
  });

  it("rejects empty, NUL, and overlong custom workspace paths", () => {
    expect(() => normalizeCustomProfileWorkspacePath("   ")).toThrow(
      "not a valid working directory string"
    );
    expect(() =>
      normalizeCustomProfileWorkspacePath("/tmp/profile\u0000workspace")
    ).toThrow("not a valid working directory string");
    expect(() =>
      normalizeCustomProfileWorkspacePath(
        `/tmp/${"x".repeat(MAX_PROFILE_WORKING_DIRECTORY_LENGTH + 1)}`
      )
    ).toThrow("not a valid working directory string");
  });

  it("validates that a custom workspace path exists", async () => {
    await withTempHome(async (home) => {
      const missingPath = join(home, "missing-workspace");
      await expect(
        validateCustomProfileWorkspacePath(missingPath)
      ).resolves.toEqual({
        path: missingPath,
        reason: "not_found",
        status: "invalid",
      });
    });
  });

  it("rejects custom workspace paths that point to files", async () => {
    await withTempHome(async (home) => {
      const filePath = join(home, "workspace.txt");
      await writeFile(filePath, "workspace\n", "utf8");

      await expect(
        validateCustomProfileWorkspacePath(filePath)
      ).resolves.toEqual({
        path: filePath,
        reason: "not_directory",
        status: "invalid",
      });
    });
  });

  it("rejects custom workspace paths without rwx access", async () => {
    await withTempHome(async (home) => {
      if (process.platform === "win32") {
        return;
      }

      const dirPath = join(home, "locked-workspace");
      await mkdir(dirPath, { recursive: true });
      await chmod(dirPath, 0o000);
      try {
        await expect(
          validateCustomProfileWorkspacePath(dirPath)
        ).resolves.toEqual({
          path: dirPath,
          reason: "not_accessible",
          status: "invalid",
        });
      } finally {
        await chmod(dirPath, 0o700);
      }
    });
  });

  it.each([
    "valid-workspace",
    "Design 中文 ",
  ])("saves and reads the exact readable custom folder (%s)", async (name) => {
    await withTempHome(async (home) => {
      const dirPath = join(home, name);
      await mkdir(dirPath, { recursive: true });

      await expect(
        validateCustomProfileWorkspacePath(dirPath)
      ).resolves.toEqual({
        status: "valid",
        value: dirPath,
      });
      const profileId = "agt-exact-custom-path";
      await expect(
        setCustomProfileWorkspace({
          openMeldProfileId: profileId,
          customWorkspacePath: dirPath,
        })
      ).resolves.toMatchObject({ workspacePath: dirPath });
      await expect(
        readSavedProfileWorkspaceForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: profileId,
        })
      ).resolves.toMatchObject({
        status: "configured",
        workspaceMode: "custom",
        workspacePath: dirPath,
      });
      await expect(
        resolveProfileWorkspaceRuntimeForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: profileId,
          mode: "inspect",
        })
      ).resolves.toMatchObject({
        status: "ready",
        configuredWorkspacePath: dirPath,
        effectiveRuntimeWorkingDirectory: dirPath,
      });
    });
  });

  it("ensures the openmeld-managed workspace directory and writes a v2 envelope", async () => {
    await withTempHome(async () => {
      const openMeldProfileId = "agt-workspace-ensure-managed";
      const firstResult = await ensureOpenMeldManagedProfileWorkspace({
        openMeldProfileId,
      });
      const secondResult = await ensureOpenMeldManagedProfileWorkspace({
        openMeldProfileId,
      });

      expect(firstResult.workspacePath).toBe(
        accountProfileWorkspacePath(FALLBACK_ACCOUNT, openMeldProfileId)
      );
      expect(secondResult.workspacePath).toBe(firstResult.workspacePath);

      await expect(
        readProfileWorkspaceConfigForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId,
        })
      ).resolves.toMatchObject({
        persistedVersion: 2,
        status: "valid",
        value: {
          mode: "openmeld_managed",
        },
      });

      await expect(readLocalMetaFile(openMeldProfileId)).resolves.toEqual({
        defaultFolderId: expect.any(String),
        foldersRevision: 2, // ensured twice
        folders: [
          {
            displayName: "OpenMeld folder",
            id: expect.any(String),
            kind: "openmeld_managed",
          },
        ],
        openMeldProfileId,
        updatedAt: expect.any(String),
        v: 2,
        workspace: {
          mode: "openmeld_managed",
        },
      });
    });
  });

  it("initializes setup once and preserves a later custom choice even when its folder is missing", async () => {
    await withTempHome(async (home) => {
      const openMeldProfileId = "agt-workspace-initialize";
      expect(
        await ensureOpenMeldManagedProfileWorkspace({
          openMeldProfileId,
          onlyIfUnconfigured: true,
        })
      ).toMatchObject({ changed: true, value: { mode: "openmeld_managed" } });
      const customWorkspacePath = join(home, "chosen-repo");
      await mkdir(customWorkspacePath);
      const chosen = await setCustomProfileWorkspace({
        customWorkspacePath,
        openMeldProfileId,
      });
      await rm(customWorkspacePath, { recursive: true });
      const before = await readLocalMetaFile(openMeldProfileId);
      expect(
        await ensureOpenMeldManagedProfileWorkspace({
          openMeldProfileId,
          onlyIfUnconfigured: true,
        })
      ).toEqual({ ...chosen, changed: false });
      expect(await readLocalMetaFile(openMeldProfileId)).toEqual(before);
    });
  });

  it("rejects setup initialization without replacing invalid saved folder settings", async () => {
    await withTempHome(async () => {
      const openMeldProfileId = "agt-workspace-initialize-invalid";
      const payload = {
        openMeldProfileId,
        updatedAt: "2026-10-09T04:00:00.000Z",
        v: 2,
        workspace: { mode: "unknown" },
      };
      await writeLocalMetaFile({ openMeldProfileId, payload });
      await expect(
        ensureOpenMeldManagedProfileWorkspace({
          openMeldProfileId,
          onlyIfUnconfigured: true,
        })
      ).rejects.toThrow("The working folder settings are invalid");
      expect(await readLocalMetaFile(openMeldProfileId)).toEqual(payload);
    });
  });

  it("preserves unrelated top-level envelope sections when workspace config changes", async () => {
    await withTempHome(async (home) => {
      const openMeldProfileId = "agt-workspace-envelope-preserve";
      const customWorkspacePath = join(home, "repo-b");
      await mkdir(customWorkspacePath, { recursive: true });
      await writeLocalMetaFile({
        openMeldProfileId,
        payload: {
          v: 2,
          openMeldProfileId,
          updatedAt: "2026-04-13T00:00:00.000Z",
          diagnostics: {
            lastCheckedAt: "2026-04-12T23:59:59.000Z",
          },
          workspace: {
            mode: "openmeld_managed",
          },
        },
      });

      await setCustomProfileWorkspace({
        openMeldProfileId,
        customWorkspacePath,
      });

      await expect(readLocalMetaFile(openMeldProfileId)).resolves.toEqual({
        defaultFolderId: expect.any(String),
        foldersRevision: 1,
        // The previous managed choice stays listed next to the new default.
        folders: [
          {
            displayName: "OpenMeld folder",
            id: expect.any(String),
            kind: "openmeld_managed",
          },
          {
            displayName: "repo-b",
            id: expect.any(String),
            kind: "custom",
            path: customWorkspacePath,
          },
        ],
        openMeldProfileId,
        diagnostics: {
          lastCheckedAt: "2026-04-12T23:59:59.000Z",
        },
        updatedAt: expect.any(String),
        v: 2,
        workspace: {
          customWorkspacePath,
          mode: "custom",
        },
        workspaceOrigin: {
          kind: "explicit",
          configurationUpdatedAt: expect.any(String),
        },
      });
    });
  });

  it("migrates a legacy v1 file to the v2 workspace envelope", async () => {
    await withTempHome(async () => {
      const openMeldProfileId = "agt-workspace-migrate";
      await writeLocalMetaFile({
        openMeldProfileId,
        payload: {
          v: 1,
          openMeldProfileId,
          providerRuntimeWorkingDirectory: "/tmp/migrated-custom",
          updatedAt: "2026-04-13T00:00:00.000Z",
        },
      });

      await expect(
        migrateLegacyProfileWorkspaceConfigIfNeeded({
          openMeldProfileId,
        })
      ).resolves.toEqual({
        path: accountProfileLocalMetaPath(FALLBACK_ACCOUNT, openMeldProfileId),
        status: "migrated",
        value: {
          customWorkspacePath: "/tmp/migrated-custom",
          mode: "custom",
        },
      });

      await expect(readLocalMetaFile(openMeldProfileId)).resolves.toEqual({
        defaultFolderId: expect.any(String),
        foldersRevision: 1,
        folders: [
          {
            displayName: "migrated-custom",
            id: expect.any(String),
            kind: "custom",
            path: "/tmp/migrated-custom",
          },
        ],
        openMeldProfileId,
        updatedAt: expect.any(String),
        v: 2,
        workspace: {
          customWorkspacePath: "/tmp/migrated-custom",
          mode: "custom",
        },
      });
    });
  });

  it("reports workspace.missing when no local workspace config exists", async () => {
    await withTempHome(async () => {
      await expect(
        resolveProfileWorkspaceRuntimeForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: "agt-workspace-runtime-missing",
          mode: "inspect",
        })
      ).resolves.toEqual({
        configPath: accountProfileLocalMetaPath(
          FALLBACK_ACCOUNT,
          "agt-workspace-runtime-missing"
        ),
        configuredWorkspacePath: null,
        reasonCode: "workspace.missing",
        reasonText: expect.stringContaining(
          "Profile workspace config is missing"
        ),
        status: "missing",
        workspaceMode: null,
      });
    });
  });

  it("reports workspace.invalid when a custom workspace path is unavailable", async () => {
    await withTempHome(async () => {
      const openMeldProfileId = "agt-workspace-runtime-invalid";
      await writeLocalMetaFile({
        openMeldProfileId,
        payload: {
          v: 2,
          openMeldProfileId,
          updatedAt: "2026-04-13T00:00:00.000Z",
          workspace: {
            mode: "custom",
            customWorkspacePath: "/tmp/does-not-exist",
          },
        },
      });

      await expect(
        resolveProfileWorkspaceRuntimeForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId,
          mode: "inspect",
        })
      ).resolves.toEqual({
        configPath: accountProfileLocalMetaPath(
          FALLBACK_ACCOUNT,
          openMeldProfileId
        ),
        configuredWorkspacePath: "/tmp/does-not-exist",
        reasonCode: "workspace.invalid",
        reasonText: expect.stringContaining("does not exist"),
        status: "invalid",
        workspaceMode: "custom",
      });
    });
  });

  it("treats openmeld-managed workspace config as ready in inspect mode even before the directory exists", async () => {
    await withTempHome(async () => {
      const openMeldProfileId = "agt-workspace-runtime-inspect-managed";
      await writeLocalMetaFile({
        openMeldProfileId,
        payload: {
          v: 2,
          openMeldProfileId,
          updatedAt: "2026-04-13T00:00:00.000Z",
          workspace: {
            mode: "openmeld_managed",
          },
        },
      });

      await expect(
        resolveProfileWorkspaceRuntimeForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId,
          mode: "inspect",
        })
      ).resolves.toEqual({
        configPath: accountProfileLocalMetaPath(
          FALLBACK_ACCOUNT,
          openMeldProfileId
        ),
        configuredWorkspacePath: accountProfileWorkspacePath(
          FALLBACK_ACCOUNT,
          openMeldProfileId
        ),
        effectiveRuntimeWorkingDirectory: accountProfileWorkspacePath(
          FALLBACK_ACCOUNT,
          openMeldProfileId
        ),
        runtimeContext: {
          providerRuntimeWorkingDirectory: accountProfileWorkspacePath(
            FALLBACK_ACCOUNT,
            openMeldProfileId
          ),
        },
        status: "ready",
        workspaceMode: "openmeld_managed",
      });
    });
  });

  it("ensures the openmeld-managed directory in dispatch mode before returning runtime context", async () => {
    await withTempHome(async () => {
      const openMeldProfileId = "agt-workspace-runtime-dispatch-managed";
      await writeLocalMetaFile({
        openMeldProfileId,
        payload: {
          v: 2,
          openMeldProfileId,
          updatedAt: "2026-04-13T00:00:00.000Z",
          workspace: {
            mode: "openmeld_managed",
          },
        },
      });

      await expect(
        resolveProfileWorkspaceRuntimeForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId,
          mode: "dispatch",
        })
      ).resolves.toEqual({
        configPath: accountProfileLocalMetaPath(
          FALLBACK_ACCOUNT,
          openMeldProfileId
        ),
        configuredWorkspacePath: accountProfileWorkspacePath(
          FALLBACK_ACCOUNT,
          openMeldProfileId
        ),
        effectiveRuntimeWorkingDirectory: accountProfileWorkspacePath(
          FALLBACK_ACCOUNT,
          openMeldProfileId
        ),
        runtimeContext: {
          providerRuntimeWorkingDirectory: accountProfileWorkspacePath(
            FALLBACK_ACCOUNT,
            openMeldProfileId
          ),
        },
        status: "ready",
        workspaceMode: "openmeld_managed",
      });
      await expect(
        access(accountProfileWorkspacePath(FALLBACK_ACCOUNT, openMeldProfileId))
      ).resolves.toBeUndefined();
    });
  });

  it("uses the profile lock to prevent competing writes from corrupting local-meta", async () => {
    await withTempHome(async (home) => {
      const openMeldProfileId = "agt-workspace-lock";
      const customWorkspacePath = join(home, "repo-a");
      await mkdir(customWorkspacePath, { recursive: true });
      await ensureOpenMeldManagedProfileWorkspace({ openMeldProfileId });

      const lock = await acquireLock({
        openMeldProfileId,
        key: "profile-workspace-config",
      });

      try {
        await expect(
          setCustomProfileWorkspace({
            openMeldProfileId,
            customWorkspacePath,
          })
        ).rejects.toSatisfy((error: unknown) => isOpenMeldLockError(error));

        await expect(readLocalMetaFile(openMeldProfileId)).resolves.toEqual({
          defaultFolderId: expect.any(String),
          foldersRevision: 1,
          folders: [
            {
              displayName: "OpenMeld folder",
              id: expect.any(String),
              kind: "openmeld_managed",
            },
          ],
          openMeldProfileId,
          updatedAt: expect.any(String),
          v: 2,
          workspace: {
            mode: "openmeld_managed",
          },
        });
      } finally {
        await releaseLock(lock);
      }
    });
  });
});
