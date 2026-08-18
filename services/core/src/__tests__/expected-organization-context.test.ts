import { ORGANIZATION_REQUEST_CONTEXT_MISMATCH_MESSAGE } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { requireExpectedOrganizationContext } from "../organizations/expected-organization-context";

describe("requireExpectedOrganizationContext", () => {
  it("accepts the verified Organization", () => {
    expect(() =>
      requireExpectedOrganizationContext({
        actualOrganizationId: "org-1",
        errorCode: "test.organization_context_changed",
        expectedOrganizationId: "org-1",
      })
    ).not.toThrow();
  });

  it("preserves the caller error code with one accurate mismatch message", () => {
    expect(() =>
      requireExpectedOrganizationContext({
        actualOrganizationId: "org-session",
        errorCode: "test.organization_context_changed",
        expectedOrganizationId: "org-route",
      })
    ).toThrow(
      `HTTP 409: {"ok":false,"error":{"code":"test.organization_context_changed","message":"${ORGANIZATION_REQUEST_CONTEXT_MISMATCH_MESSAGE}"}}`
    );
  });
});
