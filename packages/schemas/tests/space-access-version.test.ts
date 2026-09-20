import { expect, it } from "vitest";
import {
  projectLegacySpaceAccessView,
  projectSpaceAccessViewForVersion,
} from "../src/space-access-version";

it("preserves the original strict metadata and bootstrap views for older readers", () => {
  const status = {
    spaceId: "space",
    accessMode: "members_only",
    ownerUserIds: ["owner"],
    allowGuests: true,
    linkJoinPolicy: "invite_only",
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

it("keeps version 1 ownership fields while hiding the version 2 join policy", () => {
  expect(
    projectSpaceAccessViewForVersion(
      {
        accessMode: "public",
        allowGuests: true,
        linkJoinPolicy: "invite_only",
        ownerUserIds: ["owner"],
      },
      "1"
    )
  ).toEqual({
    accessMode: "public",
    allowGuests: true,
    ownerUserIds: ["owner"],
  });
});
