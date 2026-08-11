import { describe, expect, it } from "vitest";
import {
  centerAgentActionSchema,
  centerAgentReadMemberOpenMeldServiceStatusBodySchema,
  centerAgentReadMemberOpenMeldServiceStatusResponseSchema,
  listCenterAgentAuditJournalQuerySchema,
  organizationMemberOpenMeldServiceStateSchema,
  organizationMemberOpenMeldServiceStatusesResponseSchema,
} from "../../src/index";

describe("Organization member OpenMeld Service status contracts", () => {
  it("accepts the four coarse member-visible states", () => {
    expect(organizationMemberOpenMeldServiceStateSchema.options).toEqual([
      "connected",
      "needs_attention",
      "not_connected",
      "unknown",
    ]);
  });

  it("returns only the member identity and coarse Service state", () => {
    const response = {
      generatedAt: "2026-07-21T08:00:00.000Z",
      organizationId: "org_123",
      members: [
        {
          state: "connected",
          userId: "user_123",
        },
      ],
    } as const;

    expect(
      organizationMemberOpenMeldServiceStatusesResponseSchema.parse(response)
    ).toEqual(response);
    expect(
      organizationMemberOpenMeldServiceStatusesResponseSchema.safeParse({
        ...response,
        members: [
          {
            deviceDisplayName: "Ashley's MacBook Pro",
            lastHeartbeatMs: 123,
            serviceVersion: "1.2.3",
            state: "connected",
            userId: "user_123",
          },
        ],
      }).success
    ).toBe(false);
  });

  it("rejects invalid timestamps and unbounded identity values", () => {
    expect(
      organizationMemberOpenMeldServiceStatusesResponseSchema.safeParse({
        generatedAt: "today",
        organizationId: "org_123",
        members: [],
      }).success
    ).toBe(false);
    expect(
      organizationMemberOpenMeldServiceStatusesResponseSchema.safeParse({
        generatedAt: "2026-07-21T08:00:00.000Z",
        organizationId: "org_123",
        members: [{ state: "connected", userId: "" }],
      }).success
    ).toBe(false);
  });
});

describe("Center Agent member OpenMeld Service status schemas", () => {
  it("accepts one exact member user ID and rejects unknown input fields", () => {
    expect(
      centerAgentReadMemberOpenMeldServiceStatusBodySchema.parse({
        memberUserId: "user-123",
      })
    ).toEqual({ memberUserId: "user-123" });
    expect(() =>
      centerAgentReadMemberOpenMeldServiceStatusBodySchema.parse({
        memberUserId: "user-123",
        includeDeviceDetails: true,
      })
    ).toThrow();
  });

  it("returns only the coarse member state and rejects private device details", () => {
    const response = {
      generatedAt: "2026-07-23T00:00:00.000Z",
      member: {
        state: "connected",
        userId: "user-123",
      },
      organizationId: "org-123",
    };

    expect(
      centerAgentReadMemberOpenMeldServiceStatusResponseSchema.parse(response)
    ).toEqual(response);
    expect(() =>
      centerAgentReadMemberOpenMeldServiceStatusResponseSchema.parse({
        ...response,
        member: {
          ...response.member,
          deviceName: "Felix's MacBook",
        },
      })
    ).toThrow();
  });

  it("makes the read visible in the next audit action set", () => {
    expect(
      centerAgentActionSchema.parse("read_member_openmeld_service_status")
    ).toBe("read_member_openmeld_service_status");
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v12" })
    ).toEqual({ actionSet: "v12" });
  });
});
