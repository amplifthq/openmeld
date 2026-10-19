import {
  centerAgentUpdateAgentProfileRuntimeSettingsBodySchema,
  getAgentProfileFoldersResponseSchema,
  manageAgentProfileFoldersBodySchema,
  profileFolderProjectionRecordSchema,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  readProfileFolderProjectionRecord,
  resolveProjectedDefaultFolder,
  resolveRemovableFolder,
  writeProfileFolderProjectionRecord,
} from "../src/runtime-transport/application/profile-folder-projection-store";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const CUSTOM_FOLDER_ID = "6f1f1d0e-8f8e-4a59-9c39-7d2b8c1e4a11";
const PROJECT_FOLDER_ID = "3c2e8f8a-6b55-4b8e-9a43-0f3f2c9d7e21";
const TARGET = {
  deviceId: "device-1",
  lane: "prod" as const,
  targetProfileId: AGENT_PROFILE_ID,
};
const PROJECTION = {
  defaultFolderId: CUSTOM_FOLDER_ID,
  revision: 3,
  folders: [
    {
      displayName: "openmeld",
      folderId: CUSTOM_FOLDER_ID,
      isDefault: true,
      kind: "custom" as const,
    },
    {
      displayName: "OpenMeld repo",
      folderId: PROJECT_FOLDER_ID,
      isDefault: false,
      kind: "project" as const,
      projectId: "project-openmeld",
    },
  ],
};

