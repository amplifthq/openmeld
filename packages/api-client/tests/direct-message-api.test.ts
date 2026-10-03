import { convertDirectMessageToSpaceResponseSchema } from "@openmeld/schemas";
import { createSpaceMemberAgentSnapshot } from "@openmeld/schemas/testing";
import { describe, expect, it, vi } from "vitest";
import {
  createDirectMessageApi,
  createOpenMeldApiClient,
  type OpenMeldApiClientTransport,
} from "../src";

describe("Direct Message conversion membership response", () => {
  it("preserves new delivery intent and rejects a receiver that silently ignores it", async () => {
    const request = {
      targetProfileId: "11111111-1111-4111-8111-111111111111",
      creationId: "22222222-2222-4222-8222-222222222222",
      message: {
        clientMessageId: "33333333-3333-4333-8333-333333333333",
        text: "The review is ready.",
        wake: false,
      },
    };
    const response = {
      organizationId: "org-1",
      memberProfileId: "agt_44444444-4444-4444-8444-444444444444",
      targetProfileId: request.targetProfileId,
      spaceId: "space-1",
      created: true,
      creationId: request.creationId,
    };
    const transport = vi.fn<OpenMeldApiClientTransport>(async () =>
      Response.json(response)
    );
    const api = createDirectMessageApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );
    await expect(api.openSpace(request)).rejects.toThrow(
      "did not confirm the Direct Message"
    );
    expect(
      JSON.parse(transport.mock.calls[0]?.[0]?.init?.body as string)
    ).toEqual(request);
    await expect(
      api.openSpace({
        targetProfileId: request.targetProfileId,
        creationId: request.creationId,
      })
    ).resolves.toEqual(response);
    await expect(
      api.openSpace({
        targetProfileId: request.targetProfileId,
        creationId: "55555555-5555-4555-8555-555555555555",
      })
    ).rejects.toThrow("did not confirm the new chat");
    await expect(
      api.openSpace({
        targetProfileId: request.targetProfileId,
        spaceId: "another-dm",
        message: request.message,
      })
    ).rejects.toThrow("did not confirm the selected Direct Message");
    expect(
      JSON.parse(transport.mock.calls.at(-1)?.[0]?.init?.body as string)
    ).toMatchObject({ spaceId: "another-dm", message: request.message });
  });
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
