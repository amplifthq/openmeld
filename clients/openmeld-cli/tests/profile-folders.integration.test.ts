import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { profileFolderProjectionSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { isOpenMeldLockError } from "../src/config/lock";
import {
  accountProfileLocalMetaPath,
  accountProfileWorkspacePath,
  resolveOpenMeldRootDir,
} from "../src/config/paths";
import { buildProfileFolderRejection } from "../src/local-service/carrier/manage-profile-folders";
import {
  applyProfileFolderOperation,
  ProfileFolderOperationError,
  projectProfileFolderList,
  readProfileFolderDisplayName,
  resolveProfileFolderRuntimeForAccount,
} from "../src/profile-workspace/folders";
import {
  deriveProfileFolderId,
  readProfileFolderListForAccount,
  readProfileWorkspaceConfigForAccount,
  setCustomProfileWorkspace,
  setOpenMeldManagedProfileWorkspace,
} from "../src/profile-workspace/service";
import { withTempHome } from "./helpers/fs";

const ACCOUNT = { hostKey: "unauthenticated", userKey: "local" } as const;
const PROFILE_ID = "agt-folder-profile";

async function writeEnvelope(payload: unknown): Promise<string> {
  const path = accountProfileLocalMetaPath(ACCOUNT, PROFILE_ID);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return path;
}

async function writeProjectBindingStore(payload: unknown): Promise<void> {
  const path = join(
    resolveOpenMeldRootDir(),
    "device",
    "agent-activity",
    "project-bindings.json"
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function readProjectBindingStore(): Promise<{
  bindings: Array<Record<string, unknown> & { ownerUserId?: string }>;
}> {
  return JSON.parse(
    await readFile(
      join(
        resolveOpenMeldRootDir(),
        "device",
        "agent-activity",
        "project-bindings.json"
      ),
      "utf8"
    )
  );
}

async function readEnvelope(): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(accountProfileLocalMetaPath(ACCOUNT, PROFILE_ID), "utf8")
  ) as Record<string, unknown>;
}

/**
 * The parse rules of a Service released before folders existed: only `v: 2`
 * is accepted and `workspace` has exactly its v2 keys. Extra top-level keys
 * are ignored, and its writer keeps them while it replaces `workspace`.
 */
function readAsOlderService(envelope: Record<string, unknown>) {
  if (envelope.v !== 2) {
    return { status: "invalid" as const };
  }
  const workspace = envelope.workspace as Record<string, unknown> | undefined;
  if (!workspace) {
    return { status: "missing" as const };
  }
  const keys = Object.keys(workspace).sort();
  if (workspace.mode === "openmeld_managed" && keys.join() === "mode") {
    return { status: "valid" as const, value: { mode: "openmeld_managed" } };
  }
  if (
    workspace.mode === "custom" &&
    keys.join() === "customWorkspacePath,mode" &&
    typeof workspace.customWorkspacePath === "string"
  ) {
    return {
      status: "valid" as const,
      value: {
        customWorkspacePath: workspace.customWorkspacePath,
        mode: "custom",
      },
    };
  }
  return { status: "invalid" as const };
}

describe("profile folders", () => {
  it("reads a v2 envelope as a one-element folder list without rewriting it", async () => {
    await withTempHome(async (home) => {
      const folder = join(home, "repo-one");
      await mkdir(folder);
      const path = await writeEnvelope({
        openMeldProfileId: PROFILE_ID,
        updatedAt: "2026-10-01T00:00:00.000Z",
        v: 2,
        workspace: { customWorkspacePath: folder, mode: "custom" },
      });
      const before = await stat(path);

      const first = await readProfileFolderListForAccount({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
      });
      const second = await readProfileFolderListForAccount({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
      });

      const expectedId = deriveProfileFolderId({
        openMeldProfileId: PROFILE_ID,
        workspace: { customWorkspacePath: folder, mode: "custom" },
      });
      expect(first).toMatchObject({
        list: {
          defaultFolderId: expectedId,
          folders: [
            {
              displayName: "repo-one",
              id: expectedId,
              kind: "custom",
              path: folder,
            },
          ],
        },
        persistedVersion: 2,
        status: "valid",
      });
      expect(second).toEqual(first);
      // The derived id is a valid cloud folder id.
      if (first.status === "valid") {
        expect(projectProfileFolderList(first.list, 0).defaultFolderId).toBe(
          expectedId
        );
      }
      expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
      expect(await readEnvelope()).not.toHaveProperty("folders");
    });
  });

  it("reads a v1 envelope as a one-element folder list", async () => {
    await withTempHome(async () => {
      await writeEnvelope({
        openMeldProfileId: PROFILE_ID,
        providerRuntimeWorkingDirectory: accountProfileWorkspacePath(
          ACCOUNT,
          PROFILE_ID
        ),
        updatedAt: "2026-10-01T00:00:00.000Z",
        v: 1,
      });
      const result = await readProfileFolderListForAccount({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
      });
      expect(result).toMatchObject({
        list: { folders: [{ kind: "openmeld_managed" }] },
        persistedVersion: 1,
        status: "valid",
      });
      expect(await readEnvelope()).toMatchObject({ v: 1 });
    });
  });

  it("names a task's folder by display name, never its path", async () => {
    await withTempHome(async (home) => {
      const first = join(home, "first");
      const second = join(home, "second");
      await mkdir(first);
      await mkdir(second);
      await setCustomProfileWorkspace({
        account: ACCOUNT,
        customWorkspacePath: first,
        openMeldProfileId: PROFILE_ID,
      });
      const added = await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: { operation: "add_custom", path: second },
      });
      const read = (folderId?: string) =>
        readProfileFolderDisplayName({
          account: ACCOUNT,
          ...(folderId ? { folderId } : {}),
          openMeldProfileId: PROFILE_ID,
        });
      // No selection: the Profile default.
      expect(await read()).toBe("first");
      expect(await read(added.folderId ?? "")).toBe("second");
      expect(await read("6f1f1d0e-8f8e-4a59-9c39-7d2b8c1e4a11")).toBeNull();
      expect(await read()).not.toContain(home);
    });
  });

  it("never names a folder after this computer's account or home directory", async () => {
    await withTempHome(async (home) => {
      const named = join(home, userInfo().username);
      await mkdir(named);
      await setCustomProfileWorkspace({
        account: ACCOUNT,
        customWorkspacePath: named,
        openMeldProfileId: PROFILE_ID,
      });
      expect(
        await readProfileFolderDisplayName({
          account: ACCOUNT,
          openMeldProfileId: PROFILE_ID,
        })
      ).toBeNull();
    });
  });

  it("keeps a v2 mirror of the default folder that an older Service resolves", async () => {
    await withTempHome(async (home) => {
      const first = join(home, "first");
      const second = join(home, "second");
      await mkdir(first);
      await mkdir(second);
      await setCustomProfileWorkspace({
        account: ACCOUNT,
        customWorkspacePath: first,
        openMeldProfileId: PROFILE_ID,
      });
      const added = await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: { operation: "add_custom", path: second },
      });
      // Adding a folder does not change the default or its mirror.
      expect(readAsOlderService(await readEnvelope())).toEqual({
        status: "valid",
        value: { customWorkspacePath: first, mode: "custom" },
      });

      await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: { folderId: added.folderId ?? "", operation: "set_default" },
      });
      const envelope = await readEnvelope();
      expect(envelope).toMatchObject({
        defaultFolderId: added.folderId,
        v: 2,
        workspace: { customWorkspacePath: second, mode: "custom" },
      });
      expect(readAsOlderService(envelope)).toEqual({
        status: "valid",
        value: { customWorkspacePath: second, mode: "custom" },
      });

      await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: { operation: "add_openmeld_managed" },
      });
      const managed = (
        await applyProfileFolderOperation({
          account: ACCOUNT,
          openMeldProfileId: PROFILE_ID,
          operation: { operation: "list" },
        })
      ).projection.folders.find((folder) => folder.kind === "openmeld_managed");
      await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: {
          folderId: managed?.folderId ?? "",
          operation: "set_default",
        },
      });
      expect(readAsOlderService(await readEnvelope())).toEqual({
        status: "valid",
        value: { mode: "openmeld_managed" },
      });
    });
  });

  it("follows the mirror when an older Service changed the default", async () => {
    await withTempHome(async (home) => {
      const first = join(home, "first");
      const elsewhere = join(home, "elsewhere");
      await mkdir(first);
      await mkdir(elsewhere);
      await setCustomProfileWorkspace({
        account: ACCOUNT,
        customWorkspacePath: first,
        openMeldProfileId: PROFILE_ID,
      });
      await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: { operation: "add_openmeld_managed" },
      });
      // An older writer keeps unknown keys and replaces only the v2 fields.
      const envelope = await readEnvelope();
      await writeEnvelope({
        ...envelope,
        updatedAt: "2026-10-02T00:00:00.000Z",
        workspace: { customWorkspacePath: elsewhere, mode: "custom" },
        workspaceOrigin: undefined,
      });

      const result = await readProfileFolderListForAccount({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
      });
      expect(result.status).toBe("valid");
      if (result.status !== "valid") {
        return;
      }
      const defaultFolder = result.list.folders.find(
        (folder) => folder.id === result.list.defaultFolderId
      );
      expect(defaultFolder).toMatchObject({ kind: "custom", path: elsewhere });
      expect(result.list.folders.map((folder) => folder.kind)).toEqual([
        "custom",
        "openmeld_managed",
        "custom",
      ]);
      await expect(
        readProfileWorkspaceConfigForAccount({
          account: ACCOUNT,
          openMeldProfileId: PROFILE_ID,
        })
      ).resolves.toMatchObject({
        value: { customWorkspacePath: elsewhere, mode: "custom" },
      });
    });
  });

  it("refuses to remove the default folder without a replacement", async () => {
    await withTempHome(async (home) => {
      const first = join(home, "first");
      const second = join(home, "second");
      await mkdir(first);
      await mkdir(second);
      await setCustomProfileWorkspace({
        account: ACCOUNT,
        customWorkspacePath: first,
        openMeldProfileId: PROFILE_ID,
      });
      const listed = await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: { operation: "list" },
      });
      const defaultFolderId = listed.projection.defaultFolderId ?? "";
      const added = await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: {
          displayName: "Second repo",
          operation: "add_custom",
          path: second,
        },
      });
      const before = await readEnvelope();

      await expect(
        applyProfileFolderOperation({
          account: ACCOUNT,
          openMeldProfileId: PROFILE_ID,
          operation: { folderId: defaultFolderId, operation: "remove" },
        })
      ).rejects.toMatchObject({
        reasonCode: "profile_folder.default_removal_requires_replacement",
      });
      expect(await readEnvelope()).toEqual(before);

      const removed = await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: {
          folderId: defaultFolderId,
          nextDefaultFolderId: added.folderId,
          operation: "remove",
        },
      });
      expect(removed.projection).toEqual({
        defaultFolderId: added.folderId,
        // setCustom, add, remove: three folder saves.
        revision: 3,
        folders: [
          {
            displayName: "Second repo",
            folderId: added.folderId,
            isDefault: true,
            kind: "custom",
          },
        ],
      });
      expect(readAsOlderService(await readEnvelope())).toEqual({
        status: "valid",
        value: { customWorkspacePath: second, mode: "custom" },
      });
    });
  });

  it("renames a folder and defaults new names to the folder basename", async () => {
    await withTempHome(async (home) => {
      const folder = join(home, "website");
      await mkdir(folder);
      const added = await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: { operation: "add_custom", path: folder },
      });
      expect(added.projection.folders[0]?.displayName).toBe("website");
      const renamed = await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: {
          displayName: "Marketing site",
          folderId: added.folderId ?? "",
          operation: "rename",
        },
      });
      expect(renamed.projection.folders[0]?.displayName).toBe("Marketing site");
      // The cloud projection never carries a path.
      expect(JSON.stringify(renamed.projection)).not.toContain(home);
      expect(
        profileFolderProjectionSchema.safeParse({
          ...renamed.projection,
          folders: renamed.projection.folders.map((entry) => ({
            ...entry,
            path: folder,
          })),
        }).success
      ).toBe(false);
    });
  });

  it("fails closed for a folder id this computer does not know", async () => {
    await withTempHome(async (home) => {
      const folder = join(home, "known");
      await mkdir(folder);
      await setCustomProfileWorkspace({
        account: ACCOUNT,
        customWorkspacePath: folder,
        openMeldProfileId: PROFILE_ID,
      });
      for (const mode of ["dispatch", "inspect"] as const) {
        const resolution = await resolveProfileFolderRuntimeForAccount({
          account: ACCOUNT,
          folderId: "6f1f1d0e-8f8e-4a59-9c39-7d2b8c1e4a11",
          mode,
          openMeldProfileId: PROFILE_ID,
          organizationId: "org_1",
        });
        expect(resolution).toEqual({
          reasonCode: "profile.workspace.missing",
          reasonText:
            "The selected folder is no longer set up for this Agent on this computer. Choose a folder again.",
          status: "failed",
        });
      }
    });
  });

  it("resolves a known folder id to its own path, not the default", async () => {
    await withTempHome(async (home) => {
      const defaultFolder = join(home, "default");
      const other = join(home, "other");
      await mkdir(defaultFolder);
      await mkdir(other);
      await setCustomProfileWorkspace({
        account: ACCOUNT,
        customWorkspacePath: defaultFolder,
        openMeldProfileId: PROFILE_ID,
      });
      const added = await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: { operation: "add_custom", path: other },
      });
      await expect(
        resolveProfileFolderRuntimeForAccount({
          account: ACCOUNT,
          folderId: added.folderId ?? "",
          mode: "dispatch",
          openMeldProfileId: PROFILE_ID,
          organizationId: "org_1",
        })
      ).resolves.toMatchObject({
        runtimeContext: { providerRuntimeWorkingDirectory: other },
        status: "ready",
      });
    });
  });

  it("never loses a concurrent folder change: each one is saved or refused by the lock", async () => {
    await withTempHome(async (home) => {
      const paths = await Promise.all(
        ["a", "b", "c", "d", "e"].map(async (name) => {
          const path = join(home, name);
          await mkdir(path);
          return path;
        })
      );
      await setOpenMeldManagedProfileWorkspace({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
      });
      const outcomes = await Promise.allSettled(
        paths.map((path) =>
          applyProfileFolderOperation({
            account: ACCOUNT,
            openMeldProfileId: PROFILE_ID,
            operation: { operation: "add_custom", path },
          })
        )
      );
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") {
          expect(isOpenMeldLockError(outcome.reason)).toBe(true);
        }
      }
      const savedIds = outcomes.flatMap((outcome) =>
        outcome.status === "fulfilled" && outcome.value.folderId
          ? [outcome.value.folderId]
          : []
      );
      expect(savedIds.length).toBeGreaterThan(0);
      const result = await readProfileFolderListForAccount({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
      });
      expect(result.status).toBe("valid");
      if (result.status !== "valid") {
        return;
      }
      const customIds = result.list.folders
        .filter((folder) => folder.kind === "custom")
        .map((folder) => folder.id);
      expect(customIds.sort()).toEqual([...savedIds].sort());
      expect(readAsOlderService(await readEnvelope())).toEqual({
        status: "valid",
        value: { mode: "openmeld_managed" },
      });
    });
  });

  it("keeps a Project folder out of the default and the v2 mirror", async () => {
    await withTempHome(async (home) => {
      const folder = join(home, "managed-default");
      await mkdir(folder);
      await setCustomProfileWorkspace({
        account: ACCOUNT,
        customWorkspacePath: folder,
        openMeldProfileId: PROFILE_ID,
      });
      const envelope = await readEnvelope();
      const projectFolderId = "3c2e8f8a-6b55-4b8e-9a43-0f3f2c9d7e21";
      await writeEnvelope({
        ...envelope,
        folders: [
          ...(envelope.folders as unknown[]),
          {
            displayName: "OpenMeld repo",
            id: projectFolderId,
            kind: "project",
            projectId: "prj_1",
          },
        ],
      });
      await expect(
        applyProfileFolderOperation({
          account: ACCOUNT,
          openMeldProfileId: PROFILE_ID,
          operation: { folderId: projectFolderId, operation: "set_default" },
        })
      ).rejects.toMatchObject({
        reasonCode: "profile_folder.project_default_unsupported",
      });
      await expect(
        resolveProfileFolderRuntimeForAccount({
          account: ACCOUNT,
          folderId: projectFolderId,
          mode: "inspect",
          openMeldProfileId: PROFILE_ID,
          organizationId: "org_1",
        })
      ).resolves.toMatchObject({
        reasonCode: "project.local_connection.missing",
        status: "failed",
      });
    });
  });

  it("claims a legacy Project connection when its folder is added, then runs in it", async () => {
    await withTempHome(async (home) => {
      // An older CLI wrote this v3 connection before connections had an owner.
      const repositoryPath = join(home, "openmeld");
      await mkdir(repositoryPath);
      await writeProjectBindingStore({
        bindings: [
          {
            bindingGeneration: "binding-ownerless",
            boundAtMs: 1_783_892_400_000,
            isDefault: true,
            organizationId: "org_1",
            projectId: "prj_1",
            projectSlug: "openmeld",
            repositoryFingerprint: null,
            repositoryPath,
          },
        ],
        version: 3,
      });
      const added = await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: {
          operation: "add_project",
          organizationId: "org_1",
          projectId: "prj_1",
        },
        ownerUserId: "user_1",
      });
      const projectFolder = added.projection.folders.find(
        (folder) => folder.kind === "project"
      );
      expect(projectFolder).toMatchObject({
        displayName: "openmeld",
        kind: "project",
      });
      // Adding the folder is the explicit reconnect: the owner is recorded
      // and the connection keeps its generation and default.
      expect((await readProjectBindingStore()).bindings).toEqual([
        expect.objectContaining({
          bindingGeneration: "binding-ownerless",
          isDefault: true,
          ownerUserId: "user_1",
        }),
      ]);
      await expect(
        resolveProfileFolderRuntimeForAccount({
          account: ACCOUNT,
          folderId: projectFolder?.folderId ?? "",
          mode: "inspect",
          openMeldProfileId: PROFILE_ID,
          organizationId: "org_1",
          ownerUserId: "user_1",
        })
      ).resolves.toMatchObject({
        runtimeContext: { providerRuntimeWorkingDirectory: repositoryPath },
        status: "ready",
      });
    });
  });

  it("never runs a Project folder in a legacy connection nobody reconnected", async () => {
    await withTempHome(async (home) => {
      // The computer has since switched accounts. The folder list and the
      // ownerless connection both predate the current account.
      const repositoryPath = join(home, "openmeld");
      await mkdir(repositoryPath);
      await writeProjectBindingStore({
        bindings: [
          {
            bindingGeneration: "binding-ownerless",
            boundAtMs: 1_783_892_400_000,
            isDefault: true,
            organizationId: "org_1",
            projectId: "prj_1",
            projectSlug: "openmeld",
            repositoryFingerprint: null,
            repositoryPath,
          },
        ],
        version: 3,
      });
      await setCustomProfileWorkspace({
        account: ACCOUNT,
        customWorkspacePath: repositoryPath,
        openMeldProfileId: PROFILE_ID,
      });
      const envelope = await readEnvelope();
      const projectFolderId = "3c2e8f8a-6b55-4b8e-9a43-0f3f2c9d7e21";
      await writeEnvelope({
        ...envelope,
        folders: [
          ...(envelope.folders as unknown[]),
          {
            displayName: "openmeld",
            id: projectFolderId,
            kind: "project",
            projectId: "prj_1",
          },
        ],
      });
      await expect(
        resolveProfileFolderRuntimeForAccount({
          account: ACCOUNT,
          folderId: projectFolderId,
          mode: "dispatch",
          openMeldProfileId: PROFILE_ID,
          organizationId: "org_1",
          ownerUserId: "user_2",
        })
      ).resolves.toMatchObject({
        reasonCode: "project.local_connection.missing",
        status: "failed",
      });
      expect(
        (await readProjectBindingStore()).bindings[0]?.ownerUserId
      ).toBeUndefined();
    });
  });

  it("does not swap an unclaimed default for another connection of the Project", async () => {
    await withTempHome(async (home) => {
      const defaultPath = join(home, "openmeld");
      const worktreePath = join(home, "openmeld-worktree");
      await mkdir(defaultPath);
      await mkdir(worktreePath);
      const binding = {
        boundAtMs: 1_783_892_400_000,
        organizationId: "org_1",
        projectId: "prj_1",
        projectSlug: "openmeld",
        repositoryFingerprint: null,
      };
      await writeProjectBindingStore({
        bindings: [
          {
            ...binding,
            bindingGeneration: "binding-ownerless-default",
            isDefault: true,
            repositoryPath: defaultPath,
          },
          {
            ...binding,
            bindingGeneration: "binding-owned-worktree",
            isDefault: false,
            ownerUserId: "user_1",
            repositoryPath: worktreePath,
          },
        ],
        version: 4,
      });
      await setCustomProfileWorkspace({
        account: ACCOUNT,
        customWorkspacePath: defaultPath,
        openMeldProfileId: PROFILE_ID,
      });
      const envelope = await readEnvelope();
      const projectFolderId = "3c2e8f8a-6b55-4b8e-9a43-0f3f2c9d7e21";
      await writeEnvelope({
        ...envelope,
        folders: [
          ...(envelope.folders as unknown[]),
          {
            displayName: "openmeld",
            id: projectFolderId,
            kind: "project",
            projectId: "prj_1",
          },
        ],
      });
      await expect(
        resolveProfileFolderRuntimeForAccount({
          account: ACCOUNT,
          folderId: projectFolderId,
          mode: "dispatch",
          openMeldProfileId: PROFILE_ID,
          organizationId: "org_1",
          ownerUserId: "user_1",
        })
      ).resolves.toMatchObject({
        reasonCode: "project.local_connection.missing",
        status: "failed",
      });
    });
  });

  it("leaves a legacy connection unclaimed when the folder change is refused", async () => {
    await withTempHome(async (home) => {
      const repositoryPath = join(home, "openmeld");
      await mkdir(repositoryPath);
      await writeProjectBindingStore({
        bindings: [
          {
            bindingGeneration: "binding-ownerless",
            boundAtMs: 1_783_892_400_000,
            isDefault: true,
            organizationId: "org_1",
            projectId: "prj_1",
            projectSlug: "openmeld",
            repositoryFingerprint: null,
            repositoryPath,
          },
        ],
        version: 3,
      });
      await writeEnvelope({
        folders: [{ id: "not-a-uuid", kind: "custom", path: "/tmp" }],
        openMeldProfileId: PROFILE_ID,
        updatedAt: "2026-10-01T00:00:00.000Z",
        v: 2,
        workspace: { mode: "openmeld_managed" },
      });
      await expect(
        applyProfileFolderOperation({
          account: ACCOUNT,
          openMeldProfileId: PROFILE_ID,
          operation: {
            operation: "add_project",
            organizationId: "org_1",
            projectId: "prj_1",
          },
          ownerUserId: "user_1",
        })
      ).rejects.toMatchObject({
        reasonCode: "profile_folder.configuration_invalid",
      });
      expect(
        (await readProjectBindingStore()).bindings[0]?.ownerUserId
      ).toBeUndefined();
    });
  });

  it("keeps a claim's I/O failure distinct from a Project that needs reconnecting", async () => {
    await withTempHome(async (home) => {
      const repositoryPath = join(home, "openmeld");
      await mkdir(repositoryPath);
      await writeProjectBindingStore({
        bindings: [
          {
            bindingGeneration: "binding-ownerless",
            boundAtMs: 1_783_892_400_000,
            isDefault: true,
            organizationId: "org_1",
            projectId: "prj_1",
            projectSlug: "openmeld",
            repositoryFingerprint: null,
            repositoryPath,
          },
        ],
        version: 3,
      });
      const storeDir = join(
        resolveOpenMeldRootDir(),
        "device",
        "agent-activity"
      );
      await chmod(storeDir, 0o555);
      try {
        const outcome = await applyProfileFolderOperation({
          account: ACCOUNT,
          openMeldProfileId: PROFILE_ID,
          operation: {
            operation: "add_project",
            organizationId: "org_1",
            projectId: "prj_1",
          },
          ownerUserId: "user_1",
        }).catch((error: unknown) => error);
        expect(outcome).toBeInstanceOf(Error);
        expect(outcome).not.toBeInstanceOf(ProfileFolderOperationError);
      } finally {
        await chmod(storeDir, 0o755);
      }
      expect(
        (await readProjectBindingStore()).bindings[0]?.ownerUserId
      ).toBeUndefined();
    });
  });

  it("refuses a claimed legacy connection to the next account on this computer", async () => {
    await withTempHome(async (home) => {
      const repositoryPath = join(home, "openmeld");
      await mkdir(repositoryPath);
      await writeProjectBindingStore({
        bindings: [
          {
            bindingGeneration: "binding-ownerless",
            boundAtMs: 1_783_892_400_000,
            isDefault: true,
            organizationId: "org_1",
            projectId: "prj_1",
            projectSlug: "openmeld",
            repositoryFingerprint: null,
            repositoryPath,
          },
        ],
        version: 3,
      });
      const addProject = (ownerUserId: string) =>
        applyProfileFolderOperation({
          account: ACCOUNT,
          openMeldProfileId: PROFILE_ID,
          operation: {
            operation: "add_project",
            organizationId: "org_1",
            projectId: "prj_1",
          },
          ownerUserId,
        });
      await addProject("user_1");
      await expect(addProject("user_2")).rejects.toMatchObject({
        reasonCode: "profile_folder.project_not_connected",
      });
      expect((await readProjectBindingStore()).bindings[0]?.ownerUserId).toBe(
        "user_1"
      );
    });
  });

  it("refuses a Project folder whose connection belongs to another account", async () => {
    await withTempHome(async (home) => {
      const repositoryPath = join(home, "openmeld");
      await mkdir(repositoryPath);
      await writeProjectBindingStore({
        bindings: [
          {
            bindingGeneration: "binding-other-owner",
            boundAtMs: 1_783_892_400_000,
            isDefault: true,
            organizationId: "org_1",
            ownerUserId: "user_2",
            projectId: "prj_1",
            projectSlug: "openmeld",
            repositoryFingerprint: null,
            repositoryPath,
          },
        ],
        version: 4,
      });
      await expect(
        applyProfileFolderOperation({
          account: ACCOUNT,
          openMeldProfileId: PROFILE_ID,
          operation: {
            operation: "add_project",
            organizationId: "org_1",
            projectId: "prj_1",
          },
          ownerUserId: "user_1",
        })
      ).rejects.toMatchObject({
        reasonCode: "profile_folder.project_not_connected",
      });
    });
  });

  it("treats a malformed folder list as invalid instead of guessing", async () => {
    await withTempHome(async () => {
      await writeEnvelope({
        folders: [{ id: "not-a-uuid", kind: "custom", path: "/tmp" }],
        openMeldProfileId: PROFILE_ID,
        updatedAt: "2026-10-01T00:00:00.000Z",
        v: 2,
        workspace: { mode: "openmeld_managed" },
      });
      await expect(
        readProfileFolderListForAccount({
          account: ACCOUNT,
          openMeldProfileId: PROFILE_ID,
        })
      ).resolves.toMatchObject({ reason: "invalid_schema", status: "invalid" });
      await expect(
        applyProfileFolderOperation({
          account: ACCOUNT,
          openMeldProfileId: PROFILE_ID,
          operation: { operation: "add_openmeld_managed" },
        })
      ).rejects.toMatchObject({
        reasonCode: "profile_folder.configuration_invalid",
      });
    });
  });

  it("repairs unreadable folder settings with the chosen folder as the only default", async () => {
    await withTempHome(async (home) => {
      const folder = join(home, "repo-repair");
      await mkdir(folder);
      await writeEnvelope({
        folders: [{ id: "not-a-uuid", kind: "custom", path: "/tmp" }],
        foldersRevision: 7,
        openMeldProfileId: PROFILE_ID,
        updatedAt: "2026-10-01T00:00:00.000Z",
        v: 2,
        workspace: { mode: "openmeld_managed" },
      });

      const repaired = await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: {
          folder: { kind: "custom", path: folder },
          operation: "repair",
        },
        updatedAt: "2026-10-19T00:00:00.000Z",
      });

      expect(repaired.projection.folders).toEqual([
        {
          displayName: "repo-repair",
          folderId: repaired.folderId,
          isDefault: true,
          kind: "custom",
        },
      ]);
      // The unreadable counter is lost; the repair must still outrank any
      // list Core recorded before the settings broke.
      expect(repaired.projection.revision).toBeGreaterThan(1_000_000);
      const saved = await readProfileWorkspaceConfigForAccount({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
      });
      expect(saved).toMatchObject({
        status: "valid",
        value: { customWorkspacePath: folder, mode: "custom" },
      });
      // Ordinary folder changes work again and keep counting up.
      const added = await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: { operation: "add_openmeld_managed" },
      });
      expect(added.projection.revision).toBe(repaired.projection.revision + 1);
    });
  });

  it("repairs a readable list by adding or reusing the folder as the default", async () => {
    await withTempHome(async (home) => {
      const folder = join(home, "repo-keep");
      await mkdir(folder);
      await setCustomProfileWorkspace({
        account: ACCOUNT,
        customWorkspacePath: folder,
        openMeldProfileId: PROFILE_ID,
      });
      const before = await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: { operation: "list" },
      });

      const repaired = await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: {
          folder: { kind: "openmeld_managed" },
          operation: "repair",
        },
      });

      expect(repaired.projection.folders).toHaveLength(2);
      expect(repaired.projection.defaultFolderId).toBe(repaired.folderId);
      expect(
        repaired.projection.folders.find((item) => item.kind === "custom")
          ?.folderId
      ).toBe(before.projection.defaultFolderId);
      await expect(
        stat(accountProfileWorkspacePath(ACCOUNT, PROFILE_ID))
      ).resolves.toBeTruthy();
    });
  });

  it("recreates a missing OpenMeld folder when the current default is chosen again", async () => {
    await withTempHome(async () => {
      await setOpenMeldManagedProfileWorkspace({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
      });
      const workspace = accountProfileWorkspacePath(ACCOUNT, PROFILE_ID);
      await rm(workspace, { force: true, recursive: true });
      const listed = await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: { operation: "list" },
      });
      const defaultFolderId = listed.projection.defaultFolderId;
      if (!defaultFolderId) {
        throw new Error("Expected a default folder.");
      }

      const again = await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: { folderId: defaultFolderId, operation: "set_default" },
      });

      expect(again.projection.revision).toBe(listed.projection.revision);
      await expect(stat(workspace)).resolves.toBeTruthy();
    });
  });

  it("reports refused folder changes to Core without a local path", async () => {
    await withTempHome(async (home) => {
      const missing = join(home, "private-repo");
      const refused = await applyProfileFolderOperation({
        account: ACCOUNT,
        openMeldProfileId: PROFILE_ID,
        operation: { operation: "add_custom", path: missing },
      }).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(ProfileFolderOperationError);
      for (const error of [
        refused,
        new Error(`EACCES: permission denied, open '${missing}'`),
      ]) {
        const receipt = buildProfileFolderRejection({
          error,
          targetProfileId: PROFILE_ID,
        });
        expect(receipt.accepted).toBe(false);
        expect(JSON.stringify(receipt)).not.toContain(home);
      }
    });
  });
});
