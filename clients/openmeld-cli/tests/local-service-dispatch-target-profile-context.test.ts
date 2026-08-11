import { beforeEach, describe, expect, it, vi } from "vitest";
import { listOpenMeldProfiles } from "../src/config/openmeld-profiles-api";
import {
  resolveBootstrapTargetProfileContext,
  resolveDispatchMentionSourceContext,
} from "../src/local-service/dispatch/parse-dispatch-task";
import { readSpaceConfig } from "../src/space/local-state";
import {
  createSpaceConfigReadCorrupt,
  createSpaceConfigReadMissing,
  createSpaceConfigReadOk,
} from "./helpers/local-state";

const LOCAL_SPACE_STATE_INTEGRITY_ERROR_RE =
  /Local space state integrity check failed/;

vi.mock("../src/config/openmeld-profiles-api", () => ({
  listOpenMeldProfiles: vi.fn(),
}));

vi.mock("../src/space/local-state", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/space/local-state")>();
  return {
    ...actual,
    readSpaceConfig: vi.fn(),
  };
});

const mockedListOpenMeldProfiles = vi.mocked(listOpenMeldProfiles);
const mockedReadSpaceConfig = vi.mocked(readSpaceConfig);

describe("dispatch target profile bootstrap context", () => {
  beforeEach(() => {
    mockedListOpenMeldProfiles.mockReset();
    mockedReadSpaceConfig.mockReset();
  });

  it("uses space config identity when available", async () => {
    mockedReadSpaceConfig.mockResolvedValue(
      createSpaceConfigReadOk({
        v: 2,
        schemaVersion: 1,
        source: "local-cache",
        syncedAt: "2026-03-06T00:00:00.000Z",
        baseUrl: "http://localhost:8080",
        space: "space_1",
        openMeldProfileId: "agt_1",
        profileHandle: "space-agent",
        profileName: "space-agent",
        mentionAlias: "space_alias",
        role: "Reviewer",
        createdAt: "2026-03-06T00:00:00.000Z",
        updatedAt: "2026-03-06T00:00:00.000Z",
      })
    );
    mockedListOpenMeldProfiles.mockResolvedValue([]);

    const context = await resolveBootstrapTargetProfileContext({
      spaceId: "space_1",
      targetProfileId: "agt_1",
    });

    expect(context).toEqual({
      targetProfileMentionLabel: "space-agent",
      targetProfileName: "space-agent",
      targetProfileRole: "Reviewer",
    });
    expect(mockedListOpenMeldProfiles).not.toHaveBeenCalled();
  });

  it("uses the unique profile name when alias is absent", async () => {
    mockedReadSpaceConfig.mockResolvedValue(
      createSpaceConfigReadOk({
        v: 2,
        schemaVersion: 1,
        source: "local-cache",
        syncedAt: "2026-03-06T00:00:00.000Z",
        baseUrl: "http://localhost:8080",
        space: "space_1",
        openMeldProfileId: "agt_1",
        profileHandle: "new-codex-agent",
        profileName: "new-codex-agent",
        createdAt: "2026-03-06T00:00:00.000Z",
        updatedAt: "2026-03-06T00:00:00.000Z",
      })
    );
    mockedListOpenMeldProfiles.mockResolvedValue([]);

    const context = await resolveBootstrapTargetProfileContext({
      spaceId: "space_1",
      targetProfileId: "agt_1",
    });

    expect(context).toEqual({
      targetProfileMentionLabel: "new-codex-agent",
      targetProfileName: "new-codex-agent",
      targetProfileRole: null,
    });
    expect(mockedListOpenMeldProfiles).not.toHaveBeenCalled();
  });

  it("prefers an explicit target mention label over the canonical fallback", async () => {
    mockedReadSpaceConfig.mockResolvedValue(
      createSpaceConfigReadOk({
        v: 2,
        schemaVersion: 1,
        source: "local-cache",
        syncedAt: "2026-03-06T00:00:00.000Z",
        baseUrl: "http://localhost:8080",
        space: "space_1",
        openMeldProfileId: "agt_1",
        profileHandle: "new-codex-agent",
        profileName: "new-codex-agent",
        createdAt: "2026-03-06T00:00:00.000Z",
        updatedAt: "2026-03-06T00:00:00.000Z",
      })
    );

    const context = await resolveBootstrapTargetProfileContext({
      spaceId: "space_1",
      targetProfileId: "agt_1",
      preferredMentionLabel: "new-codex-agent-2",
    });

    expect(context).toEqual({
      targetProfileMentionLabel: "new-codex-agent-2",
      targetProfileName: "new-codex-agent",
      targetProfileRole: null,
    });
  });

  it("prefers an explicit mention source label over the canonical fallback", async () => {
    mockedReadSpaceConfig.mockResolvedValue(
      createSpaceConfigReadOk({
        v: 2,
        schemaVersion: 1,
        source: "local-cache",
        syncedAt: "2026-03-06T00:00:00.000Z",
        baseUrl: "http://localhost:8080",
        space: "space_1",
        openMeldProfileId: "agt_2",
        profileHandle: "helper",
        profileName: "Helper Agent",
        createdAt: "2026-03-06T00:00:00.000Z",
        updatedAt: "2026-03-06T00:00:00.000Z",
      })
    );

    const context = await resolveDispatchMentionSourceContext({
      spaceId: "space_1",
      mentionSourceProfileId: "agt_2",
      preferredMentionLabel: "helper-2",
    });

    expect(context).toEqual({
      mentionSourceProfileName: "Helper Agent",
      mentionSourceMentionLabel: "helper-2",
    });
  });

  it("uses payload target display facts when space config is missing", async () => {
    mockedReadSpaceConfig.mockResolvedValue(createSpaceConfigReadMissing());
    mockedListOpenMeldProfiles.mockRejectedValue(
      new Error("remote profiles slow")
    );

    const context = await resolveBootstrapTargetProfileContext({
      spaceId: "space_1",
      targetProfileId: "agt_1",
      preferredMentionLabel: "new-codex-agent-mention",
      preferredProfileName: "new-codex-agent",
    });

    expect(context).toEqual({
      targetProfileMentionLabel: "new-codex-agent-mention",
      targetProfileName: "new-codex-agent",
      targetProfileRole: null,
    });
    expect(mockedListOpenMeldProfiles).not.toHaveBeenCalled();
  });

  it("does not block bootstrap context on a missing nice-to-have target display name", async () => {
    mockedReadSpaceConfig.mockResolvedValue(createSpaceConfigReadMissing());
    mockedListOpenMeldProfiles.mockRejectedValue(
      new Error("remote profiles slow")
    );

    const context = await resolveBootstrapTargetProfileContext({
      spaceId: "space_1",
      targetProfileId: "agt_1",
    });

    expect(context).toEqual({
      targetProfileMentionLabel: "agt_1",
      targetProfileName: null,
      targetProfileRole: null,
    });
    expect(mockedListOpenMeldProfiles).not.toHaveBeenCalled();
  });

  it("does not block mention source context on a missing nice-to-have display name", async () => {
    mockedReadSpaceConfig.mockResolvedValue(createSpaceConfigReadMissing());
    mockedListOpenMeldProfiles.mockRejectedValue(
      new Error("remote profiles slow")
    );

    const context = await resolveDispatchMentionSourceContext({
      spaceId: "space_1",
      mentionSourceProfileId: "agt_source_1",
      preferredMentionLabel: "source-agent",
    });

    expect(context).toEqual({
      mentionSourceMentionLabel: "source-agent",
      mentionSourceProfileName: null,
    });
    expect(mockedListOpenMeldProfiles).not.toHaveBeenCalled();
  });

  it("fails fast when the local space config is corrupt", async () => {
    mockedReadSpaceConfig.mockResolvedValue(createSpaceConfigReadCorrupt());

    await expect(
      resolveBootstrapTargetProfileContext({
        spaceId: "space_1",
        targetProfileId: "agt_1",
      })
    ).rejects.toThrow(LOCAL_SPACE_STATE_INTEGRITY_ERROR_RE);
  });
});
