import type {
  OrganizationDocumentsApi,
  OrganizationSkillsApi,
} from "@openmeld/api-client";
import type { SpaceMeta } from "@openmeld/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  meta: vi.fn(),
  foundation: vi.fn(),
  documents: vi.fn(),
  skills: vi.fn(),
}));
vi.mock("../src/config/resolve-openmeld-profile", () => ({
  requireOpenMeldProfile: mocks.profile,
}));
vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: async () => "https://gateway.example.test",
}));
vi.mock("../src/space/meta-api", () => ({ fetchSpaceMeta: mocks.meta }));
vi.mock("../src/space/api-client-foundation", () => ({
  createCliApiClientFoundation: mocks.foundation,
}));
vi.mock("@openmeld/api-client", () => ({
  createOrganizationDocumentsApi: () => ({ list: mocks.documents }),
  createOrganizationSkillsApi: () => ({ list: mocks.skills }),
}));

import { readTaskKnowledge } from "../src/space/dispatch-knowledge-read";

const spaceMeta: SpaceMeta = {
  spaceId: "space-1",
  organizationId: "org-1",
  visibility: "private",
  name: "Release review",
  purpose: "Review a release",
};
const documents: Awaited<ReturnType<OrganizationDocumentsApi["list"]>> = {
  canManage: false,
  currentUserId: "owner-1",
  folders: [],
  organizationId: "org-1",
  documents: [],
};
const skills: Awaited<ReturnType<OrganizationSkillsApi["list"]>> = {
  canManage: false,
  organizationId: "org-1",
  skills: [],
};
const scope = {
  spaceId: "space-1",
  targetProfileId: "agent-1",
  spacePassword: "space-password",
};

describe("task knowledge preparation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.profile.mockResolvedValue({
      openMeldProfileId: "agent-1",
      profileKind: "agent",
      ownerUserId: "owner-1",
      profileName: "Reviewer",
    });
    mocks.meta.mockResolvedValue(spaceMeta);
    mocks.documents.mockResolvedValue(documents);
    mocks.skills.mockResolvedValue(skills);
  });

  it("shares one authorized Space read across discovery and does not retain it for another task", async () => {
    const observations: unknown[] = [];
    const result = await readTaskKnowledge({
      ...scope,
      onRead: (read) => observations.push(read),
    });
    expect(result).toEqual({ documents: [], skills: [], spaceMeta });
    expect(mocks.profile).toHaveBeenCalledTimes(1);
    expect(mocks.meta).toHaveBeenCalledTimes(1);
    expect(mocks.meta).toHaveBeenCalledWith(
      expect.objectContaining({
        space: scope.spaceId,
        password: scope.spacePassword,
      })
    );
    expect(mocks.foundation).toHaveBeenCalledWith(
      "https://gateway.example.test",
      expect.objectContaining({ organizationId: "org-1" })
    );
    expect(observations).toEqual(
      expect.arrayContaining([
        {
          operation: "identity",
          durationMs: expect.any(Number),
          status: "loaded",
        },
        {
          operation: "space_metadata",
          durationMs: expect.any(Number),
          status: "loaded",
        },
        {
          operation: "documents",
          durationMs: expect.any(Number),
          status: "loaded",
        },
        {
          operation: "skills",
          durationMs: expect.any(Number),
          status: "loaded",
        },
      ])
    );
    mocks.meta.mockResolvedValue({ ...spaceMeta, organizationId: "org-2" });
    await readTaskKnowledge(scope);
    expect(mocks.profile).toHaveBeenCalledTimes(2);
    expect(mocks.meta).toHaveBeenCalledTimes(2);
    expect(mocks.foundation).toHaveBeenLastCalledWith(
      "https://gateway.example.test",
      expect.objectContaining({ organizationId: "org-2" })
    );
  });

  it("starts both independent directory reads without waiting for either to finish", async () => {
    let finishDocuments!: (value: typeof documents) => void;
    let skillsStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      skillsStarted = resolve;
    });
    mocks.documents.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishDocuments = resolve;
        })
    );
    mocks.skills.mockImplementation(() => {
      skillsStarted();
      return Promise.resolve(skills);
    });
    const pending = readTaskKnowledge(scope);
    await started;
    finishDocuments(documents);
    await expect(pending).resolves.toMatchObject({ documents: [], skills: [] });
  });

  it.each([
    "documents",
    "skills",
  ] as const)("preserves other context when %s discovery fails", async (failed) => {
    mocks[failed].mockRejectedValue(new Error("unavailable"));
    const onRead = vi.fn();
    const result = await readTaskKnowledge({ ...scope, onRead });
    expect(result.spaceMeta).toEqual(spaceMeta);
    expect(result[failed]).toBeNull();
    expect(result[failed === "documents" ? "skills" : "documents"]).toEqual([]);
    expect(onRead).toHaveBeenCalledWith({
      operation: failed,
      status: "failed",
      durationMs: expect.any(Number),
    });
  });

  it("keeps explicit handoff releases without looking up a newer selection", async () => {
    const selected = [
      {
        skillId: "skill-1",
        name: "release-review",
        releaseId: "pinned-release",
        digest: "a".repeat(64),
      },
    ];
    await expect(
      readTaskKnowledge({ ...scope, skillSelections: selected })
    ).resolves.toMatchObject({ skills: selected });
    expect(mocks.skills).not.toHaveBeenCalled();
  });

  it.each([
    { openMeldProfileId: "another-agent", profileKind: "agent" },
    { openMeldProfileId: "agent-1", profileKind: "human" },
  ])("rejects a mismatched acting identity before reading Space or knowledge", async (profile) => {
    mocks.profile.mockResolvedValue(profile);
    await expect(readTaskKnowledge(scope)).rejects.toThrow("does not match");
    expect(mocks.meta).not.toHaveBeenCalled();
    expect(mocks.documents).not.toHaveBeenCalled();
    expect(mocks.skills).not.toHaveBeenCalled();
  });
});
