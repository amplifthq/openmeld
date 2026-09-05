import { describe, expect, it } from "vitest";
import {
  getSpaceEntryResolutionInputSchema,
  getSpaceEntryResolutionResponseSchema,
} from "../../src/schemas";

describe("Space entry resolution contracts", () => {
  it("normalizes and preserves a message target", () => {
    expect(
      getSpaceEntryResolutionInputSchema.parse({
        spaceId: " space-1 ",
        signalId: " signal-2 ",
        threadRootSignalId: " thread-3 ",
      })
    ).toEqual({
      spaceId: "space-1",
      signalId: "signal-2",
      threadRootSignalId: "thread-3",
    });
  });

  it("keeps public viewing separate from password-gated participation", () => {
    expect(
      getSpaceEntryResolutionResponseSchema.parse({
        target: { spaceId: "space-1", signalId: "signal-2" },
        view: { state: "allowed", experience: "public" },
        participation: { state: "password_required" },
        safeContext: { spaceName: "Launch planning" },
        recovery: null,
      })
    ).toEqual({
      target: { spaceId: "space-1", signalId: "signal-2" },
      view: { state: "allowed", experience: "public" },
      participation: { state: "password_required" },
      safeContext: { spaceName: "Launch planning" },
      recovery: null,
    });
  });

  it("carries only safe owner guidance for an Organization member", () => {
    expect(
      getSpaceEntryResolutionResponseSchema.parse({
        target: { spaceId: "space-1" },
        view: { state: "membership_required" },
        participation: { state: "owner_add_required" },
        safeContext: {
          organizationId: "org-1",
          organizationSlug: "acme",
          spaceName: "Leadership",
          owner: {
            profileId: "00000000-0000-4000-8000-000000000001",
            displayName: "Avery Chen",
          },
        },
        recovery: { kind: "contact_space_owner" },
      }).recovery
    ).toEqual({ kind: "contact_space_owner" });
  });

  it("supports a disclosure-safe unavailable result", () => {
    expect(
      getSpaceEntryResolutionResponseSchema.parse({
        target: { spaceId: "private-space" },
        view: { state: "unavailable" },
        participation: { state: "unavailable" },
        safeContext: {},
        recovery: null,
      })
    ).toMatchObject({ safeContext: {}, view: { state: "unavailable" } });
  });

  it("rejects unknown recovery actions", () => {
    expect(
      getSpaceEntryResolutionResponseSchema.safeParse({
        target: { spaceId: "space-1" },
        view: { state: "membership_required" },
        participation: { state: "owner_add_required" },
        safeContext: {},
        recovery: { kind: "request_access" },
      }).success
    ).toBe(false);
  });
});
