import { describe, expect, it } from "vitest";
import { buildNextSpaceMetaRecord } from "../src/space/application/space-meta-service";
import type { SpaceMetaUpdatePatch } from "../src/space/rules/parsers/space-meta-patch";

const NOW = "2026-08-12T00:00:00.000Z";
const ORGANIZATION_ID = "org-space-meta-test";
const SPACE_ID = "space-meta-test";

describe("Space metadata initialization", () => {
  it("updates directory visibility without changing link access or organization", () => {
    const existing = buildNextSpaceMetaRecord({
      existing: null,
      metaUpdate: initializationPatch({
        visibility: "private",
        accessMode: "members_only",
      }),
      now: NOW,
      spaceId: SPACE_ID,
    });
    existing.directMessage = { pairKey: "converted-pair", convertedAt: NOW };
    const record = buildNextSpaceMetaRecord({
      existing,
      metaUpdate: {
        ...initializationPatch({ visibility: "public" }),
        hasOrganizationId: false,
      },
      now: NOW,
      spaceId: SPACE_ID,
    });
    expect(record.visibility).toBe("public");
    expect(record.accessMode).toBe("members_only");
    expect(record.organizationId).toBe(ORGANIZATION_ID);
    expect(record.directMessage).toEqual(existing.directMessage);
  });
  it("defaults a private Space to members-only access", () => {
    const record = buildNextSpaceMetaRecord({
      existing: null,
      metaUpdate: initializationPatch({ visibility: "private" }),
      now: NOW,
      spaceId: SPACE_ID,
    });

    expect(record.accessMode).toBe("members_only");
  });

  it("keeps an organization-listed Space internal unless external link access is explicit", () => {
    const record = buildNextSpaceMetaRecord({
      existing: null,
      metaUpdate: initializationPatch({ visibility: "public" }),
      now: NOW,
      spaceId: SPACE_ID,
    });

    expect(record.accessMode).toBe("members_only");
  });

  it("preserves an explicit access mode instead of replacing it with the visibility default", () => {
    const record = buildNextSpaceMetaRecord({
      existing: null,
      metaUpdate: initializationPatch({
        accessMode: "public",
        visibility: "private",
      }),
      now: NOW,
      spaceId: SPACE_ID,
    });

    expect(record.accessMode).toBe("public");
  });
});

function initializationPatch(input: {
  accessMode?: SpaceMetaUpdatePatch["accessMode"];
  visibility: NonNullable<SpaceMetaUpdatePatch["visibility"]>;
}): SpaceMetaUpdatePatch {
  return {
    hasAccessMode: input.accessMode !== undefined,
    ...(input.accessMode === undefined ? {} : { accessMode: input.accessMode }),
    hasCreator: false,
    hasGuide: false,
    hasName: false,
    hasOrganizationId: true,
    organizationId: ORGANIZATION_ID,
    hasPurpose: false,
    hasVisibility: true,
    visibility: input.visibility,
  };
}
