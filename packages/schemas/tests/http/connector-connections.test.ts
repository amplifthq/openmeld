import {
  buildConnectorAppRequestProviderKey,
  CENTER_AGENT_APP_CONNECTOR_SERVICES,
  connectorAppCatalogResponseSchema,
  connectorAppRequestResponseSchema,
  connectorAuthorizationStartResponseSchema,
  connectorOrganizationContextQuerySchema,
  connectorServiceSchema,
  createConnectorAppRequestBodySchema,
  githubAppInstallationSetupQuerySchema,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";

describe("connector service registry", () => {
  it("supports Notion as a Center Agent App", () => {
    expect(CENTER_AGENT_APP_CONNECTOR_SERVICES).toContain("notion");
    expect(connectorServiceSchema.safeParse("notion")).toMatchObject({
      success: true,
    });
  });

  it("accepts only an opaque OpenMeld state and positive GitHub installation id", () => {
    expect(
      githubAppInstallationSetupQuerySchema.safeParse({
        installation_id: "987654",
        setup_action: "install",
        state: `githubapp_${"a".repeat(64)}`,
      })
    ).toMatchObject({ success: true });
    expect(
      githubAppInstallationSetupQuerySchema.safeParse({
        installation_id: "not-an-id",
        state: `githubapp_${"a".repeat(64)}`,
      })
    ).toMatchObject({ success: false });
  });

  it("keeps authorization expiry opt-in and compatible with older callers", () => {
    const authorization = {
      authorizationUrl: "https://github.example/authorize",
      connection: {
        canDisconnect: true,
        connectionName: "github-organization",
        createdAtMs: 1,
        disconnectedAtMs: null,
        organizationId: "org-acme",
        ownerDisplayName: "OpenMeld",
        scope: "shared",
        service: "github",
        status: "pending",
        updatedAtMs: 1,
        userId: "user-1",
      },
    };

    expect(
      connectorOrganizationContextQuerySchema.safeParse({
        expectedOrganizationId: "org-acme",
        includeAuthorizationExpiry: "true",
      })
    ).toMatchObject({ success: true });
    expect(
      connectorAuthorizationStartResponseSchema.safeParse(authorization)
    ).toMatchObject({ success: true });
    expect(
      connectorAuthorizationStartResponseSchema.safeParse({
        ...authorization,
        expiresAtMs: 600_001,
      })
    ).toMatchObject({ success: true });
  });

  it("distinguishes catalog requests from freeform requests", () => {
    expect(
      createConnectorAppRequestBodySchema.safeParse({
        providerId: "microsoft-teams",
        providerName: "Microsoft Teams",
        source: "openconnector_catalog",
        useCase: "Coordinate customer escalations.",
      })
    ).toMatchObject({ success: true });
    expect(
      createConnectorAppRequestBodySchema.safeParse({
        providerName: "Internal CRM",
        source: "freeform",
      })
    ).toMatchObject({ success: true });
    expect(
      createConnectorAppRequestBodySchema.safeParse({
        providerName: "Microsoft Teams",
        source: "openconnector_catalog",
      })
    ).toMatchObject({ success: false });
    expect(
      connectorAppRequestResponseSchema.safeParse({
        request: {
          availableAtMs: null,
          createdAtMs: 1,
          id: "connector_request_1",
          notifiedAtMs: null,
          organizationId: "org-acme",
          providerId: "microsoft-teams",
          providerName: "Microsoft Teams",
          requestedCapabilities: [],
          requesterMemberId: "member-1",
          requesterUserId: "user-1",
          source: "openconnector_catalog",
          status: "requested",
          updatedAtMs: 1,
          useCase: "Coordinate customer escalations.",
        },
      })
    ).toMatchObject({ success: true });
  });

  it("builds one locale-independent identity for connector App requests", () => {
    expect(
      buildConnectorAppRequestProviderKey({
        providerId: "IDENTITY",
        providerName: "Ignored",
        source: "openconnector_catalog",
      })
    ).toBe("catalog:identity");
    expect(
      buildConnectorAppRequestProviderKey({
        providerId: null,
        providerName: "  Internal   CRM  ",
        source: "freeform",
      })
    ).toBe("freeform:internal crm");
  });

  it("accepts the OpenConnector provider metadata OpenMeld exposes", () => {
    expect(
      connectorAppCatalogResponseSchema.safeParse({
        organizationId: "org-acme",
        providers: [
          {
            authTypes: ["oauth2", "api_key"],
            categories: [
              { displayName: "Developer Tools", id: "Developer Tools" },
            ],
            displayName: "GitHub",
            homepageUrl: "https://github.com",
            iconUrl: null,
            service: "github",
          },
        ],
      })
    ).toMatchObject({ success: true });
  });
});
