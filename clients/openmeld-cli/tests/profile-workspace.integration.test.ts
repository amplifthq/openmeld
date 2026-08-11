import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
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

  it("accepts existing readable custom workspace directories", async () => {
    await withTempHome(async (home) => {
      const dirPath = join(home, "valid-workspace");
      await mkdir(dirPath, { recursive: true });

      await expect(
        validateCustomProfileWorkspacePath(dirPath)
      ).resolves.toEqual({
        status: "valid",
        value: dirPath,
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
        openMeldProfileId,
        updatedAt: expect.any(String),
        v: 2,
        workspace: {
          mode: "openmeld_managed",
        },
      });
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
