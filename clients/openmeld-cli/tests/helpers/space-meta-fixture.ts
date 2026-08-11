import type { SpaceMeta } from "@openmeld/protocol";

export function createSpaceMetaFixture(
  input: Partial<SpaceMeta> = {}
): SpaceMeta {
  return {
    spaceId: "space-1",
    organizationId: "org-1",
    visibility: "private",
    ...input,
  };
}
