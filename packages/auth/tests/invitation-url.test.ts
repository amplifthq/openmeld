import { describe, expect, it } from "vitest";
import { buildOrganizationInvitationWebUrl } from "../src/utils/invitation-url";

describe("buildOrganizationInvitationWebUrl", () => {
  it("includes the invitation id, masked hint, org name, and slug", () => {
    const url = new URL(
      buildOrganizationInvitationWebUrl({
        invitationId: "inv-123",
        organizationName: "Acme",
        organizationSlug: "acme",
        recipientEmail: "beatrice@gmail.com",
        webAppUrl: "https://openmeld.ai",
      })
    );

    expect(url.pathname).toBe("/accept-invitation");
    expect(url.searchParams.get("invitationId")).toBe("inv-123");
    expect(url.searchParams.get("hint")).toBe("b***@gmail.com");
    expect(url.searchParams.get("org")).toBe("Acme");
    expect(url.searchParams.get("orgSlug")).toBe("acme");
  });

  it("never places the full recipient email in the link", () => {
    const link = buildOrganizationInvitationWebUrl({
      invitationId: "inv-123",
      organizationName: "Acme",
      organizationSlug: "acme",
      recipientEmail: "beatrice@gmail.com",
      webAppUrl: "https://openmeld.ai",
    });

    expect(link.includes("beatrice")).toBe(false);
    expect(link.includes("eatrice")).toBe(false);
  });

  it("percent-encodes organization names with spaces", () => {
    const link = buildOrganizationInvitationWebUrl({
      invitationId: "inv-123",
      organizationName: "Acme Labs",
      organizationSlug: "acme-labs",
      recipientEmail: "beatrice@gmail.com",
      webAppUrl: "https://openmeld.ai",
    });

    expect(link).toContain("org=Acme+Labs");
    expect(new URL(link).searchParams.get("org")).toBe("Acme Labs");
  });

  it("omits optional params that are missing or blank", () => {
    const url = new URL(
      buildOrganizationInvitationWebUrl({
        invitationId: "inv-123",
        organizationName: null,
        organizationSlug: "   ",
        recipientEmail: null,
        webAppUrl: "https://openmeld.ai",
      })
    );

    expect(url.searchParams.get("invitationId")).toBe("inv-123");
    expect(url.searchParams.has("hint")).toBe(false);
    expect(url.searchParams.has("org")).toBe(false);
    expect(url.searchParams.has("orgSlug")).toBe(false);
  });

  it("falls back to manual query building for a non-absolute base url", () => {
    const link = buildOrganizationInvitationWebUrl({
      invitationId: "inv-123",
      organizationName: "Acme",
      organizationSlug: "acme",
      recipientEmail: "beatrice@gmail.com",
      webAppUrl: "not-a-valid-url/",
    });

    expect(link).toBe(
      `${"not-a-valid-url/accept-invitation?invitationId=inv-123&hint=b%23%23%23%40gmail.com".replace(
        "%23%23%23",
        "***"
      )}&org=Acme&orgSlug=acme`
    );
  });
});
