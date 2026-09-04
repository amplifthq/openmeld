import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MAX_PROFILE_WORKING_DIRECTORY_LENGTH } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { bindProject } from "../src/agent-activity/project-bindings";
import {
  accountProfileLocalMetaPath,
  accountProfileWorkspacePath,
} from "../src/config/paths";
import {
  readProfileLocalMeta,
  readProfileLocalMetaForAccount,
} from "../src/config/profile-local-meta";
import { resolveDispatchRuntimeContext } from "../src/local-service/execution/dispatch-runtime-preparation";
import { resolveCurrentEffectiveProfileWorkingFolderRuntime } from "../src/profile-workspace/effective-runtime-resolution";
import { withTempHome } from "./helpers/fs";

const FALLBACK_ACCOUNT = {
  hostKey: "unauthenticated",
  userKey: "local",
} as const;

const writeLocalMetaFile = async (input: {
  openMeldProfileId: string;
  payload: unknown;
}) => {
  const path = accountProfileLocalMetaPath(
    FALLBACK_ACCOUNT,
    input.openMeldProfileId
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(input.payload, null, 2)}\n`, "utf8");
  return path;
};

describe("profile local meta", () => {
  it("reads a valid provider runtime working directory", async () => {
    await withTempHome(async () => {
      const path = await writeLocalMetaFile({
        openMeldProfileId: "agt-runtime-meta",
        payload: {
          v: 1,
          openMeldProfileId: "agt-runtime-meta",
          providerRuntimeWorkingDirectory: "/tmp/provider-runtime",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      });

      await expect(
        readProfileLocalMetaForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId: "agt-runtime-meta",
        })
      ).resolves.toEqual({
        path,
        status: "valid",
        value: {
          v: 1,
          openMeldProfileId: "agt-runtime-meta",
          providerRuntimeWorkingDirectory: "/tmp/provider-runtime",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      });
    });
  });

  it("returns missing when local-meta.json does not exist", async () => {
    await withTempHome(async () => {
      await expect(
        readProfileLocalMeta("agt-runtime-missing")
      ).resolves.toMatchObject({
        status: "missing",
      });
    });
  });

  it("maps a v2 openmeld-managed workspace envelope back to the legacy runtime working directory view", async () => {
    await withTempHome(async () => {
      const openMeldProfileId = "agt-runtime-v2-managed";
      const path = await writeLocalMetaFile({
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
        readProfileLocalMetaForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId,
        })
      ).resolves.toEqual({
        path,
        status: "valid",
        value: {
          v: 1,
          openMeldProfileId,
          providerRuntimeWorkingDirectory: accountProfileWorkspacePath(
            FALLBACK_ACCOUNT,
            openMeldProfileId
          ),
          updatedAt: "2026-04-13T00:00:00.000Z",
        },
      });
    });
  });

  it("maps a v2 custom workspace envelope back to the legacy runtime working directory view", async () => {
    await withTempHome(async () => {
      const openMeldProfileId = "agt-runtime-v2-custom";
      const path = await writeLocalMetaFile({
        openMeldProfileId,
        payload: {
          v: 2,
          openMeldProfileId,
          updatedAt: "2026-04-13T00:00:00.000Z",
          workspace: {
            mode: "custom",
            customWorkspacePath: "/tmp/runtime-v2-custom",
          },
        },
      });

      await expect(
        readProfileLocalMetaForAccount({
          account: FALLBACK_ACCOUNT,
          openMeldProfileId,
        })
      ).resolves.toEqual({
        path,
        status: "valid",
        value: {
          v: 1,
          openMeldProfileId,
          providerRuntimeWorkingDirectory: "/tmp/runtime-v2-custom",
          updatedAt: "2026-04-13T00:00:00.000Z",
        },
      });
    });
  });

  it("rejects dispatch runtime resolution when workspace config is missing", async () => {
    await withTempHome(async () => {
      await expect(
        resolveDispatchRuntimeContext({
          openMeldProfileId: "agt-runtime-missing",
        })
      ).rejects.toThrow("profile.workspace.missing");
    });
  });

  it("keeps existing workspace resolution unchanged without a Default Project", async () => {
    await withTempHome(async (home) => {
      const workspacePath = join(home, "existing-workspace");
      await mkdir(workspacePath, { recursive: true });
      await writeLocalMetaFile({
        openMeldProfileId: "agt-runtime-without-default-project",
        payload: {
          v: 2,
          openMeldProfileId: "agt-runtime-without-default-project",
          updatedAt: "2026-07-14T00:00:00.000Z",
          workspace: {
            mode: "custom",
            customWorkspacePath: workspacePath,
          },
        },
      });

      await expect(
        resolveDispatchRuntimeContext({
          defaultProjectId: null,
          openMeldProfileId: "agt-runtime-without-default-project",
        })
      ).resolves.toEqual({
        providerRuntimeWorkingDirectory: workspacePath,
      });
      await expect(
        resolveCurrentEffectiveProfileWorkingFolderRuntime({
          defaultProjectId: null,
          mode: "inspect",
          openMeldProfileId: "agt-runtime-without-default-project",
        })
      ).resolves.toMatchObject({
        effectiveRuntimeWorkingDirectory: workspacePath,
        workingFolderFact: {
          defaultProjectId: null,
          localProjectBindingGeneration: null,
          observedAtMs: expect.any(Number),
          reasonCode: null,
          source: "profile_workspace",
          status: "ready",
        },
        workingFolderSource: "profile_workspace",
      });
    });
  });

  it("fails closed when a Default Project has no local connection", async () => {
    await withTempHome(async () => {
      await expect(
        resolveCurrentEffectiveProfileWorkingFolderRuntime({
          defaultProjectId: "project-missing",
          mode: "inspect",
          openMeldProfileId: "agt-project-missing",
        })
      ).resolves.toMatchObject({
        status: "missing",
        workingFolderFact: {
          defaultProjectId: "project-missing",
          localProjectBindingGeneration: null,
          observedAtMs: expect.any(Number),
          reasonCode: "project.local_connection.missing",
          source: "default_project",
          status: "missing",
        },
      });
      await expect(
        resolveDispatchRuntimeContext({
          defaultProjectId: "project-missing",
          openMeldProfileId: "agt-project-missing",
        })
      ).rejects.toMatchObject({
        code: "project.local_connection.missing",
        message: "project.local_connection.missing",
        projectFailureContext: {
          projectId: "project-missing",
        },
      });
    });
  });

  it("fails closed when the Default Project folder has disappeared", async () => {
    await withTempHome(async (home) => {
      const repositoryPath = join(home, "missing-project-folder");
      await mkdir(repositoryPath, { recursive: true });
      const connection = await bindProject({
        organizationId: "org-1",
        projectId: "project-folder-missing",
        projectSlug: "folder-missing",
        repositoryFingerprint: null,
        repositoryPath,
      });
      await rm(repositoryPath, { recursive: true });

      await expect(
        resolveCurrentEffectiveProfileWorkingFolderRuntime({
          defaultProjectId: "project-folder-missing",
          mode: "inspect",
          openMeldProfileId: "agt-project-folder-missing",
        })
      ).resolves.toMatchObject({
        status: "missing",
        workingFolderFact: {
          defaultProjectId: "project-folder-missing",
          localProjectBindingGeneration: connection.bindingGeneration,
          observedAtMs: expect.any(Number),
          reasonCode: "project.local_connection.folder_missing",
          source: "default_project",
          status: "missing",
        },
      });

      await expect(
        resolveDispatchRuntimeContext({
          defaultProjectId: "project-folder-missing",
          openMeldProfileId: "agt-project-folder-missing",
        })
      ).rejects.toMatchObject({
        code: "project.local_connection.folder_missing",
        message: "project.local_connection.folder_missing",
        projectFailureContext: {
          bindingGeneration: expect.any(String),
          projectId: "project-folder-missing",
        },
      });
    });
  });

  it("uses the available default Project connection as the working folder", async () => {
    await withTempHome(async (home) => {
      const repositoryPath = join(home, "available-project-folder");
      await mkdir(repositoryPath, { recursive: true });
      const connection = await bindProject({
        organizationId: "org-1",
        projectId: "project-available",
        projectSlug: "available",
        repositoryFingerprint: null,
        repositoryPath,
      });

      await expect(
        resolveDispatchRuntimeContext({
          defaultProjectId: "project-available",
          openMeldProfileId: "agt-project-available",
        })
      ).resolves.toEqual({
        providerRuntimeWorkingDirectory: connection.repositoryPath,
      });
      await expect(
        resolveCurrentEffectiveProfileWorkingFolderRuntime({
          defaultProjectId: "project-available",
          mode: "inspect",
          openMeldProfileId: "agt-project-available",
        })
      ).resolves.toMatchObject({
        configuredWorkspacePath: connection.repositoryPath,
        defaultProjectId: "project-available",
        effectiveRuntimeWorkingDirectory: connection.repositoryPath,
        status: "ready",
        workingFolderFact: {
          defaultProjectId: "project-available",
          localProjectBindingGeneration: connection.bindingGeneration,
          observedAtMs: expect.any(Number),
          reasonCode: null,
          source: "default_project",
          status: "ready",
        },
        workingFolderSource: "default_project",
        workspaceMode: null,
      });
    });
  });

  it("rejects invalid local metadata JSON", async () => {
    await withTempHome(async () => {
      const path = accountProfileLocalMetaPath(
        FALLBACK_ACCOUNT,
        "agt-runtime-invalid-json"
      );
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "{not-json}\n", "utf8");

      await expect(
        resolveDispatchRuntimeContext({
          openMeldProfileId: "agt-runtime-invalid-json",
        })
      ).rejects.toThrow("profile.workspace.invalid");
    });
  });

  it("rejects profile local metadata with a mismatched openMeldProfileId", async () => {
    await withTempHome(async () => {
      await writeLocalMetaFile({
        openMeldProfileId: "agt-runtime-target",
        payload: {
          v: 1,
          openMeldProfileId: "agt-other-profile",
          providerRuntimeWorkingDirectory: "/tmp/provider-runtime",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      });

      await expect(
        resolveDispatchRuntimeContext({
          openMeldProfileId: "agt-runtime-target",
        })
      ).rejects.toThrow("profile.workspace.invalid");
    });
  });

  it("rejects profile local metadata with an invalid provider runtime working directory", async () => {
    await withTempHome(async () => {
      await writeLocalMetaFile({
        openMeldProfileId: "agt-runtime-invalid-cwd",
        payload: {
          v: 1,
          openMeldProfileId: "agt-runtime-invalid-cwd",
          providerRuntimeWorkingDirectory: "   ",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      });

      await expect(
        resolveDispatchRuntimeContext({
          openMeldProfileId: "agt-runtime-invalid-cwd",
        })
      ).rejects.toThrow("profile.workspace.invalid");
    });
  });

  it("rejects profile local metadata with an overlong provider runtime working directory", async () => {
    await withTempHome(async () => {
      await writeLocalMetaFile({
        openMeldProfileId: "agt-runtime-overlong-cwd",
        payload: {
          v: 1,
          openMeldProfileId: "agt-runtime-overlong-cwd",
          providerRuntimeWorkingDirectory: `/tmp/${"x".repeat(MAX_PROFILE_WORKING_DIRECTORY_LENGTH)}`,
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      });

      await expect(
        resolveDispatchRuntimeContext({
          openMeldProfileId: "agt-runtime-overlong-cwd",
        })
      ).rejects.toThrow("profile.workspace.invalid");
    });
  });

  it("rejects profile local metadata with a NUL byte in provider runtime working directory", async () => {
    await withTempHome(async () => {
      await writeLocalMetaFile({
        openMeldProfileId: "agt-runtime-nul-cwd",
        payload: {
          v: 1,
          openMeldProfileId: "agt-runtime-nul-cwd",
          providerRuntimeWorkingDirectory: "/tmp/provider-runtime\u0000blocked",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      });

      await expect(
        resolveDispatchRuntimeContext({
          openMeldProfileId: "agt-runtime-nul-cwd",
        })
      ).rejects.toThrow("profile.workspace.invalid");
    });
  });
});
