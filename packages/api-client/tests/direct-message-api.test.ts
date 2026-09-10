import { convertDirectMessageToSpaceResponseSchema } from "@openmeld/schemas";
import { createSpaceMemberAgentSnapshot } from "@openmeld/schemas/testing";
import { describe, expect, it, vi } from "vitest";
import {
  createDirectMessageApi,
  createOpenMeldApiClient,
  type OpenMeldApiClientTransport,
} from "../src";

describe("Direct Message conversion membership response", () => {
  it.each([
    false,
    true,
  ])("preserves the requested member snapshot contract (%s)", async (includeMemberSnapshots) => {
    const member = createSpaceMemberAgentSnapshot();
    const response = {
      accessMode: "members_only",
      addedMemberIds: [member.profileId],
      alreadyMemberIds: [],
      convertedAt: "2026-09-10T08:00:00.000Z",
      name: "Launch Team",
      spaceId: "space-123",
      ...(includeMemberSnapshots ? { items: [member] } : {}),
    };
    const transport = vi.fn<OpenMeldApiClientTransport>(() =>
      Promise.resolve(Response.json(response))
    );
    const api = createDirectMessageApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );
    await expect(
      api.convertToSpace({
        name: response.name,
        profileIds: [member.profileId],
        spaceId: response.spaceId,
        ...(includeMemberSnapshots ? { includeMemberSnapshots: true } : {}),
      })
    ).resolves.toEqual(response);
    const body = JSON.parse(transport.mock.calls[0]?.[0]?.init?.body as string);
    expect(body).toEqual({
      name: response.name,
      profileIds: [member.profileId],
      ...(includeMemberSnapshots ? { includeMemberSnapshots: true } : {}),
    });
  });

  it("validates returned member details instead of accepting partial profile guesses", () => {
    expect(
      convertDirectMessageToSpaceResponseSchema.safeParse({
        accessMode: "members_only",
        addedMemberIds: [],
        alreadyMemberIds: [],
        convertedAt: "2026-09-10T08:00:00.000Z",
        name: "Launch Team",
        spaceId: "space-123",
        items: [{ profileKind: "agent", profileName: "Incomplete Agent" }],
      }).success
    ).toBe(false);
  });
});
