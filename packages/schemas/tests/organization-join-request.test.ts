import { describe, expect, it } from "vitest";
import {
  type OrganizationJoinRequestResponse,
  organizationJoinRequestResponseForVersion,
} from "../src/organization-join-request";

describe("invitation review response compatibility", () => {
  it("only exposes reviewer names to callers that opt into version 3", () => {
    const response: OrganizationJoinRequestResponse = {
      ok: true,
      requests: [
        {
          id: "request",
          organizationId: "org",
          spaceId: null,
          email: "recipient@example.com",
          requestedByUserId: "sender",
          status: "approved",
          reviewedByUserId: "reviewer",
          createdAt: 1000,
          reviewedAt: 2000,
          invitationSentAt: null,
          applicantUserId: "recipient",
          joinedAt: 3000,
          reviewedByName: "Alex",
        },
      ],
    };
    const legacy = organizationJoinRequestResponseForVersion(response);
    const version2 = organizationJoinRequestResponseForVersion(response, "2");
    const version3 = organizationJoinRequestResponseForVersion(response, "3");
    if (!(legacy.ok && version2.ok && version3.ok)) {
      throw new Error("Expected successful responses.");
    }
    expect(legacy.requests[0]).not.toHaveProperty("reviewedByName");
    expect(legacy.requests[0]).not.toHaveProperty("joinedAt");
    expect(version2.requests[0]).not.toHaveProperty("reviewedByName");
    expect(version2.requests[0]).toMatchObject({
      applicantUserId: "recipient",
      joinedAt: 3000,
    });
    expect(version3.requests[0]).toMatchObject({
      reviewedByName: "Alex",
      reviewedByUserId: "reviewer",
      reviewedAt: 2000,
    });
  });
});