function memoryStorage() {
  const values = new Map<string, unknown>();
  return {
    values,
    get: <T>(key: string) => Promise.resolve(values.get(key) as T | undefined),
    put: <T>(key: string, value: T) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

describe("profile folder projection", () => {
  it("has no path field anywhere Core stores or returns folders", () => {
    const withPath = {
      ...PROJECTION,
      folders: PROJECTION.folders.map((folder) => ({
        ...folder,
        path: "/Users/felix/work/openmeld",
      })),
    };
    expect(
      profileFolderProjectionRecordSchema.safeParse({
        ...TARGET,
        observedAtMs: 1,
        projection: withPath,
      }).success
    ).toBe(false);
    expect(
      profileFolderProjectionRecordSchema.safeParse({
        ...TARGET,
        observedAtMs: 1,
        path: "/Users/felix/work/openmeld",
        projection: PROJECTION,
      }).success
    ).toBe(false);
    expect(
      getAgentProfileFoldersResponseSchema.safeParse({
        agentProfileId: AGENT_PROFILE_ID,
        observedAtMs: 1,
        projection: withPath,
        status: "current",
        target: { deviceId: "device-1", runtimeLane: "prod" },
      }).success
    ).toBe(false);
  });

  it("rejects a projection whose default flag disagrees with defaultFolderId", () => {
    expect(
      profileFolderProjectionRecordSchema.safeParse({
        ...TARGET,
        observedAtMs: 1,
        projection: { ...PROJECTION, defaultFolderId: PROJECT_FOLDER_ID },
      }).success
    ).toBe(false);
  });

  it("stores one record per Computer and Profile from a folder-save receipt", async () => {
    const storage = memoryStorage();
    const written = await writeProfileFolderProjectionRecord({
      observedAtMs: 10,
      projection: PROJECTION,
      storage,
      target: TARGET,
    });
    await writeProfileFolderProjectionRecord({
      observedAtMs: 11,
      projection: { defaultFolderId: null, folders: [], revision: 1 },
      storage,
      target: { ...TARGET, deviceId: "device-2" },
    });
    await expect(
      readProfileFolderProjectionRecord({ storage, target: TARGET })
    ).resolves.toEqual(written);
    expect(storage.values.size).toBe(2);
    expect(JSON.stringify([...storage.values.values()])).not.toContain("/");
  });

  it("keeps the newest folder list when an older receipt arrives late", async () => {
    const storage = memoryStorage();
    await writeProfileFolderProjectionRecord({
      observedAtMs: 10,
      projection: PROJECTION,
      storage,
      target: TARGET,
    });
    const late = await writeProfileFolderProjectionRecord({
      observedAtMs: 20,
      projection: { defaultFolderId: null, folders: [], revision: 2 },
      storage,
      target: TARGET,
    });
    expect(late.projection).toEqual(PROJECTION);
    await expect(
      readProfileFolderProjectionRecord({ storage, target: TARGET })
    ).resolves.toMatchObject({ observedAtMs: 10, projection: PROJECTION });
  });

  it("lets a repair replace a list with a higher revision", async () => {
    const storage = memoryStorage();
    await writeProfileFolderProjectionRecord({
      observedAtMs: 10,
      projection: PROJECTION,
      storage,
      target: TARGET,
    });
    // The repaired list can't know the lost counter; it still replaces the
    // record, so ids the repair dropped are never served again.
    const repaired = { defaultFolderId: null, folders: [], revision: 1 };
    await writeProfileFolderProjectionRecord({
      observedAtMs: 20,
      projection: repaired,
      replaces: true,
      storage,
      target: TARGET,
    });
    await expect(
      readProfileFolderProjectionRecord({ storage, target: TARGET })
    ).resolves.toMatchObject({ observedAtMs: 20, projection: repaired });
  });

  it("allows a default folder only from this Computer's projection", () => {
    const record = profileFolderProjectionRecordSchema.parse({
      ...TARGET,
      observedAtMs: 1,
      projection: PROJECTION,
    });
    expect(
      resolveProjectedDefaultFolder({ folderId: CUSTOM_FOLDER_ID, record })
    ).toEqual({ folderId: CUSTOM_FOLDER_ID, status: "eligible" });
    expect(
      resolveProjectedDefaultFolder({ folderId: PROJECT_FOLDER_ID, record })
    ).toEqual({ status: "project_default_unsupported" });
    expect(
      resolveProjectedDefaultFolder({
        folderId: "0397cc3e-6689-4a06-a6c3-1ca0e265606b",
        record,
      })
    ).toEqual({ status: "not_found" });
    expect(
      resolveProjectedDefaultFolder({
        folderId: CUSTOM_FOLDER_ID,
        record: null,
      })
    ).toEqual({ status: "not_found" });
  });

  it("accepts a default folder id for the Center Agent but never with a workspace mode", () => {
    expect(
      centerAgentUpdateAgentProfileRuntimeSettingsBodySchema.safeParse({
        agentProfileId: AGENT_PROFILE_ID,
        defaultFolderId: CUSTOM_FOLDER_ID,
      }).success
    ).toBe(true);
    expect(
      centerAgentUpdateAgentProfileRuntimeSettingsBodySchema.safeParse({
        agentProfileId: AGENT_PROFILE_ID,
        defaultFolderId: CUSTOM_FOLDER_ID,
        workspaceMode: "openmeld_managed",
      }).success
    ).toBe(false);
    expect(
      centerAgentUpdateAgentProfileRuntimeSettingsBodySchema.safeParse({
        agentProfileId: AGENT_PROFILE_ID,
        defaultFolderId: "/Users/felix/work/openmeld",
      }).success
    ).toBe(false);
  });

  it("carries a Project id only on Project folders", () => {
    const parse = (folders: unknown[]) =>
      profileFolderProjectionRecordSchema.safeParse({
        ...TARGET,
        observedAtMs: 1,
        projection: { defaultFolderId: null, folders, revision: 1 },
      }).success;
    const base = {
      displayName: "openmeld",
      folderId: CUSTOM_FOLDER_ID,
      isDefault: false,
    };
    expect(parse([{ ...base, kind: "custom", projectId: "project-1" }])).toBe(
      false
    );
    expect(parse([{ ...base, kind: "project" }])).toBe(false);
    expect(parse([{ ...base, kind: "project", projectId: "project-1" }])).toBe(
      true
    );
  });

  it("changes the default only through set_default on the owner write route", () => {
    const bindingTarget = {
      agentControllerConversationId: null,
      agentControllerRef: "builtin:codex",
      bindingId: "binding-1",
      openMeldServiceRuntimeId: "runtime-1",
    };
    const parse = (operation: unknown) =>
      manageAgentProfileFoldersBodySchema.safeParse({
        expectedBindingTarget: bindingTarget,
        operation,
      }).success;
    expect(parse({ folderId: CUSTOM_FOLDER_ID, operation: "remove" })).toBe(
      true
    );
    expect(
      parse({
        folderId: CUSTOM_FOLDER_ID,
        nextDefaultFolderId: PROJECT_FOLDER_ID,
        operation: "remove",
      })
    ).toBe(false);
    expect(parse({ operation: "list" })).toBe(false);
    expect(
      manageAgentProfileFoldersBodySchema.safeParse({
        operation: { operation: "add_openmeld_managed" },
      }).success
    ).toBe(false);
  });

  it("repairs folder settings only with an OpenMeld or custom folder", () => {
    const parse = (folder: unknown) =>
      manageAgentProfileFoldersBodySchema.safeParse({
        expectedBindingTarget: {
          agentControllerConversationId: null,
          agentControllerRef: "builtin:codex",
          bindingId: "binding-1",
          openMeldServiceRuntimeId: "runtime-1",
        },
        operation: { folder, operation: "repair" },
      }).success;
    expect(parse({ kind: "openmeld_managed" })).toBe(true);
    expect(parse({ kind: "custom", path: "/Users/me/repo" })).toBe(true);
    // A Project folder is never the default; it repairs nothing locally.
    expect(parse({ kind: "project", projectId: "project-1" })).toBe(false);
    expect(parse({ kind: "custom" })).toBe(false);
  });

  it("refuses to remove the Default Project's folder", () => {
    const record = profileFolderProjectionRecordSchema.parse({
      ...TARGET,
      observedAtMs: 1,
      projection: PROJECTION,
    });
    expect(
      resolveRemovableFolder({
        defaultProjectId: "project-openmeld",
        folderId: PROJECT_FOLDER_ID,
        record,
      })
    ).toEqual({ status: "default_project_folder" });
    expect(
      resolveRemovableFolder({
        defaultProjectId: null,
        folderId: PROJECT_FOLDER_ID,
        record,
      })
    ).toEqual({ status: "removable" });
    expect(
      resolveRemovableFolder({
        defaultProjectId: null,
        folderId: "0397cc3e-6689-4a06-a6c3-1ca0e265606b",
        record,
      })
    ).toEqual({ status: "not_found" });
  });
});
