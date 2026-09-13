import { expect, it } from "vitest";
import { projectLegacySpaceAccessView } from "../src/space-access-version";

it("preserves the original strict metadata and bootstrap views for older readers", () => {
  const status = {
    spaceId: "space",
    accessMode: "members_only",
    ownerUserIds: ["owner"],
    allowGuests: true,
  };
  expect(projectLegacySpaceAccessView({ status, signals: [] })).toEqual({
    status: { spaceId: "space", accessMode: "members_only" },
    signals: [],
  });
  expect(
    projectLegacySpaceAccessView({ spaceId: "space", meta: status })
  ).toEqual({
    spaceId: "space",
    meta: { spaceId: "space", accessMode: "members_only" },
  });
  expect(status.ownerUserIds).toEqual(["owner"]);
});
