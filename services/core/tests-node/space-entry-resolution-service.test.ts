import type { GetSpaceStatusResponse } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  buildSpaceEntryResolution,
  buildUnavailableSpaceEntryResolution,
} from "../src/space/application/space-entry-resolution-service";

const baseStatus: GetSpaceStatusResponse = {
  spaceId: "space-1",
  generatedAt: "2026-09-04T00:00:00.000Z",
  name: "Launch planning",
  accessMode: "public",
  passwordProtected: false,
  dispatchPolicy: { mode: "mention_only" },
  publicationMode: "collaboration",
  allowedActions: ["post_message", "post_status", "stay_silent"],
  resultArchivePolicy: { mode: "all_final_results" },
  entryBrief: "default",
  dispatchBrief: "default",
  members: {
    totalCount: 1,
    humanCount: 1,
    agentCount: 0,
    liveNowCount: 0,
    liveHumanCount: 0,
    liveAgentCount: 0,
  },
};

const indexed = {
  organizationId: "org-1",
  organizationSlug: "acme",
  owner: {
    profileId: "00000000-0000-4000-8000-000000000001",
    displayName: "Avery Chen",
  },
  spaceName: "Launch planning",
  visibility: "private" as const,
};

describe("Space entry resolution service", () => {
  it.each([
    "space.membership_required",
    "space.password_required",
  ] as const)("offers Organization members self-join without reading restricted content: %s", (code) => {
    expect(
      buildSpaceEntryResolution({
        access: { kind: "denied", code },
        authenticated: true,
        indexed: { ...indexed, visibility: "public" },
        organizationMember: true,
        target: { spaceId: "space-1", signalId: "signal-1" },
      })
    ).toMatchObject({
      view: { state: "membership_required" },
      participation: { state: "self_join_available" },
      recovery: null,
      target: { signalId: "signal-1" },
    });
  });
  it("routes active members to the member experience", () => {
    expect(
      buildSpaceEntryResolution({
        access: { kind: "allowed", activeMember: true, status: baseStatus },
        authenticated: true,
        indexed,
        organizationMember: true,
        target: { spaceId: "space-1", signalId: "signal-1" },
      })
    ).toMatchObject({
      target: { signalId: "signal-1" },
      view: { state: "allowed", experience: "member" },
      participation: { state: "active_member" },
      safeContext: { organizationSlug: "acme", spaceName: "Launch planning" },
    });
  });

  it("keeps a public reader outside the member experience", () => {
    expect(
      buildSpaceEntryResolution({
        access: { kind: "allowed", activeMember: false, status: baseStatus },
        authenticated: false,
        indexed,
        organizationMember: false,
        target: { spaceId: "space-1" },
      })
    ).toEqual({
      target: { spaceId: "space-1" },
      view: { state: "allowed", experience: "public" },
      participation: { state: "self_join_available" },
      safeContext: { spaceName: "Launch planning" },
      recovery: null,
    });
  });

  it("keeps public viewing separate from password-gated joining", () => {
    expect(
      buildSpaceEntryResolution({
        access: {
          kind: "allowed",
          activeMember: false,
          status: {
            ...baseStatus,
            accessMode: "public_view_join_password",
            passwordProtected: true,
          },
        },
        authenticated: false,
        indexed,
        organizationMember: false,
        target: { spaceId: "space-1" },
      }).participation
    ).toEqual({ state: "password_required" });
  });

  it("gives same-Organization nonmembers bounded owner guidance", () => {
    expect(
      buildSpaceEntryResolution({
        access: { kind: "denied", code: "space.membership_required" },
        authenticated: true,
        indexed,
        organizationMember: true,
        target: { spaceId: "space-1", threadRootSignalId: "thread-1" },
      })
    ).toEqual({
      target: { spaceId: "space-1", threadRootSignalId: "thread-1" },
      view: { state: "membership_required" },
      participation: { state: "owner_add_required" },
      safeContext: {
        organizationId: "org-1",
        organizationSlug: "acme",
        spaceName: "Launch planning",
        owner: indexed.owner,
      },
      recovery: { kind: "contact_space_owner" },
    });
  });

  it("does not disclose private Space context to outsiders", () => {
    expect(
      buildSpaceEntryResolution({
        access: { kind: "denied", code: "space.membership_required" },
        authenticated: true,
        indexed,
        organizationMember: false,
        target: { spaceId: "space-1" },
      })
    ).toEqual(buildUnavailableSpaceEntryResolution({ spaceId: "space-1" }));
  });

  it("offers sign-in only for a publicly listed members-only Space", () => {
    expect(
      buildSpaceEntryResolution({
        access: { kind: "denied", code: "space.membership_required" },
        authenticated: false,
        indexed: { ...indexed, visibility: "public" },
        organizationMember: false,
        target: { spaceId: "space-1" },
      })
    ).toMatchObject({
      view: { state: "sign_in_required" },
      safeContext: {},
      recovery: { kind: "sign_in" },
    });
  });

  it("does not disclose protected Space context before password entry", () => {
    expect(
      buildSpaceEntryResolution({
        access: { kind: "denied", code: "space.password_required" },
        authenticated: false,
        indexed,
        organizationMember: false,
        target: { spaceId: "space-1" },
      })
    ).toMatchObject({
      view: { state: "password_required" },
      safeContext: {},
      recovery: { kind: "provide_password" },
    });
  });
});
