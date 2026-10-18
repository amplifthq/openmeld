import {
  centerAgentUpdateAgentProfileRuntimeSettingsBodySchema,
  getAgentProfileFoldersResponseSchema,
  profileFolderProjectionRecordSchema,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  readProfileFolderProjectionRecord,
  resolveProjectedDefaultFolder,
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
      projection: { defaultFolderId: null, folders: [] },
      storage,
      target: { ...TARGET, deviceId: "device-2" },
    });
    await expect(
      readProfileFolderProjectionRecord({ storage, target: TARGET })
    ).resolves.toEqual(written);
    expect(storage.values.size).toBe(2);
    expect(JSON.stringify([...storage.values.values()])).not.toContain("/");
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
});
