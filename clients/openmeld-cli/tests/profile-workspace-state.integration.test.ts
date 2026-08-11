import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { accountProfileLocalMetaPath } from "../src/config/paths";
import { syncProfileWorkspaceState } from "../src/system/profile-workspace-state";
import { withTempHome } from "./helpers/fs";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

const { getAuthSessionStateMock, listOpenMeldProfilesMock } = vi.hoisted(
  () => ({
    getAuthSessionStateMock: vi.fn(),
    listOpenMeldProfilesMock: vi.fn(),
  })
);

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/auth-session")
  >("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: getAuthSessionStateMock,
  };
});

vi.mock("../src/config/openmeld-profiles-api", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/openmeld-profiles-api")
  >("../src/config/openmeld-profiles-api");
  return {
    ...actual,
    listOpenMeldProfiles: listOpenMeldProfilesMock,
  };
});

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

function createProjectedAgentProfile(openMeldProfileId: string) {
  return createTestOpenMeldProfile({
    openMeldProfileId,
    profileName: openMeldProfileId,
  });
}

describe("profile workspace state sync", () => {
  it("skips workspace sync when sign-in is unavailable", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue({
        session: null,
        state: "missing",
      });
      listOpenMeldProfilesMock.mockResolvedValue([]);

      await expect(
        syncProfileWorkspaceState({
          mode: "check",
        })
      ).resolves.toEqual({
        invalidWorkspaceProfileIds: [],
        migratedProfileIds: [],
        missingWorkspaceProfileIds: [],
        mode: "check",
        projectedProfileIds: [],
        provisionedProfileIds: [],
        reason:
          "sign in is required before OpenMeld can check profile workspaces",
        status: "skipped",
      });
    });
  });

  it("reports missing workspace config for projected agent profiles in check mode", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue({
        session: {
          accessToken: "token",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: "2026-04-13T00:00:00.000Z",
          tokenType: "Bearer",
          v: 1,
        },
        state: "valid",
      });
      listOpenMeldProfilesMock.mockResolvedValue([
        createProjectedAgentProfile("agt_workspace_missing"),
      ]);

      await expect(
        syncProfileWorkspaceState({
          mode: "check",
        })
      ).resolves.toEqual({
        invalidWorkspaceProfileIds: [],
        migratedProfileIds: [],
        missingWorkspaceProfileIds: ["agt_workspace_missing"],
        mode: "check",
        projectedProfileIds: ["agt_workspace_missing"],
        provisionedProfileIds: [],
        reason:
          "one or more projected agent profiles are missing local workspace config",
        status: "degraded",
      });
    });
  });

  it("provisions missing OpenMeld-managed workspace config in repair mode", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue({
        session: {
          accessToken: "token",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: "2026-04-13T00:00:00.000Z",
          tokenType: "Bearer",
          v: 1,
        },
        state: "valid",
      });
      listOpenMeldProfilesMock.mockResolvedValue([
        createProjectedAgentProfile("agt_workspace_repair"),
      ]);

      await expect(
        syncProfileWorkspaceState({
          mode: "repair",
        })
      ).resolves.toEqual({
        invalidWorkspaceProfileIds: [],
        migratedProfileIds: [],
        missingWorkspaceProfileIds: [],
        mode: "repair",
        projectedProfileIds: ["agt_workspace_repair"],
        provisionedProfileIds: ["agt_workspace_repair"],
        reason: "projected agent profile workspaces were provisioned",
        status: "ok",
      });

      await expect(
        readFile(
          accountProfileLocalMetaPath(FALLBACK_ACCOUNT, "agt_workspace_repair"),
          "utf8"
        )
      ).resolves.toContain('"mode": "openmeld_managed"');
    });
  });

  it("migrates legacy v1 config during repair but still reports invalid custom paths", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue({
        session: {
          accessToken: "token",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: "2026-04-13T00:00:00.000Z",
          tokenType: "Bearer",
          v: 1,
        },
        state: "valid",
      });
      listOpenMeldProfilesMock.mockResolvedValue([
        createProjectedAgentProfile("agt_workspace_invalid_custom"),
      ]);
      await writeLocalMetaFile({
        openMeldProfileId: "agt_workspace_invalid_custom",
        payload: {
          v: 1,
          openMeldProfileId: "agt_workspace_invalid_custom",
          providerRuntimeWorkingDirectory: "/tmp/does-not-exist",
          updatedAt: "2026-04-13T00:00:00.000Z",
        },
      });

      await expect(
        syncProfileWorkspaceState({
          mode: "repair",
        })
      ).resolves.toEqual({
        invalidWorkspaceProfileIds: ["agt_workspace_invalid_custom"],
        migratedProfileIds: ["agt_workspace_invalid_custom"],
        missingWorkspaceProfileIds: [],
        mode: "repair",
        projectedProfileIds: ["agt_workspace_invalid_custom"],
        provisionedProfileIds: [],
        reason:
          "one or more projected agent profiles have invalid local workspaces",
        status: "degraded",
      });

      await expect(
        readFile(
          accountProfileLocalMetaPath(
            FALLBACK_ACCOUNT,
            "agt_workspace_invalid_custom"
          ),
          "utf8"
        )
      ).resolves.toContain('"mode": "custom"');
    });
  });
});
